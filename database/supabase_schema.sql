-- ==========================================================================
-- Richman Estate — Hardened Supabase Database Schema & Security RLS Policies
-- Security Audit Hardening & Anti-Privilege Escalation Protection
-- ==========================================================================

-- 1) Custom Enum Roles
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('owner', 'admin', 'gerant_hotel', 'gerant_vehicules', 'client');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2) User Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    discord_id TEXT UNIQUE,
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    rp_id TEXT,
    avatar_url TEXT,
    email TEXT,
    role user_role DEFAULT 'client'::user_role NOT NULL,
    discord_roles JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3) Vehicules Table (Fleet Inventory)
CREATE TABLE IF NOT EXISTS public.vehicules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price TEXT NOT NULL,
    specs TEXT,
    media_urls TEXT,
    status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'rented', 'pending')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4) Suites & Residences Table
CREATE TABLE IF NOT EXISTS public.suites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price TEXT NOT NULL,
    specs TEXT,
    category TEXT DEFAULT 'suite' CHECK (category IN ('suite', 'appartement', 'chambre', 'penthouse', 'villa', 'loft')),
    room_number TEXT,
    access_code TEXT,
    floor TEXT,
    media_urls TEXT,
    status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'rented', 'pending')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5) Bookings Table
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name TEXT NOT NULL,
    item_name TEXT NOT NULL,
    type TEXT CHECK (type IN ('vehicule', 'suite', 'appartement', 'chambre', 'penthouse', 'villa', 'loft')),
    amount TEXT NOT NULL,
    dates TEXT,
    duration TEXT,
    phone TEXT,
    notes TEXT,
    discord_id TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
    status TEXT DEFAULT 'pending' CHECK (status IN ('confirmed', 'pending', 'cancelled', 'closed', 'rented')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 6) Contact Messages Table (Concierge Inquiries)
CREATE TABLE IF NOT EXISTS public.contact_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    discord_id TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'treated', 'archived')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 7) Audit Logs Table (Security Audit Trail)
CREATE TABLE IF NOT EXISTS public.logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    user_name TEXT NOT NULL,
    type TEXT CHECK (type IN ('success', 'warning', 'danger', 'info')),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 8) Vehicle Reviews Table (Ratings & Verified Client Feedback)
CREATE TABLE IF NOT EXISTS public.vehicle_reviews (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES public.vehicules(id) ON DELETE CASCADE,
    vehicle_name TEXT NOT NULL,
    client_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    discord_id TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 9) Booking Messages Table (Chat Sync 4-Voies)
