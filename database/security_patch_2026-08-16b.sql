-- ============================================================================
-- PATCH SÉCURITÉ B — 16/08/2026 (11ᵉ passe, complément après vérification live)
-- À exécuter dans l'éditeur SQL Supabase (jeu de la base de production).
--
-- CONSTAT À L'ORIGINE DE CE PATCH :
--   `REVOKE EXECUTE ... FROM anon` est INEFFICACE si PUBLIC conserve le grant
--   par défaut (anon hérite de PUBLIC). Vérifié en live : update_booking_status,
--   add_booking_message, get_booking_messages, booking_belongs_to_caller et
--   sync_item_status s'exécutent toujours côté anonyme (bloquées seulement par
--   les gardes internes, quand elles existent — sync_item_status n'en a AUCUNE :
--   un anonyme peut basculer le statut de n'importe quel véhicule/suite).
--
--   Ce patch révoque PUBLIC, ajoute la garde manquante, et corrige au passage
--   le bug 42702 de get_booking_messages (ambiguïté variable/colonne « id »).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Révocation effective de l'exécution anonyme (PUBLIC + anon)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.update_booking_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_booking_status(UUID, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.add_booking_message(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_booking_message(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_booking_messages(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_messages(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.booking_belongs_to_caller(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_belongs_to_caller(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1bis. get_booking_details : accordée à anon SANS garde (vérifié live : 200)
--       → n'importe qui lit un dossier complet (nom, téléphone, discord_id,
--       notes, dates) en connaissant l'UUID. Ajout de la garde + révocation.
-- ---------------------------------------------------------------------------
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

    IF COALESCE(v_jwt ->> 'role', '') IN ('service_role', 'supabase_admin')
       OR (auth.uid() IS NULL AND v_jwt IS NULL) THEN
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

-- sync_item_status : signature non documentée dans le dépôt — révocation
-- dynamique sur TOUTES ses surcharges éventuelles, sans hypothèse de signature.
DO $$
DECLARE fn TEXT;
BEGIN
    FOR fn IN
        SELECT oid::regprocedure::text
        FROM pg_proc
        WHERE proname = 'sync_item_status'
          AND pronamespace = 'public'::regnamespace
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
    END LOOP;
END
$$;

DROP FUNCTION IF EXISTS public.sync_item_status(TEXT, UUID, TEXT);

-- ---------------------------------------------------------------------------
-- 2. sync_item_status : garde d'autorisation manquante (CRITIQUE)
--    Un anonyme/authentifié lambda pouvait changer le statut (confirmed/rented)
--    de n'importe quel véhicule ou suite du catalogue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_item_status(p_type TEXT, p_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt JSONB;
    v_table TEXT;
BEGIN
    -- Seuls les administrateurs et le service_role (bot) peuvent modifier le statut
    v_jwt := auth.jwt();
    IF NOT public.is_admin()
       AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
       AND NOT (auth.uid() IS NULL AND v_jwt IS NULL)
    THEN
        RAISE EXCEPTION 'Action non autorisée : privilèges administrateur requis';
    END IF;

    v_table := CASE
        WHEN p_type IN ('fleet', 'vehicule', 'vehicules') THEN 'vehicules'
        WHEN p_type IN ('suites', 'suite', 'hotel') THEN 'suites'
        ELSE NULL
    END;

    IF v_table IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Type d''item inconnu');
    END IF;

    IF p_status NOT IN ('confirmed', 'rented') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Statut invalide');
    END IF;

    EXECUTE format('UPDATE public.%I SET status = $1 WHERE id = $2', v_table)
        USING p_status, p_id;

    RETURN jsonb_build_object(
        'id', p_id,
        'type', CASE WHEN v_table = 'vehicules' THEN 'fleet' ELSE 'suite' END,
        'status', p_status,
        'success', true
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_item_status(TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_item_status(TEXT, UUID, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. get_booking_messages : correction du bug 42702
--    « WHERE id = p_booking_id » était ambigu (variable OUT « id » vs colonne) —
--    la fonction plantait pour TOUS les appelants, y compris le bot.
-- ---------------------------------------------------------------------------
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

    IF COALESCE(v_jwt ->> 'role', '') IN ('service_role', 'supabase_admin')
       OR (auth.uid() IS NULL AND v_jwt IS NULL) THEN
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
-- 4. add_booking_message : contrôle de propriété du dossier (faille moyenne
--    de la 9ᵉ passe : un authentifié pouvait écrire dans le dossier d'un tiers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_booking_message(
    p_booking_id UUID,
    p_sender_name TEXT,
    p_sender_id TEXT,
    p_sender_role TEXT,
    p_content TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_msg_id UUID;
    v_clean_role TEXT;
    v_jwt JSON;
BEGIN
    IF p_booking_id IS NULL OR NOT public.booking_exists(p_booking_id) THEN
        RAISE EXCEPTION 'Booking % does not exist', p_booking_id;
    END IF;

    IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
        RAISE EXCEPTION 'Message content cannot be empty';
    END IF;

    v_clean_role := CASE WHEN p_sender_role = 'staff' OR p_sender_role = 'admin' THEN 'staff' ELSE 'client' END;

    v_jwt := auth.jwt();

    -- Anti-usurpation : seuls le service_role (bot) et les admins peuvent signer 'staff'
    IF v_clean_role = 'staff'
       AND NOT public.is_admin()
       AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
       AND NOT (auth.uid() IS NULL AND v_jwt IS NULL)
    THEN
        v_clean_role := 'client';
    END IF;

    -- Anti-IDOR : hors bot/admins, on ne peut écrire que dans son propre dossier
    IF COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
       AND NOT (auth.uid() IS NULL AND v_jwt IS NULL)
       AND NOT public.is_admin()
       AND NOT public.booking_belongs_to_caller(p_booking_id)
    THEN
        RAISE EXCEPTION 'Accès refusé : ce dossier ne vous appartient pas';
    END IF;

    INSERT INTO public.booking_messages (
        booking_id,
        sender_name,
        sender_id,
        sender_role,
        content
    ) VALUES (
        p_booking_id,
        COALESCE(NULLIF(trim(p_sender_name), ''), 'Citoyen'),
        p_sender_id,
        v_clean_role,
        substring(trim(p_content) from 1 for 4000)
    )
    RETURNING id INTO v_msg_id;

    RETURN v_msg_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_booking_message(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_booking_message(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ============================================================================
-- VÉRIFICATION POST-DÉPLOIEMENT (clé anon — tout doit être refusé au niveau
-- PERMISSION, c.-à-d. 401/42501 « permission denied », et non une erreur P0001) :
--   POST /rest/v1/rpc/update_booking_status → 42501 permission denied
--   POST /rest/v1/rpc/add_booking_message   → 42501 permission denied
--   POST /rest/v1/rpc/get_booking_messages  → 42501 permission denied
--   POST /rest/v1/rpc/get_booking_details   → 42501 permission denied
--   POST /rest/v1/rpc/booking_belongs_to_caller → 42501 permission denied
--   POST /rest/v1/rpc/sync_item_status      → 42501 permission denied
--   GET  /rest/v1/suites?select=*           → 42501 (catalogue via colonnes explicites)
-- ============================================================================
