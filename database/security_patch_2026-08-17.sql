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
--   * Le statut « fondateur » n'est reconnu QUE pour un compte créé par OAuth
--     Discord (app_metadata.provider='discord', contrôlé par le serveur),
--     jamais depuis des métadonnées d'un compte email.
--   * La liste des fondateurs est déplacée dans une table trusted_founders
--     fermée (aucune policy pour anon/authenticated), pilotée par service_role.
--   * La gestion des rôles passe par une RPC dédiée admin_set_role()
--     (SECURITY DEFINER) : seuls owner/admin y ont droit, et seul un owner
--     (ou le service_role) peut créer/rétrograder un owner.
--   * Les colonnes sensibles (role, discord_roles, id) ne sont plus modifiables
--     en direct par authenticated ; le trigger verrouille aussi discord_id.
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
-- ÉTAPE 2 — Helpers de hiérarchie stricte
-- ---------------------------------------------------------------------------

-- L'appelant est-il un utilisateur créé par OAuth Discord ?
-- (app_metadata est écrit par GoTrue/Supabase, PAS par le client)
CREATE OR REPLACE FUNCTION public.is_discord_oauth(v_jwt JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN COALESCE(v_jwt -> 'app_metadata' ->> 'provider', '') = 'discord'
      OR COALESCE(v_jwt -> 'app_metadata' ->> 'providers', '[]')::text LIKE '%"discord"%';
END;
$$;

-- discord_id de confiance : uniquement si OAuth Discord (sinon NULL)
CREATE OR REPLACE FUNCTION public.trusted_discord_id(v_jwt JSONB)
RETURNS TEXT
LANGUAGE plpgsql STABLE
AS $$
DECLARE v_id TEXT;
BEGIN
  IF NOT public.is_discord_oauth(v_jwt) THEN
    RETURN NULL;
  END IF;
  RETURN COALESCE(
    v_jwt -> 'user_metadata' ->> 'provider_id',
    v_jwt -> 'user_metadata' ->> 'sub',
    v_jwt ->> 'sub'
  );
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

  -- discord_id N'EST JAMAIS lu dans les métadonnées d'un compte non-Discord
  v_discord_id := CASE WHEN v_is_discord THEN
      COALESCE(NEW.raw_user_meta_data->>'provider_id', NEW.raw_user_meta_data->>'sub')
    ELSE NULL END;

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
  -- NULL si l'appelant n'est PAS un compte OAuth Discord (email, etc.)
  v_discord_id := public.trusted_discord_id(v_jwt);

  IF TG_OP = 'INSERT' THEN
    -- Auto-promotion fondateur : uniquement pour SA PROPRE ligne et si le
    -- discord_id provient d'un OAuth Discord vérifié présent dans la whitelist
    IF NEW.id = auth.uid()
       AND v_discord_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.trusted_founders f WHERE f.discord_id = v_discord_id)
    THEN
      NEW.role := 'owner'::user_role;
    ELSIF NOT public.is_strict_admin()
          AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin') THEN
      NEW.role := 'client'::user_role;
      NEW.discord_roles := '[]'::jsonb;
      -- Jamais de discord_id fourni par un client non-Discord
      IF v_discord_id IS NULL THEN
        NEW.discord_id := NULL;
      END IF;
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

    -- 4c. Verrouillage du discord_id : un client non-OAuth ne peut pas se
    --     forger un discord_id (ex. l'ID d'un fondateur) via l'upsert du front
    IF v_discord_id IS NULL
       AND NEW.discord_id IS DISTINCT FROM OLD.discord_id
       AND NOT public.is_strict_admin()
       AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin') THEN
      NEW.discord_id := OLD.discord_id;
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
-- ---------------------------------------------------------------------------
REVOKE UPDATE (role, discord_roles, id) ON public.profiles FROM authenticated;

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
--
-- COTÉ CODE À APPLIQUER ÉGALEMENT (hors SQL) :
--   a) bot/services/apiServer.js  ~l.166-168 : retirer la confiance sur
--      user.user_metadata.provider_id dans le calcul de isMaster. Garder
--      uniquement : profile.discord_id IN (MASTER_IDS) (le profile est lu en base).
--   b) src/modules/06-auth-oauth.ts : isMasterOwner doit dépendre du rôle en base
--      (verifiedRole === 'owner'), plus des métadonnées user_metadata.provider_id.
--   c) src/modules/03-admin-users.ts  addDiscordRole : remplacer
--      supabaseClient.from("profiles").update({ role }) par
--      supabaseClient.rpc("admin_set_role", { p_target_id: userId, p_new_role: roleKey }).
--   d) Optionnel (recommandé) : désactiver le provider Email dans
--      Supabase Dashboard > Authentication > Providers (l'inscription du site
--      passe uniquement par Discord OAuth).
-- ============================================================================
