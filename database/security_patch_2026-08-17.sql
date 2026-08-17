-- ============================================================================
-- PATCH SÉCURITÉ — 17/08/2026 (12ᵉ passe — ESCALADE DE PRIVILÈGES RÔLES)
-- Richman Estate : durcissement de la création de compte & des permissions admin
--
-- À EXÉCUTER DANS L'ÉDITEUR SQL SUPABASE (Dashboard > SQL Editor > New query)
-- Idempotent : peut être relancé sans risque.
--
-- PROBLÈMES CORRIGÉS :
--   1. [CRITIQUE] handle_new_user / protect_role_update reconnaissent les 2
--      « fondateurs » via raw_user_meta_data->>'provider_id' / 'sub' — des
--      métadonnées fournies par l'UTILISATEUR. Or l'inscription email est
--      ACTIVÉE sur le projet (vérifié en live : /auth/v1/settings -> email:true,
--      disable_signup:false). Un attaquant peut donc :
--        POST {URL}/auth/v1/signup  body { email, password,
--              data: { provider_id: "985083967642423366" } }
--      -> le trigger crée le profil avec role='owner' -> ADMIN TOTAL.
--      Même chose via supabase.auth.updateUser({ data: { provider_id: ... } })
--      puis mise à jour de son propre profil (RLS autorise id = auth.uid()).
--   2. [CRITIQUE] is_admin() inclut gerant_hotel & gerant_vehicules -> un
--      gérant peut se nommer owner, promouvoir n'importe qui, supprimer des
--      comptes, lire les logs. La hiérarchie « perm plus » n'existe pas en base.
--   3. [ÉLEVÉE] Bug du trigger : un fondateur qui édite la fiche d'un client
--      (ex. son nom) applique NEW.role := 'owner' à la LIGNE MODIFIÉE -> le
--      client devient fondateur sans le savoir.
--   4. [ÉLEVÉE] Accès aux dossiers d'autrui par matching sur full_name :
--      un client peut changer son full_name (colonne libre) et lire/écrire les
--      bookings/chat d'un autre client (téléphone, notes, discord_id).
--      Le défaut client_name='Citoyen' aggrave (lisible par quiconque se nomme
--      « Citoyen »).
--
-- PRINCIPE DU CORRECTIF :
--   * Le statut « fondateur » n'est reconnu QUE via la table auth.identities
--     (provider='discord'), écrite par GoTrue au flux OAuth et NON modifiable par
--     l'utilisateur — jamais depuis user_metadata (forgeable, y compris par
--     supabase.auth.updateUser pour un compte Discord déjà existant).
--   * La liste des fondateurs est déplacée dans une table trusted_founders
--     fermée (aucune policy pour anon/authenticated), pilotée par service_role.
--   * La gestion des rôles passe par une RPC dédiée admin_set_role()
--     (SECURITY DEFINER) : seuls owner/admin y ont droit, et seul un owner
--     (ou le service_role) peut créer/rétrograder un owner.
--   * Les colonnes sensibles (role, discord_roles, id) ne sont plus modifiables
--     en direct par authenticated ; le trigger verrouille aussi discord_id
--     (uniquement modifiable vers SON PROPRE identifiant Discord vérifié).
--   * Le matching par nom complet est supprimé des policies bookings/chat.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ÉTAPE 1 — Table des fondateurs de confiance (fermée aux clients)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trusted_founders (
    discord_id TEXT PRIMARY KEY,
    added_by   TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.trusted_founders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trusted_founders FROM anon, authenticated;
GRANT ALL ON public.trusted_founders TO service_role;
-- Aucune policy SELECT/INSERT/UPDATE/DELETE pour anon/authenticated :
-- la table est inaccessible aux clients par conception.

INSERT INTO public.trusted_founders (discord_id, added_by) VALUES
    ('985083967642423366', 'system'),
    ('1015310406169923665', 'system')
ON CONFLICT (discord_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- ÉTAPE 2 — Helper de confiance : discord_id issu UNIQUEMENT de auth.identities
-- ---------------------------------------------------------------------------

-- discord_id de confiance : lu dans la table auth.identities (provider='discord').
-- Cette table est écrite par GoTrue lors du flux OAuth — l'utilisateur ne peut
-- PAS la modifier (contrairement à user_metadata, forgeable via
-- supabase.auth.updateUser({ data: { provider_id: ... } }) même pour un compte
-- Discord déjà existant).
-- NB : pour une identité Discord, provider_id = l'ID Discord (snowflake).
CREATE OR REPLACE FUNCTION public.trusted_discord_id(v_uid UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE
AS $$
DECLARE v_id TEXT;
BEGIN
  SELECT provider_id INTO v_id
  FROM auth.identities
  WHERE user_id = v_uid AND provider = 'discord'
  LIMIT 1;
  RETURN v_id;
END;
$$;

-- Seul le rôle 'owner' (fondateur)
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner');
$$;

-- owner OU admin (gestion des comptes et des rôles)
-- NB : les gérants (gerant_hotel / gerant_vehicules) n'en font PAS partie :
-- ils gardent leurs actions métier via is_admin(), mais ne peuvent plus
-- toucher aux rôles/comptes.
CREATE OR REPLACE FUNCTION public.is_strict_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'));
$$;

-- is_admin() conservé pour les opérations métier (bookings, chat, statuts...)
-- inchangé. Les policies sensibles (rôles/comptes) passent sur is_strict_admin().

-- ---------------------------------------------------------------------------
-- ÉTAPE 3 — handle_new_user : fondateur uniquement si OAuth Discord vérifié
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_discord_id TEXT;
  v_avatar_url TEXT;
  v_name TEXT;
  v_rp_id TEXT;
  v_role user_role := 'client'::user_role;
  v_is_discord BOOLEAN;
BEGIN
  v_is_discord := COALESCE(NEW.raw_app_meta_data->>'provider', '') = 'discord'
                  OR COALESCE(NEW.raw_app_meta_data->>'providers', '[]')::text LIKE '%"discord"%';

  -- discord_id de confiance : d'abord auth.identities (fiable), puis les
  -- métadonnées UNIQUEMENT si le compte a été créé par OAuth Discord
  -- (app_metadata écrit par GoTrue au moment de la création — pas forgeable ici).
  v_discord_id := COALESCE(
    public.trusted_discord_id(NEW.id),
    CASE WHEN v_is_discord THEN
      COALESCE(NEW.raw_user_meta_data->>'provider_id', NEW.raw_user_meta_data->>'sub')
    ELSE NULL END
  );

  IF v_discord_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.trusted_founders f WHERE f.discord_id = v_discord_id) THEN
    v_role := 'owner'::user_role;
  END IF;

  v_avatar_url := COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'picture',
    CASE
      WHEN NEW.raw_user_meta_data->>'avatar' IS NOT NULL AND v_discord_id IS NOT NULL
      THEN 'https://cdn.discordapp.com/avatars/' || v_discord_id || '/' || (NEW.raw_user_meta_data->>'avatar') || '.png'
      ELSE NULL
    END
  );

  v_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NEW.email,
    'Citoyen'
  );

  v_rp_id := COALESCE(
    NEW.raw_user_meta_data->>'rp_id',
    substring(v_name from '\|\s*([0-9]+)'),
    substring(v_name from '[\[\(#\-]\s*([0-9]+)'),
    substring(v_name from '([0-9]{2,6})$')
  );

  INSERT INTO public.profiles (
    id, discord_id, full_name, first_name, last_name, rp_id, role, avatar_url, email, discord_roles
  )
  VALUES (
    NEW.id,
    v_discord_id,
    v_name,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    v_rp_id,
    v_role,
    v_avatar_url,
    NEW.email,
    '[]'::jsonb
  )
  ON CONFLICT (id) DO UPDATE SET
    discord_id = COALESCE(EXCLUDED.discord_id, public.profiles.discord_id),
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    rp_id = COALESCE(public.profiles.rp_id, EXCLUDED.rp_id, substring(EXCLUDED.full_name from '\|\s*([0-9]+)')),
    -- Promotion fondateur : UNIQUEMENT si discord_id légitime (OAuth Discord + whitelist)
    role = CASE
      WHEN EXCLUDED.discord_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.trusted_founders f WHERE f.discord_id = EXCLUDED.discord_id)
      THEN 'owner'::user_role
      ELSE public.profiles.role
    END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- ÉTAPE 4 — protect_role_update : plus d'auto-promotion sur les lignes éditées
