-- ==========================================================================
-- Richman Estate — Hardened Supabase Database Schema & Security RLS Policies
-- Security Audit Hardening & Anti-Privilege Escalation Protection
-- ==========================================================================

-- 1) Custom Enum Roles
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('owner', 'admin', 'gerant_hotel', 'gerant_vehicules', 'vip', 'client');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2) Trusted Founders Whitelist Table (Closed to client access)
CREATE TABLE IF NOT EXISTS public.trusted_founders (
    discord_id TEXT PRIMARY KEY,
    added_by   TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.trusted_founders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trusted_founders FROM anon, authenticated;
GRANT ALL ON public.trusted_founders TO service_role;

INSERT INTO public.trusted_founders (discord_id, added_by) VALUES
    ('985083967642423366', 'system'),
    ('1015310406169923665', 'system')
ON CONFLICT (discord_id) DO NOTHING;

-- 3) User Profiles Table
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

-- 4) Vehicules Table (Fleet Inventory)
CREATE TABLE IF NOT EXISTS public.vehicules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price TEXT NOT NULL,
    specs TEXT,
    media_urls TEXT,
    status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'rented', 'pending')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5) Suites & Residences Table
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

-- 6) Bookings Table
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

-- 7) Contact Messages Table (Concierge Inquiries)
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

-- 8) Audit Logs Table (Security Audit Trail)
CREATE TABLE IF NOT EXISTS public.logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    user_name TEXT NOT NULL,
    type TEXT CHECK (type IN ('success', 'warning', 'danger', 'info')),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 9) Vehicle Reviews Table (Ratings & Verified Client Feedback)
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

-- 10) Booking Messages Table (Chat Sync 4-Voies)
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
ALTER TABLE public.trusted_founders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- ==========================================================================
-- HELPER FUNCTIONS: ROLES & IDENTITY RESOLUTION
-- ==========================================================================

-- Verified Discord ID from auth.identities (GoTrue OAuth, tamper-proof)
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

-- Only owner role (founder)
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner');
$$;

-- Strict admin: owner OR admin (user management, roles, security logs)
CREATE OR REPLACE FUNCTION public.is_strict_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'admin'));
$$;

-- Operational admin (owner, admin, gerant_hotel, gerant_vehicules) for business ops
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

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
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

-- Ownership check for booking conversations (user_id OR verified discord_id only, no full_name spoofing)
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

-- Helper to safely load booking details by ID
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
        NULL; -- service_role (bot backend) : full access
    ELSIF public.is_admin() OR public.booking_belongs_to_caller(p_booking_id) THEN
        NULL; -- admin or booking owner
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

    -- Anti-spoofing: only service_role (bot) and operational admins can sign 'staff'
    v_jwt := auth.jwt();
    IF v_clean_role = 'staff'
       AND NOT public.is_admin()
       AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
    THEN
        v_clean_role := 'client';
    END IF;

    -- Anti-IDOR: caller must own the booking, or be admin/bot
    IF COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
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

-- Secure booking creator with server-side discord_id resolution
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

    v_jwt := auth.jwt();
    IF NOT public.is_admin()
       AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
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

-- Item status synchronizer (flotte & suites)
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
    v_jwt := auth.jwt();
    IF NOT public.is_admin()
       AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
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

-- Secure message reader across RLS boundaries
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
    IF NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = p_booking_id) THEN
        RETURN;
    END IF;

    v_jwt := auth.jwt();

    IF COALESCE(v_jwt ->> 'role', '') IN ('service_role', 'supabase_admin') THEN
        NULL; -- service_role (bot backend) : full access
    ELSIF public.is_admin() OR public.booking_belongs_to_caller(p_booking_id) THEN
        NULL; -- admin or booking owner
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

-- Dedicated Role Management RPC (Security Gate)
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

  -- Guard: service_role/bot OR strict admin (owner/admin)
  IF COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
     AND NOT public.is_strict_admin() THEN
    RAISE EXCEPTION 'Accès refusé : privilèges administrateur requis';
  END IF;

  -- Validate role enum
  BEGIN
    v_new_role := p_new_role::user_role;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Rôle invalide';
  END;

  SELECT role INTO v_current_role FROM public.profiles WHERE id = p_target_id;
  IF v_current_role IS NULL THEN
    RAISE EXCEPTION 'Profil introuvable';
  END IF;

  -- Only owner (or service_role/bot) can create or demote an owner
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
          AND tablename IN ('profiles', 'trusted_founders', 'vehicules', 'suites', 'bookings', 'booking_messages', 'contact_messages', 'vehicle_reviews', 'logs')
    ) 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- ==========================================================================
-- POLICIES DEFINITION
-- ==========================================================================

-- 1. PROFILES POLICIES
-- Authenticated users can view their own profile; strict administrators can view all
CREATE POLICY "profiles_select_owner_or_admin" ON public.profiles
    FOR SELECT USING (id = auth.uid() OR public.is_strict_admin());

-- Authenticated users can insert their own profile
CREATE POLICY "profiles_insert_user" ON public.profiles
    FOR INSERT WITH CHECK (id = auth.uid() OR public.is_strict_admin());

-- Users can only update their own profile; strict admins can update any
CREATE POLICY "profiles_update_owner_admin" ON public.profiles
    FOR UPDATE 
    USING (id = auth.uid() OR public.is_strict_admin())
    WITH CHECK (id = auth.uid() OR public.is_strict_admin());

-- Only strict admins can delete user profiles
CREATE POLICY "profiles_delete_admin" ON public.profiles
    FOR DELETE USING (public.is_strict_admin());

-- Column grants: direct role and discord_roles updates revoked from authenticated
REVOKE UPDATE (role, discord_roles) ON public.profiles FROM authenticated;

