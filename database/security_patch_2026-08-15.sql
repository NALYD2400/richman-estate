-- ==========================================================================
-- PATCH DE SÉCURITÉ — 15/08/2026
-- Richman Estate : durcissement RLS chat + rattachement fiable des dossiers
--
-- À EXÉCUTER DANS L'ÉDITEUR SQL SUPABASE (Dashboard > SQL Editor > New query)
-- Peut être relancé sans risque (idempotent).
--
-- Ce que ce patch corrige :
--   1. Les RPC add_booking_message / get_booking_messages étaient exécutables
--      par la clé anonyme et contournaient la RLS du chat -> révoquées pour anon.
--   2. Un anonyme pouvait usurper le rôle 'staff' via la RPC add_booking_message
--      -> garde anti-usurpation intégrée à la fonction.
--   3. N'importe qui pouvait insérer des messages dans N'IMPORTE QUEL dossier
--      (policy booking_messages_insert sans vérification de propriété)
--      -> propriété du dossier désormais obligatoire.
--   4. Les dossiers étaient rattachés aux clients uniquement par nom complet
--      (collision d'homonymes = fuite) -> colonne user_id fiable ajoutée.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- ÉTAPE 1 — Colonne user_id sur bookings (rattachement fiable des dossiers)
-- --------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Toute réservation créée par un utilisateur connecté est automatiquement
-- rattachée à son compte (les créations anonymes restent user_id = NULL).
ALTER TABLE public.bookings
  ALTER COLUMN user_id SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_bookings_user ON public.bookings(user_id);

-- --------------------------------------------------------------------------
-- ÉTAPE 2 — Helper : le dossier appartient-il à l'appelant ?
-- (user_id OU discord_id OU nom complet — aligné sur la policy de lecture)
-- --------------------------------------------------------------------------
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
        OR b.discord_id IN (
          SELECT p.discord_id FROM public.profiles p
          WHERE p.id = auth.uid() AND p.discord_id IS NOT NULL
        )
        OR b.client_name IN (
          SELECT p.full_name FROM public.profiles p WHERE p.id = auth.uid()
        )
      )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.booking_belongs_to_caller(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.booking_belongs_to_caller(UUID) TO authenticated;

-- --------------------------------------------------------------------------
-- ÉTAPE 3 — RPC add_booking_message : garde anti-usurpation staff
-- (seuls le service_role et les vrais admins peuvent signer 'staff')
-- --------------------------------------------------------------------------
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

    -- Anti-usurpation : un appelant anonyme/authentifié lambda ne peut PAS
    -- s'auto-promouvoir 'staff'. Sont autorisés : service_role (bot) et admins.
    v_jwt := auth.jwt();
    IF v_clean_role = 'staff'
       AND NOT public.is_admin()
       AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
       AND NOT (auth.uid() IS NULL AND v_jwt IS NULL)  -- clés service sb_secret_ sans claims
    THEN
        v_clean_role := 'client';
    END IF;

    INSERT INTO public.booking_messages (
        booking_id, sender_name, sender_id, sender_role, content
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

-- L'anonyme ne peut plus appeler les RPC du chat (le bot possède la clé service,
-- le web client utilise les tables Directes protégées par RLS).
REVOKE EXECUTE ON FUNCTION public.add_booking_message(UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_booking_message(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- ÉTAPE 4 — RPC get_booking_messages : lecture réservée au propriétaire/staff
-- --------------------------------------------------------------------------
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
    IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id) THEN
        RETURN;
    END IF;

    v_jwt := auth.jwt();

    -- service_role (bot backend) : accès complet
    IF COALESCE(v_jwt ->> 'role', '') IN ('service_role', 'supabase_admin')
       OR (auth.uid() IS NULL AND v_jwt IS NULL) THEN
        NULL;
    ELSIF public.is_admin() OR public.booking_belongs_to_caller(p_booking_id) THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'Accès refusé : ce dossier ne vous appartient pas';
    END IF;

    RETURN QUERY
    SELECT
        m.id, m.booking_id, m.sender_name, m.sender_id, m.sender_role, m.content, m.created_at
    FROM public.booking_messages m
    WHERE m.booking_id = p_booking_id
    ORDER BY m.created_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_booking_messages(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_booking_messages(UUID) TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- ÉTAPE 5 — RPC create_booking : rattache automatiquement user_id
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking(
  p_item_name TEXT, p_type TEXT, p_client_name TEXT, p_discord_id TEXT,
  p_phone TEXT, p_dates TEXT, p_duration INT, p_amount TEXT, p_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_booking_id UUID;
BEGIN
    INSERT INTO public.bookings (
        item_name, type, client_name, discord_id, phone,
        dates, duration, amount, notes, status, user_id
    ) VALUES (
        p_item_name,
        COALESCE(p_type, 'vehicule'),
        COALESCE(NULLIF(trim(p_client_name), ''), 'Citoyen'),
        p_discord_id,
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

-- --------------------------------------------------------------------------
-- ÉTAPE 6 — Policies durcies
-- --------------------------------------------------------------------------

-- 6a. Lecture bookings : ajoute le match fiable par user_id
DROP POLICY IF EXISTS "bookings_select_owner_or_admin" ON public.bookings;
CREATE POLICY "bookings_select_owner_or_admin" ON public.bookings
    FOR SELECT USING (
        public.is_admin()
        OR user_id = auth.uid()
        OR (
            auth.uid() IS NOT NULL
            AND (
                discord_id IN (SELECT discord_id FROM public.profiles WHERE id = auth.uid() AND discord_id IS NOT NULL)
                OR client_name IN (SELECT full_name FROM public.profiles WHERE id = auth.uid())
            )
        )
    );

-- 6b. Lecture messages : ajoute le match par user_id du dossier
DROP POLICY IF EXISTS "booking_messages_select_member_or_admin" ON public.booking_messages;
CREATE POLICY "booking_messages_select_member_or_admin" ON public.booking_messages
    FOR SELECT USING (
        public.is_admin()
        OR booking_id IN (
            SELECT b.id FROM public.bookings b
            WHERE auth.uid() IS NOT NULL AND (
                b.user_id = auth.uid()
                OR b.discord_id IN (SELECT p.discord_id FROM public.profiles p WHERE p.id = auth.uid() AND p.discord_id IS NOT NULL)
                OR b.client_name IN (SELECT p.full_name FROM public.profiles p WHERE p.id = auth.uid())
            )
        )
    );

-- 6c. Insertion messages : propriété du dossier OBLIGATOIRE (ferme l'IDOR)
DROP POLICY IF EXISTS "booking_messages_insert" ON public.booking_messages;
CREATE POLICY "booking_messages_insert" ON public.booking_messages
    FOR INSERT WITH CHECK (
        booking_id IS NOT NULL
        AND public.booking_exists(booking_id)
        AND length(trim(content)) > 0
        AND length(content) <= 4000
        AND (
            (sender_role <> 'staff' AND sender_role <> 'admin')
            OR public.is_admin()
        )
        AND (
            public.is_admin()
            OR public.booking_belongs_to_caller(booking_id)
        )
    );

-- ==========================================================================
-- VÉRIFICATION POST-PATCH (optionnel, à lancer dans l'éditeur SQL)
--
-- 1) L'anonyme ne doit plus pouvoir lire les messages d'un dossier :
--    -> devrait renvoyer une erreur 401/403 via l'API REST, et la fonction
--       n'est plus exécutable par anon.
-- 2) Vérifier les grants :
--    SELECT proname, proacl FROM pg_proc WHERE proname IN
--    ('add_booking_message','get_booking_messages','booking_belongs_to_caller');
-- 3) Vérifier la colonne :
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'bookings' AND column_name = 'user_id';
--
-- NOTE : le bot Discord DOIT posséder SUPABASE_SERVICE_ROLE_KEY dans bot/.env
-- (les RPC du chat ne sont plus accessibles avec la clé anonyme).
-- ==========================================================================