--           par un fondateur ; changements de rôle réservés aux admins stricts ;
--           un owner ne peut être créé/rétrogradé que par un owner/service_role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_role_update()
RETURNS TRIGGER AS $$
DECLARE
  v_jwt JSONB;
  v_discord_id TEXT;
BEGIN
  v_jwt := auth.jwt();
  -- NULL si l'appelant n'a pas d'identité Discord vérifiée dans auth.identities
  -- (email, compte forgé, updateUser avec metadata falsifiée : tout est ignoré)
  v_discord_id := public.trusted_discord_id(auth.uid());

  IF TG_OP = 'INSERT' THEN
    -- Contexte interne (trigger GoTrue handle_new_user) : PAS de JWT de requête.
    -- On laisse handle_new_user décider (fondateur déjà promu à la création,
    -- discord_id déjà résolu depuis auth.identities). Ne rien écraser.
    IF auth.uid() IS NULL AND v_jwt IS NULL THEN
      NULL;
    -- Auto-promotion fondateur : uniquement pour SA PROPRE ligne et si le
    -- discord_id provient d'une identité Discord vérifiée présente dans la whitelist
    ELSIF NEW.id = auth.uid()
          AND v_discord_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.trusted_founders f WHERE f.discord_id = v_discord_id)
    THEN
      NEW.role := 'owner'::user_role;
      NEW.discord_id := v_discord_id;
    -- Anti-escalade : seul un owner (ou le bot/service) peut créer un owner
    ELSIF NEW.role = 'owner'::user_role
          AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
          AND NOT public.is_owner() THEN
      NEW.role := 'client'::user_role;
    -- Verrouillage : un client non-admin ne peut insérer QUE role='client',
    -- discord_id = SON identité vérifiée (ou NULL), discord_roles vide
    ELSIF NOT public.is_strict_admin()
          AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin') THEN
      NEW.role := 'client'::user_role;
      NEW.discord_roles := '[]'::jsonb;
      NEW.discord_id := v_discord_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Changement de rôle / discord_roles / clé primaire ?
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.discord_roles IS DISTINCT FROM OLD.discord_roles
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      -- 4a. L'appelant doit être admin strict (owner/admin) ou service_role
      IF NOT public.is_strict_admin()
         AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin') THEN
        NEW.role := OLD.role;
        NEW.discord_roles := OLD.discord_roles;
        NEW.id := OLD.id;
      -- 4b. Toucher à un owner (le créer ou le rétrograder) : owner ou bot uniquement
      ELSIF (OLD.role = 'owner' OR NEW.role = 'owner')
            AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
            AND NOT public.is_owner() THEN
        NEW.role := OLD.role;
        NEW.discord_roles := OLD.discord_roles;
      END IF;
    END IF;

    -- 4c. Verrouillage du discord_id : un client ne peut le positionner QUE sur
    --     SON PROPRE identifiant Discord vérifié (auth.identities). Impossible
    --     d'usurper le discord_id d'un fondateur (via upsert ou metadata forgée).
    IF NEW.discord_id IS DISTINCT FROM OLD.discord_id
       AND NOT public.is_strict_admin()
       AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin') THEN
      IF NOT (NEW.id = auth.uid() AND v_discord_id IS NOT NULL AND NEW.discord_id = v_discord_id) THEN
        NEW.discord_id := OLD.discord_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS protect_role_change ON public.profiles;