CREATE TABLE IF NOT EXISTS public.booking_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    sender_id TEXT,
    sender_role TEXT NOT NULL DEFAULT 'client' CHECK (sender_role IN ('client', 'staff', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==========================================================================
-- INDEXES FOR PERFORMANCE & INTEGRITY
-- ==========================================================================
CREATE INDEX IF NOT EXISTS idx_profiles_discord ON public.profiles(discord_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_vehicules_status ON public.vehicules(status);
CREATE INDEX IF NOT EXISTS idx_vehicules_created ON public.vehicules(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suites_status ON public.suites(status);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_discord ON public.bookings(discord_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON public.bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_messages_booking ON public.booking_messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_messages_created ON public.booking_messages(created_at ASC);
CREATE INDEX IF NOT EXISTS idx_contact_status ON public.contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_reviews_vehicle ON public.vehicle_reviews(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON public.logs(created_at DESC);

-- ==========================================================================
-- ROW LEVEL SECURITY (RLS) ACTIVATION
-- ==========================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- ==========================================================================
-- HELPER FUNCTION: IS ADMIN / OWNER / GERANT
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('owner', 'admin', 'gerant_hotel', 'gerant_vehicules')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Helper to verify booking existence securely across RLS boundaries
CREATE OR REPLACE FUNCTION public.booking_exists(p_booking_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.bookings
    WHERE id = p_booking_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.booking_exists(UUID) TO anon, authenticated;

-- Helper to safely load booking details by ID (bypassing RLS for service queries)
-- Garde d'autorisation : service_role (bot), admin, ou propriétaire du dossier uniquement
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

-- Ownership check for booking conversations (used by chat policies & RPC)
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

-- NB : PUBLIC doit être révoqué aussi — anon hérite du grant EXECUTE par défaut de PUBLIC
REVOKE EXECUTE ON FUNCTION public.booking_belongs_to_caller(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_belongs_to_caller(UUID) TO authenticated, service_role;

-- Secure message dispatcher for Discord Bot & Cross-Platform Sync
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

    -- Anti-usurpation : seuls le service_role (bot) et les admins peuvent signer 'staff'
    v_jwt := auth.jwt();
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

-- Anonyme exclu : le web client passe par les tables (RLS), le bot par la clé service
REVOKE EXECUTE ON FUNCTION public.add_booking_message(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_booking_message(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Secure booking creator across RLS boundaries
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
BEGIN
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

GRANT EXECUTE ON FUNCTION public.create_booking TO anon, authenticated, service_role;

-- Secure booking status updater across RLS boundaries
CREATE OR REPLACE FUNCTION public.update_booking_status(
  p_booking_id UUID,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt JSONB;
BEGIN
    IF p_status NOT IN ('pending', 'confirmed', 'cancelled') THEN
        RAISE EXCEPTION 'Statut de réservation invalide';
    END IF;

    -- Seuls les administrateurs ou le service_role (bot) peuvent modifier le statut
    v_jwt := auth.jwt();
    IF NOT public.is_admin()
       AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
       AND NOT (auth.uid() IS NULL AND v_jwt IS NULL)
    THEN
        RAISE EXCEPTION 'Action non autorisée : privilèges administrateur requis';
    END IF;

    UPDATE public.bookings
    SET status = p_status
    WHERE id = p_booking_id;

    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_booking_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_booking_status(UUID, TEXT) TO authenticated, service_role;

-- Item status synchronizer (flotte & suites) — garde staff/bot obligatoire :
-- sans elle, n'importe qui pouvait basculer le statut (confirmed/rented) du catalogue
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

-- Secure message reader across RLS boundaries (owner / admin / service_role only)
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

-- ==========================================================================
-- CLEAN DROP OF PREVIOUS POLICIES
-- ==========================================================================
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename IN ('profiles', 'vehicules', 'suites', 'bookings', 'booking_messages', 'contact_messages', 'vehicle_reviews', 'logs')
    ) 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- ==========================================================================
-- POLICIES DEFINITION
-- ==========================================================================

-- 1. PROFILES POLICIES
-- Authenticated users can view their own profile; administrators can view all
CREATE POLICY "profiles_select_owner_or_admin" ON public.profiles
    FOR SELECT USING (id = auth.uid() OR public.is_admin());

-- Authenticated users can insert their own profile
CREATE POLICY "profiles_insert_user" ON public.profiles
    FOR INSERT WITH CHECK (id = auth.uid() OR public.is_admin());

-- Users can only update their own profile; admins can update any
CREATE POLICY "profiles_update_owner_admin" ON public.profiles
    FOR UPDATE 
    USING (id = auth.uid() OR public.is_admin())
    WITH CHECK (id = auth.uid() OR public.is_admin());

-- Only admins can delete user profiles
CREATE POLICY "profiles_delete_admin" ON public.profiles
    FOR DELETE USING (public.is_admin());

-- 2. VEHICULES POLICIES
-- Public catalog reading
CREATE POLICY "vehicules_select_public" ON public.vehicules
    FOR SELECT USING (true);

-- Only administrators can modify the fleet catalog
CREATE POLICY "vehicules_admin_all" ON public.vehicules
    FOR ALL USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 3. SUITES & RESIDENCES POLICIES
-- access_code (digicode) : illisible en SELECT direct pour anon ET authenticated (grant par colonne).
-- Les administrateurs la récupèrent via la RPC staff get_suite_access_codes ; le bot via service_role.
REVOKE ALL ON public.suites FROM anon, authenticated;
GRANT SELECT (id, name, price, specs, status, created_at, room_number, category, floor, media_urls)
    ON public.suites TO anon, authenticated;
GRANT INSERT (id, name, price, specs, status, created_at, room_number, category, floor, media_urls, access_code)
    ON public.suites TO authenticated;
GRANT UPDATE (id, name, price, specs, status, created_at, room_number, category, floor, media_urls, access_code)
    ON public.suites TO authenticated;
GRANT DELETE ON public.suites TO authenticated;
GRANT ALL ON public.suites TO service_role;

CREATE POLICY "suites_select_public" ON public.suites
    FOR SELECT USING (true);

-- Only administrators can modify suites catalog
CREATE POLICY "suites_admin_all" ON public.suites
    FOR ALL USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Staff-only digicode reader for the admin web UI (empty result for non-admins)
CREATE OR REPLACE FUNCTION public.get_suite_access_codes()
RETURNS TABLE (suite_id UUID, access_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT s.id, s.access_code FROM public.suites s
    ORDER BY s.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_suite_access_codes() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_suite_access_codes() TO authenticated, service_role;

-- 4. BOOKINGS POLICIES
-- Authenticated booking owner or administrators can read bookings
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

-- Public creation strictly restricted to status 'pending' with non-empty item and client name
CREATE POLICY "bookings_insert_pending" ON public.bookings
    FOR INSERT WITH CHECK (
        (status = 'pending' AND length(trim(client_name)) > 0 AND length(trim(item_name)) > 0)
        OR public.is_admin()
    );

-- Only administrators can update booking status, pricing or details
CREATE POLICY "bookings_update_admin" ON public.bookings
    FOR UPDATE USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Only administrators can delete bookings (backdoors removed)
CREATE POLICY "bookings_delete_admin" ON public.bookings
    FOR DELETE USING (public.is_admin());

-- 5. BOOKING MESSAGES POLICIES (Chat Sync 4-Voies)
-- Only booking participants or administrators can read booking messages
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

-- Insertion restricted to the booking owner or admins, with sanitized content and anti-spoofing
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

-- Only administrators can update booking messages
CREATE POLICY "booking_messages_update_admin" ON public.booking_messages
    FOR UPDATE USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Only administrators can delete messages (backdoors removed)
CREATE POLICY "booking_messages_delete_admin" ON public.booking_messages
    FOR DELETE USING (public.is_admin());

-- 6. CONTACT MESSAGES POLICIES (Concierge Requests)
-- Only administrators can read private client inquiries
CREATE POLICY "contact_select_admin" ON public.contact_messages
    FOR SELECT USING (public.is_admin());

-- Anyone can submit a contact inquiry with status 'pending'
CREATE POLICY "contact_insert_public" ON public.contact_messages
    FOR INSERT WITH CHECK (
        status = 'pending'
        AND length(trim(name)) > 0
        AND length(trim(message)) > 0
    );

-- Only administrators can update inquiry status ('treated', 'archived')
CREATE POLICY "contact_update_admin" ON public.contact_messages
    FOR UPDATE USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Only administrators can delete contact inquiries
CREATE POLICY "contact_delete_admin" ON public.contact_messages
    FOR DELETE USING (public.is_admin());

-- 7. VEHICLE REVIEWS POLICIES
-- Public can read verified vehicle reviews
CREATE POLICY "reviews_select_public" ON public.vehicle_reviews
    FOR SELECT USING (true);

-- Anyone can submit a rating (1 to 5) for an existing vehicle
CREATE POLICY "reviews_insert_public" ON public.vehicle_reviews
    FOR INSERT WITH CHECK (
        vehicle_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.vehicules v WHERE v.id = vehicle_id)
        AND rating >= 1 AND rating <= 5
        AND length(trim(client_name)) > 0
    );

-- Only administrators can update or moderate reviews
CREATE POLICY "reviews_update_admin" ON public.vehicle_reviews
    FOR UPDATE USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Only administrators can delete reviews
CREATE POLICY "reviews_delete_admin" ON public.vehicle_reviews
    FOR DELETE USING (public.is_admin());

-- 8. AUDIT LOGS POLICIES
-- Only administrators can read audit logs
CREATE POLICY "logs_select_admin" ON public.logs
    FOR SELECT USING (public.is_admin());

-- Allow clients and backend system to append immutable audit events
CREATE POLICY "logs_insert_public" ON public.logs
    FOR INSERT WITH CHECK (
        length(trim(action)) > 0 
        AND length(trim(user_name)) > 0
    );

-- Only administrators can manage logs
CREATE POLICY "logs_modify_admin" ON public.logs
    FOR UPDATE USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "logs_delete_admin" ON public.logs
    FOR DELETE USING (public.is_admin());

-- ==========================================================================
-- ==========================================================================
-- PRIVILEGE ESCALATION PROTECTION TRIGGER
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.protect_role_update()
RETURNS TRIGGER AS $$
DECLARE
  v_jwt JSONB;
  v_discord_id TEXT;
BEGIN
  v_jwt := auth.jwt();
  v_discord_id := COALESCE(
    v_jwt -> 'user_metadata' ->> 'provider_id',
    v_jwt -> 'user_metadata' ->> 'sub',
    v_jwt ->> 'sub'
  );

  -- Anti-escalation on INSERT
  IF TG_OP = 'INSERT' THEN
    IF v_discord_id IN ('985083967642423366', '1015310406169923665') THEN
      NEW.role := 'owner'::user_role;
    ELSIF NOT public.is_admin() AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin') THEN
      NEW.role := 'client'::user_role;
      NEW.discord_roles := '[]'::jsonb;
    END IF;
  -- Anti-escalation on UPDATE
  ELSIF TG_OP = 'UPDATE' THEN
    IF v_discord_id IN ('985083967642423366', '1015310406169923665') THEN
      NEW.role := 'owner'::user_role;
    ELSIF NOT public.is_admin() AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin') THEN
      -- Lock role to existing OLD value
      IF OLD.role IS DISTINCT FROM NEW.role THEN
        NEW.role := OLD.role;
      END IF;
      -- Lock discord_roles to existing OLD value
      IF OLD.discord_roles IS DISTINCT FROM NEW.discord_roles THEN
        NEW.discord_roles := OLD.discord_roles;
      END IF;
      -- Lock primary key id
      IF OLD.id IS DISTINCT FROM NEW.id THEN
        NEW.id := OLD.id;
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

-- ==========================================================================
-- AUTOMATIC AUTH USER PROFILE INITIALIZATION TRIGGER
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_discord_id TEXT;
  v_avatar_url TEXT;
  v_name TEXT;
  v_rp_id TEXT;
  v_role user_role := 'client'::user_role;
BEGIN
  v_discord_id := COALESCE(
    NEW.raw_user_meta_data->>'provider_id',
    NEW.raw_user_meta_data->>'sub'
  );
  
  IF v_discord_id IN ('985083967642423366', '1015310406169923665') THEN
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
    role = CASE WHEN EXCLUDED.discord_id IN ('985083967642423366', '1015310406169923665') THEN 'owner'::user_role ELSE public.profiles.role END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
