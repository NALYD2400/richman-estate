/* ==========================================================================
   Richman Estate — api/og-vehicule.ts
   Aperçu OpenGraph dynamique par véhicule pour les robots (Discord, etc.).
   Les humains sont redirigés vers la page flotte (la fiche s'ouvre via ?select=).
   ========================================================================== */

import { isBotUserAgent, fetchItem, firstMediaUrl, truncate, renderOgHtml, siteUrl } from "./_og-lib";

const SCREENSHOT_CDN = "https://api.staff.gta.ctgaming.fr:2096/uploads/vehicle-screenshots";
const DEFAULT_DESC = "Véhicule d'exception de la flotte Richman Estate — location RP avec conciergerie privée et livraison sur demande.";

export default async function handler(req: any, res: any) {
  const query = (req.query || {});
  const select = String(query.select || query.id || "").trim();
  const fallback = select ? `/vehicules?select=${encodeURIComponent(select)}&shared=1` : "/vehicules";
  const ua = req.headers && req.headers["user-agent"];

  if (!select || !isBotUserAgent(ua)) {
    res.writeHead(302, { Location: fallback });
    return res.end();
  }

  try {
    const vehicle = await fetchItem("vehicules", "name,price,specs", select);

    if (!vehicle) {
      res.writeHead(302, { Location: fallback });
      return res.end();
    }

    const name = String(vehicle.name || select);
    let description = "";
    let media = "";
    try {
      if (vehicle.specs && String(vehicle.specs).startsWith("{")) {
        const meta = JSON.parse(vehicle.specs);
        description = meta.specs_text || "";
        media = meta.media_url || "";
      } else if (vehicle.specs) {
        description = String(vehicle.specs);
      }
    } catch (e) { /* specs illisibles : valeurs par défaut */ }

    const image = firstMediaUrl(media) || `${SCREENSHOT_CDN}/${encodeURIComponent(name.toLowerCase().trim())}.webp`;
    const price = String(vehicle.price || "Sur devis");
    const title = `${name.toUpperCase()} — ${price} / 24h | Richman Estate`;
    const shareUrl = `${siteUrl()}/vehicules?select=${encodeURIComponent(name.toLowerCase().trim())}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.status(200).send(renderOgHtml({
      title,
      description: truncate(description || DEFAULT_DESC),
      image,
      url: shareUrl
    }));
  } catch (e) {
    res.writeHead(302, { Location: fallback });
    res.end();
  }
}