CREATE TRIGGER protect_role_change
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_role_update();

-- ---------------------------------------------------------------------------
-- ÉTAPE 5 — Grants par colonne : les colonnes sensibles ne sont plus
--           modifiables en direct par authenticated (même un admin).
--           Le changement de rôle passe obligatoirement par la RPC
--           admin_set_role() ci-dessous (ou par le service_role du bot).
--           NB : `id` n'est PAS révoqué — l'upsert du frontend (ON CONFLICT DO
--           UPDATE SET id=...) l'exige ; la modification de la clé primaire est
--           de toute façon verrouillée par le trigger (branche 4a).
-- ---------------------------------------------------------------------------
REVOKE UPDATE (role, discord_roles) ON public.profiles FROM authenticated;

-- ---------------------------------------------------------------------------
-- ÉTAPE 6 — RPC admin_set_role : unique porte d'entrée du changement de rôle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_role(p_target_id UUID, p_new_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt JSONB;
  v_new_role user_role;
  v_current_role user_role;
BEGIN
  v_jwt := auth.jwt();

  -- Garde : service_role/bot OU admin strict (owner/admin)
  IF COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
     AND NOT public.is_strict_admin() THEN
    RAISE EXCEPTION 'Accès refusé : privilèges administrateur requis';
  END IF;

  -- Validation du rôle (rejette 'vip', inconnu de l'enum, etc.)
  BEGIN
    v_new_role := p_new_role::user_role;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Rôle invalide';
  END;

  SELECT role INTO v_current_role FROM public.profiles WHERE id = p_target_id;
  IF v_current_role IS NULL THEN
    RAISE EXCEPTION 'Profil introuvable';
  END IF;

  -- Seul un owner (ou le service_role/bot) peut créer ou rétrograder un owner
  IF v_current_role = 'owner' OR v_new_role = 'owner' THEN
    IF COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
       AND NOT public.is_owner() THEN
      RAISE EXCEPTION 'Accès refusé : seul le fondateur peut gérer le rôle fondateur';
    END IF;
  END IF;

  UPDATE public.profiles SET role = v_new_role WHERE id = p_target_id;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_role(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role(UUID, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ÉTAPE 7 — Suppression de comptes & logs : réservés aux admins stricts
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles
    FOR DELETE USING (public.is_strict_admin());

DROP POLICY IF EXISTS "logs_modify_admin" ON public.logs;
CREATE POLICY "logs_modify_admin" ON public.logs
    FOR UPDATE USING (public.is_strict_admin())
    WITH CHECK (public.is_strict_admin());

DROP POLICY IF EXISTS "logs_delete_admin" ON public.logs;
CREATE POLICY "logs_delete_admin" ON public.logs
    FOR DELETE USING (public.is_strict_admin());

-- ---------------------------------------------------------------------------
-- ÉTAPE 8 — Suppression du matching par nom complet (fuite de dossiers)
--           booking_belongs_to_caller : user_id OU discord_id du profil, PLUS
--           JAMAIS le full_name (modifiable librement par le client).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_belongs_to_caller(p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = p_booking_id
      AND (
        b.user_id = auth.uid()
        OR (
          b.discord_id IS NOT NULL
          AND b.discord_id IN (
            SELECT p.discord_id FROM public.profiles p
            WHERE p.id = auth.uid() AND p.discord_id IS NOT NULL
          )
        )
      )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.booking_belongs_to_caller(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_belongs_to_caller(UUID) TO authenticated, service_role;

-- Policy de lecture des bookings : plus de match par client_name
DROP POLICY IF EXISTS "bookings_select_owner_or_admin" ON public.bookings;
CREATE POLICY "bookings_select_owner_or_admin" ON public.bookings
    FOR SELECT USING (
        public.is_admin()
        OR user_id = auth.uid()
        OR (
            auth.uid() IS NOT NULL
            AND discord_id IS NOT NULL
            AND discord_id IN (SELECT p.discord_id FROM public.profiles p WHERE p.id = auth.uid() AND p.discord_id IS NOT NULL)
        )
    );

-- Policy de lecture des messages : alignée sur le helper (plus de full_name)
DROP POLICY IF EXISTS "booking_messages_select_member_or_admin" ON public.booking_messages;
CREATE POLICY "booking_messages_select_member_or_admin" ON public.booking_messages
    FOR SELECT USING (
        public.is_admin()
        OR (auth.uid() IS NOT NULL AND public.booking_belongs_to_caller(booking_id))
    );

-- ---------------------------------------------------------------------------
-- ÉTAPE 9 — Rôle 'vip' : l'UI admin le propose mais il n'existe pas dans l'enum
--           user_role -> toute tentative d'attribution échouait en erreur SQL.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'vip'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'vip';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ÉTAPE 10 — Insertion bookings : le discord_id fourni par le client doit être
--            LE SIEN (celui de son profil) ou NULL. Empêche d'usurper le
--            discord_id d'un autre (ex. fondateur) sur son propre dossier pour
--            des badges/liens frauduleux, et empêche d'écraser des champs.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bookings_insert_pending" ON public.bookings;
CREATE POLICY "bookings_insert_pending" ON public.bookings
    FOR INSERT WITH CHECK (
        (status = 'pending'
         AND length(trim(client_name)) > 0
         AND length(trim(item_name)) > 0
         AND (
             discord_id IS NULL
             OR discord_id IN (
                 SELECT p.discord_id FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.discord_id IS NOT NULL
             )
         ))
        OR public.is_admin()
    );

-- ---------------------------------------------------------------------------
-- ÉTAPE 11 — Détection & nettoyage des comptes fondateur déjà compromis
--            (les profils owner créés AVANT ce patch via un provider_id forgé
--            restent owner après le patch — à traiter manuellement).
-- ---------------------------------------------------------------------------
-- 11a. Inventaire : lister TOUS les profils owner avec leur discord_id.
--      Un fondateur légitime a toujours un discord_id présent dans trusted_founders.
SELECT id, discord_id, full_name, email, created_at
FROM public.profiles
WHERE role = 'owner'
ORDER BY created_at ASC;

-- 11b. À exécuter SEULEMENT après revue de la liste ci-dessus (SQL editor / service_role) :
--      rétrograde les profils owner qui ne correspondent à AUCUN fondateur légitime.
-- UPDATE public.profiles
-- SET role = 'client'
-- WHERE role = 'owner'
--   AND (discord_id IS NULL OR discord_id NOT IN (SELECT discord_id FROM public.trusted_founders));

-- ---------------------------------------------------------------------------
-- ÉTAPE 12 — Résidus gérants & RPC : le read PII et la gestion des rôles sont
--            réservés aux admins stricts ; create_booking ne fait plus confiance
--            au discord_id du client ; user_id verrouillé sur l'appelant.
-- ---------------------------------------------------------------------------

-- 12a. is_admin() : révoquer aussi PUBLIC (hygiène des grants)
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 12b. profiles : lecture/écriture PII des autres comptes = admins stricts
--      (les gérants gardent l'accès à leurs tables métier, plus aux profils/logs)
DROP POLICY IF EXISTS "profiles_select_owner_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_owner_or_admin" ON public.profiles
    FOR SELECT USING (id = auth.uid() OR public.is_strict_admin());

DROP POLICY IF EXISTS "profiles_insert_user" ON public.profiles;
CREATE POLICY "profiles_insert_user" ON public.profiles
    FOR INSERT WITH CHECK (id = auth.uid() OR public.is_strict_admin());

DROP POLICY IF EXISTS "profiles_update_owner_admin" ON public.profiles;
CREATE POLICY "profiles_update_owner_admin" ON public.profiles
    FOR UPDATE
    USING (id = auth.uid() OR public.is_strict_admin())
    WITH CHECK (id = auth.uid() OR public.is_strict_admin());

-- 12c. logs : lecture réservée aux admins stricts ; insertion réservée aux
--      utilisateurs authentifiés (falsification d'audit anonyme bloquée)
DROP POLICY IF EXISTS "logs_select_admin" ON public.logs;
CREATE POLICY "logs_select_admin" ON public.logs
    FOR SELECT USING (public.is_strict_admin());

DROP POLICY IF EXISTS "logs_insert_public" ON public.logs;
CREATE POLICY "logs_insert_authenticated" ON public.logs
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
        AND length(trim(action)) > 0
        AND length(trim(user_name)) > 0
    );

-- 12d. create_booking : le discord_id du dossier provient du PROFIL de
--      l'appelant (jamais du paramètre p_discord_id, forgeable par un anon).
CREATE OR REPLACE FUNCTION public.create_booking(
  p_item_name TEXT,
  p_type TEXT,
  p_client_name TEXT,
  p_discord_id TEXT,
  p_phone TEXT,
  p_dates TEXT,
  p_duration INT,
  p_amount TEXT,
  p_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking_id UUID;
    v_discord_id TEXT;
BEGIN
    -- SÉCURITÉ : discord_id résolu côté serveur depuis le profil (anon -> NULL)
    IF auth.uid() IS NOT NULL THEN
        SELECT p.discord_id INTO v_discord_id
        FROM public.profiles p
        WHERE p.id = auth.uid();
    END IF;

    INSERT INTO public.bookings (
        item_name,
        type,
        client_name,
        discord_id,
        phone,
        dates,
        duration,
        amount,
        notes,
        status,
        user_id
    ) VALUES (
        p_item_name,
        COALESCE(p_type, 'vehicule'),
        COALESCE(NULLIF(trim(p_client_name), ''), 'Citoyen'),
        v_discord_id,
        p_phone,
        p_dates,
        COALESCE(p_duration, 1),
        p_amount,
        p_notes,
        'pending',
        auth.uid()
    )
    RETURNING id INTO v_booking_id;

    RETURN v_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT) TO anon, authenticated, service_role;

-- 12e. bookings : user_id verrouillé sur l'appelant (anti-usurpation de dossier)
DROP POLICY IF EXISTS "bookings_insert_pending" ON public.bookings;
CREATE POLICY "bookings_insert_pending" ON public.bookings
    FOR INSERT WITH CHECK (
        (status = 'pending'
         AND length(trim(client_name)) > 0
         AND length(trim(item_name)) > 0
         AND (user_id = auth.uid() OR (user_id IS NULL AND auth.uid() IS NULL))
         AND (
             discord_id IS NULL
             OR discord_id IN (
                 SELECT p.discord_id FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.discord_id IS NOT NULL
             )
         ))
        OR public.is_admin()
    );

-- 12f. Suppression du bypass « sans claims » (auth.uid() IS NULL AND v_jwt IS NULL)
--      dans les lecteurs de dossiers : un appel sans JWT ne doit PLUS être traité
--      comme le service. Seul le role 'service_role'/'supabase_admin' du JWT
--      (clé service) bénéficie de l'accès complet.
CREATE OR REPLACE FUNCTION public.get_booking_details(p_booking_id UUID)
RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt JSON;
BEGIN
    v_jwt := auth.jwt();

    IF COALESCE(v_jwt ->> 'role', '') IN ('service_role', 'supabase_admin') THEN
        NULL; -- service_role (bot backend) : accès complet
    ELSIF public.is_admin() OR public.booking_belongs_to_caller(p_booking_id) THEN
        NULL; -- admin ou propriétaire du dossier
    ELSE
        RAISE EXCEPTION 'Accès refusé : ce dossier ne vous appartient pas';
    END IF;

    RETURN QUERY
    SELECT * FROM public.bookings b
    WHERE b.id = p_booking_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_booking_details(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_details(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_booking_messages(p_booking_id UUID)
RETURNS TABLE (
    id UUID,
    booking_id UUID,
    sender_name TEXT,
    sender_id TEXT,
    sender_role TEXT,
    content TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt JSON;
BEGIN
    -- Dossier inexistant -> résultat vide (pas d'oracle d'existence)
    IF NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = p_booking_id) THEN
        RETURN;
    END IF;

    v_jwt := auth.jwt();

    IF COALESCE(v_jwt ->> 'role', '') IN ('service_role', 'supabase_admin') THEN
        NULL; -- service_role (bot backend) : accès complet
    ELSIF public.is_admin() OR public.booking_belongs_to_caller(p_booking_id) THEN
        NULL; -- admin ou propriétaire du dossier
    ELSE
        RAISE EXCEPTION 'Accès refusé : ce dossier ne vous appartient pas';
    END IF;

    RETURN QUERY
    SELECT
        m.id,
        m.booking_id,
        m.sender_name,
        m.sender_id,
        m.sender_role,
        m.content,
        m.created_at
    FROM public.booking_messages m
    WHERE m.booking_id = p_booking_id
    ORDER BY m.created_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_booking_messages(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_messages(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- VÉRIFICATION POST-DÉPLOIEMENT
--
-- 1) Signup email avec un provider_id de fondateur forgé -> le profil créé doit
--    avoir role='client' (et discord_id NULL) :
--      POST {URL}/auth/v1/signup { email, password, data:{ provider_id:"985083967642423366" } }
--      -> GET /rest/v1/profiles?id=eq.<new_user_id>&select=role,discord_id  (via son JWT)
--      doit renvoyer role:"client", discord_id:null
-- 2) Un client (role client) qui PATCH son propre profil avec role='owner'
--    -> 42501 permission denied (grant colonne) ET/OU verrouillé par le trigger.
-- 3) Un gérant qui PATCH le rôle d'un autre -> 42501 / verrouillé.
-- 4) Un admin (non owner) qui appelle admin_set_role(target, 'owner') -> P0001
--    « seul le fondateur peut gérer le rôle fondateur ».
-- 5) Le fondateur (owner) appelle admin_set_role(target, 'admin') -> TRUE.
-- 6) Lecture de dossiers par full_name modifié -> plus aucun résultat
--    (seuls user_id / discord_id du profil matchent).
-- 7) Une fiche client éditée par le fondateur (ex. changement de nom) ne change
--    PAS le rôle de ce client (rôle verrouillé sauf admin_set_role).
-- 8) Un utilisateur Discord qui forge user_metadata.provider_id via
--    supabase.auth.updateUser({ data:{ provider_id:"985083967642423366" } })
--    puis PATCH son propre profil -> rôle inchangé (client) et discord_id
--    verrouillé : trusted_discord_id lit auth.identities, pas les métadonnées.
--
-- COTÉ CODE — DÉJÀ APPLIQUÉ (17/08/2026) :
--   a) bot/services/apiServer.js : isMaster calculé UNIQUEMENT depuis
--      profile.discord_id (base) ; resolveTokenDiscordId ignore les métadonnées
--      si l'utilisateur n'a pas d'identité Discord vérifiée.
--   b) src/modules/06-auth-oauth.ts : isMasterOwner = (verifiedRole === 'owner').
--   c) src/modules/03-admin-users.ts : addDiscordRole appelle la RPC admin_set_role.
--   d) src/modules/13-client-portal.ts : badge staff basé sur sender_role.
--   e) Optionnel (recommandé) : désactiver le provider Email dans
--      Supabase Dashboard > Authentication > Providers (l'inscription du site
--      passe uniquement par Discord OAuth).
-- ============================================================================
