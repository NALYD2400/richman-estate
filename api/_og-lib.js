/* ==========================================================================
   Richman Estate — api/_og-lib.js
   Helpers partagés des fonctions OG (aperçus Discord / réseaux sociaux).
   Préfixe "_" : Vercel n'expose pas ce fichier comme endpoint.
   CommonJS : le runtime Node de Vercel charge ces fichiers en CJS.
   ========================================================================== */

const SUPABASE_URL = "https://ghbeopdnfdxuqfjzmmeb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_U5u4jQKVTgWkhmzM62ficA_wORi3zOq"; // clé publishable, publique par design

const BOT_UA = /(discordbot|discordapp|twitterbot|facebookexternalhit|telegrambot|whatsapp|slackbot|slack-url|googlebot|bingbot|yandexbot|duckduckbot|skypeuripreview|instagrambot|pinterestbot|linkedinbot|embedly|quora link preview|outbrain|vkshare)/i;

function isBotUserAgent(ua) {
  if (!ua) return false;
  return BOT_UA.test(ua);
}

// Alias de production stable — VERCEL_URL est specifique au deploiement et
// protege par SSO (inaccessible pour les robots). PUBLIC_URL permet de
// surcharger si un domaine personnalise est ajoute un jour.
function siteUrl() {
  return `https://${process.env.PUBLIC_URL || "richman-estate.vercel.app"}`;
}

/**
 * Hash court du média (cache-buster) : change quand l'admin modifie les images
 * d'un véhicule/suite, ce qui génère une og:image fraîche pour Discord.
 */
function mediaVersion(media) {
  const s = String(media || "");
  if (!s) return "0";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * og:image passant par /api/og-image : sert la 1re image admin (même stockée
 * en base64 dans la base), sinon le screenshot CDN / le logo. L'endpoint
 * resert tout depuis notre domaine en 443 — le proxy Discord ne peut pas
 * rapatrier le CDN CTG (port :2096) ni les data: URIs.
 */
function ogImageFor(type, select, media) {
  return `${siteUrl()}/api/og-image?type=${encodeURIComponent(type)}&select=${encodeURIComponent(String(select).toLowerCase().trim())}&v=${mediaVersion(media)}`;
}

function escapeAttr(v) {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Recherche tolérante (nom exact prioritaire, sinon inclusion), miroir du client. */
async function fetchItem(table, columns, selectParam) {
  const clean = String(selectParam || "").toLowerCase().trim();
  if (!clean) return null;

  const filter = `or=(name.eq.${encodeURIComponent(clean)},name.ilike.*${encodeURIComponent(clean)}*)`;
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns}&${filter}&limit=5`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  if (!res.ok) return null;

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const exact = rows.find((r) => String(r.name || "").toLowerCase().trim() === clean);
  return exact || rows[0];
}

/** meta.media_url peut être une URL seule, une liste séparée par virgules ou un tableau JSON stringifié. */
function firstMediaUrl(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? String(arr[0] || "") : "";
    } catch (e) {
      return "";
    }
  }
  return s.split(",")[0].trim();
}

function truncate(text, max = 160) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function renderOgHtml(opts) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeAttr(opts.title)}</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Richman Estate" />
<meta property="og:title" content="${escapeAttr(opts.title)}" />
<meta property="og:description" content="${escapeAttr(opts.description)}" />
<meta property="og:image" content="${escapeAttr(opts.image)}" />
<meta property="og:url" content="${escapeAttr(opts.url)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeAttr(opts.title)}" />
<meta name="twitter:description" content="${escapeAttr(opts.description)}" />
<meta name="twitter:image" content="${escapeAttr(opts.image)}" />
</head>
<body>
<p><a href="${escapeAttr(opts.url)}">Ouvrir cette fiche sur Richman Estate</a></p>
</body>
</html>`;
}

module.exports = {
  isBotUserAgent,
  siteUrl,
  ogImageFor,
  mediaVersion,
  escapeAttr,
  fetchItem,
  firstMediaUrl,
  truncate,
  renderOgHtml
};
