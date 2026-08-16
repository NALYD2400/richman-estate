/* ==========================================================================
   Richman Estate — api/og-suite.js
   Aperçu OpenGraph dynamique par suite/résidence pour les robots (Discord, etc.).
   Les humains sont redirigés vers la page suites (la fiche s'ouvre via ?select=).
   ========================================================================== */

const { isBotUserAgent, fetchItem, firstMediaUrl, truncate, renderOgHtml, siteUrl } = require("./_og-lib");

const DEFAULT_DESC = "Hébergement de prestige Richman Estate — conciergerie privée 24/7 et service hôtelier VIP.";
const LOGO_FALLBACK = "https://ghbeopdnfdxuqfjzmmeb.supabase.co/storage/v1/object/public/public_assets/logo.webp";

module.exports = async function handler(req, res) {
  const query = (req.query || {});
  const select = String(query.select || query.id || "").trim();
  const fallback = select ? `/suites?select=${encodeURIComponent(select)}&shared=1` : "/suites";
  const ua = req.headers && req.headers["user-agent"];

  if (!select || !isBotUserAgent(ua)) {
    res.writeHead(302, { Location: fallback });
    return res.end();
  }

  try {
    const suite = await fetchItem("suites", "name,price,specs,media_urls,category,room_number,floor", select);

    if (!suite) {
      res.writeHead(302, { Location: fallback });
      return res.end();
    }

    const name = String(suite.name || select);
    const image = firstMediaUrl(suite.media_urls) || LOGO_FALLBACK;
    const price = String(suite.price || "Sur devis");
    const title = `${name} — ${price} / nuit | Richman Estate`;
    const shareUrl = `${siteUrl()}/suites?select=${encodeURIComponent(name.toLowerCase().trim())}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.status(200).send(renderOgHtml({
      title,
      description: truncate(suite.specs || DEFAULT_DESC),
      image,
      url: shareUrl
    }));
  } catch (e) {
    res.writeHead(302, { Location: fallback });
    res.end();
  }
};
