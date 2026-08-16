-- ============================================================================
-- PATCH SÉCURITÉ — 16/08/2026 (11ᵉ passe d'audit)
-- À exécuter dans l'éditeur SQL Supabase (jeu de la base de production).
--
-- 1) suites.access_code : digicode réservé au staff
--    - anon & authenticated ne peuvent plus SELECT la colonne (grants par colonne)
--    - les admins la lisent via la RPC get_suite_access_codes (is_admin)
--    - le bot garde l'accès complet via service_role
--    - les écritures admin (INSERT/UPDATE) conservent la colonne (RLS suites_admin_all)
--
-- 2) update_booking_status : REVOKE anon manquant (défense en profondeur —
--    le garde interne posé le 16/08 bloque déjà, ce REVOKE le double).
--
-- Impact frontend déjà appliqué dans le code :
--    - src/js/app/12-suites-showroom.js  → SELECT colonnes explicites
--    - src/js/app/02-admin-crud.js       → SELECT colonnes explicites + RPC digicodes
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Lecture suites : colonnes du showroom uniquement pour anon & authenticated
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.suites FROM anon, authenticated;

GRANT SELECT (id, name, price, specs, status, created_at, room_number, category, floor, media_urls)
    ON public.suites TO anon, authenticated;

-- 1b. Écritures admin (filtrées par la policy RLS suites_admin_all)
GRANT INSERT (id, name, price, specs, status, created_at, room_number, category, floor, media_urls, access_code)
    ON public.suites TO authenticated;
GRANT UPDATE (id, name, price, specs, status, created_at, room_number, category, floor, media_urls, access_code)
    ON public.suites TO authenticated;
GRANT DELETE ON public.suites TO authenticated;

-- 1c. Bot : accès complet maintenu
GRANT ALL ON public.suites TO service_role;

-- ---------------------------------------------------------------------------
-- 1d. RPC staff-only de lecture des digicodes (UI admin)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. update_booking_status : révoquer l'exécution anonyme
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.update_booking_status(UUID, TEXT) FROM anon;

-- ============================================================================
-- VÉRIFICATION POST-DÉPLOIEMENT (à jouer avec la clé anon, doit échouer/être vide) :
--   POST /rest/v1/rpc/update_booking_status  → 401/403 (permission denied)
--   GET  /rest/v1/suites?select=access_code  → 42501 (permission denied pour le rôle anon)
--   GET  /rest/v1/suites?select=id,name,...   → 200 (catalogue public intact)
--   POST /rest/v1/rpc/get_suite_access_codes  → [] pour un client connecté, liste pour un admin
-- ============================================================================