-- 2. VEHICULES POLICIES
-- Public catalog reading
CREATE POLICY "vehicules_select_public" ON public.vehicules
    FOR SELECT USING (true);

-- Only operational administrators can modify the fleet catalog
CREATE POLICY "vehicules_admin_all" ON public.vehicules
    FOR ALL USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 3. SUITES & RESIDENCES POLICIES
-- access_code (digicode): hidden from direct SELECT for anon & authenticated.
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

-- Only operational administrators can modify suites catalog
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
-- Authenticated booking owner or operational administrators can read bookings
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

-- Public creation strictly restricted to status 'pending', non-empty fields, locking user_id & discord_id
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

-- Only operational administrators can update booking status, pricing or details
CREATE POLICY "bookings_update_admin" ON public.bookings
    FOR UPDATE USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Only operational administrators can delete bookings
CREATE POLICY "bookings_delete_admin" ON public.bookings
    FOR DELETE USING (public.is_admin());

-- 5. BOOKING MESSAGES POLICIES (Chat Sync 4-Voies)
-- Only booking participants or operational administrators can read booking messages
CREATE POLICY "booking_messages_select_member_or_admin" ON public.booking_messages
    FOR SELECT USING (
        public.is_admin()
        OR (auth.uid() IS NOT NULL AND public.booking_belongs_to_caller(booking_id))
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

-- Only operational administrators can update booking messages
CREATE POLICY "booking_messages_update_admin" ON public.booking_messages
    FOR UPDATE USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Only operational administrators can delete messages
CREATE POLICY "booking_messages_delete_admin" ON public.booking_messages
    FOR DELETE USING (public.is_admin());

-- 6. CONTACT MESSAGES POLICIES (Concierge Requests)
-- Only operational administrators can read private client inquiries
CREATE POLICY "contact_select_admin" ON public.contact_messages
    FOR SELECT USING (public.is_admin());

-- Anyone can submit a contact inquiry with status 'pending'
CREATE POLICY "contact_insert_public" ON public.contact_messages
    FOR INSERT WITH CHECK (
        status = 'pending'
        AND length(trim(name)) > 0
        AND length(trim(message)) > 0
    );

-- Only operational administrators can update inquiry status ('treated', 'archived')
CREATE POLICY "contact_update_admin" ON public.contact_messages
    FOR UPDATE USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Only operational administrators can delete contact inquiries
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

-- Only operational administrators can update or moderate reviews
CREATE POLICY "reviews_update_admin" ON public.vehicle_reviews
    FOR UPDATE USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Only operational administrators can delete reviews
CREATE POLICY "reviews_delete_admin" ON public.vehicle_reviews
    FOR DELETE USING (public.is_admin());

-- 8. AUDIT LOGS POLICIES
-- Only strict administrators can read audit logs
CREATE POLICY "logs_select_admin" ON public.logs
    FOR SELECT USING (public.is_strict_admin());

-- Insertion restricted to authenticated users (prevents forged anonymous audit trail)
CREATE POLICY "logs_insert_authenticated" ON public.logs
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
        AND length(trim(action)) > 0 
        AND length(trim(user_name)) > 0
    );

-- Only strict administrators can modify or delete logs
CREATE POLICY "logs_modify_admin" ON public.logs
    FOR UPDATE USING (public.is_strict_admin())
    WITH CHECK (public.is_strict_admin());

CREATE POLICY "logs_delete_admin" ON public.logs
    FOR DELETE USING (public.is_strict_admin());

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
  v_discord_id := public.trusted_discord_id(auth.uid());

  IF TG_OP = 'INSERT' THEN
    -- Internal GoTrue trigger context: no request JWT, let handle_new_user handle it
    IF auth.uid() IS NULL AND v_jwt IS NULL THEN
      NULL;
    -- Founder auto-promotion: caller's own row + verified Discord identity in whitelist
    ELSIF NEW.id = auth.uid()
          AND v_discord_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.trusted_founders f WHERE f.discord_id = v_discord_id)
    THEN
      NEW.role := 'owner'::user_role;
      NEW.discord_id := v_discord_id;
    -- Anti-escalation: only an owner (or service/bot) can create an owner
    ELSIF NEW.role = 'owner'::user_role
          AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
          AND NOT public.is_owner() THEN
      NEW.role := 'client'::user_role;
    -- Non-admin clients can only insert role='client', own verified discord_id, empty discord_roles
    ELSIF NOT public.is_strict_admin()
          AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin') THEN
      NEW.role := 'client'::user_role;
      NEW.discord_roles := '[]'::jsonb;
      NEW.discord_id := v_discord_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Sensitive column changes: role / discord_roles / primary key
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.discord_roles IS DISTINCT FROM OLD.discord_roles
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      -- Strict admin or service_role required
      IF NOT public.is_strict_admin()
         AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin') THEN
        NEW.role := OLD.role;
        NEW.discord_roles := OLD.discord_roles;
        NEW.id := OLD.id;
      -- Founder roles: only owner or service_role can create or demote
      ELSIF (OLD.role = 'owner' OR NEW.role = 'owner')
            AND COALESCE(v_jwt ->> 'role', '') NOT IN ('service_role', 'supabase_admin')
            AND NOT public.is_owner() THEN
        NEW.role := OLD.role;
        NEW.discord_roles := OLD.discord_roles;
      END IF;
    END IF;

    -- Discord ID locking: non-admin can only set to their own verified identity
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
  v_is_discord BOOLEAN;
BEGIN
  v_is_discord := COALESCE(NEW.raw_app_meta_data->>'provider', '') = 'discord'
                  OR COALESCE(NEW.raw_app_meta_data->>'providers', '[]')::text LIKE '%"discord"%';

  -- Verified discord_id: auth.identities first, fallback to metadata ONLY if created via Discord OAuth
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
