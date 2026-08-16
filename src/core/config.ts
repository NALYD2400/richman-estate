/** Configuration centrale — clé publishable Supabase (publique par design). */
export const SUPABASE_URL = "https://ghbeopdnfdxuqfjzmmeb.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_U5u4jQKVTgWkhmzM62ficA_wORi3zOq";

/** Résout l'URL de l'API du bot Discord (local → port 3001, prod → Render). */
export function getBotApiBase(): string {
  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  if (isLocal) {
    const host = window.location.hostname || "127.0.0.1";
    return `http://${host}:3001`;
  }
  return (window as any).RICHMAN_BOT_API_URL || "https://richman-discord-bot.onrender.com";
}
