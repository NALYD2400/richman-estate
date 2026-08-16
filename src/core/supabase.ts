import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

/** Client Supabase unique de l'application (remplace window.supabaseClient). */
export const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Alias conservé pour la compat des modules portés. */
export function getSupabaseClient(): SupabaseClient {
  return supabaseClient;
}
