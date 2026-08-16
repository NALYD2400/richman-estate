import { getBotApiBase } from "./config";
import { supabaseClient } from "./supabase";

/**
 * fetch authentifié vers l'API du bot : joint le JWT de session Supabase
 * (ou RICHMAN_BOT_API_TOKEN s'il est défini globalement).
 */
export async function botFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const url = `${getBotApiBase()}${endpoint}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {})
  };
  const staticToken = (window as any).RICHMAN_BOT_API_TOKEN;
  if (staticToken) {
    headers["Authorization"] = `Bearer ${staticToken}`;
  } else {
    try {
      const { data } = await supabaseClient.auth.getSession();
      if (data?.session?.access_token) {
        headers["Authorization"] = `Bearer ${data.session.access_token}`;
      }
    } catch {
      /* pas de session : requête anonyme */
    }
  }
  return fetch(url, { ...options, headers });
}
