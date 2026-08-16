/* ==========================================================================
   Richman Estate — api/og-image.js
   Proxy d'images pour les aperçus Discord : le proxy de Discord n'arrive pas
   à rapatrier le CDN CTG (port non standard :2096). On sert l'image depuis
   notre domaine en 443 classique. Liste blanche stricte d'hôtes.
   ========================================================================== */

const ALLOWED_HOSTS = new Set([
  "api.staff.gta.ctgaming.fr",
  "staff.gta.ctgaming.fr",
  "ghbeopdnfdxuqfjzmmeb.supabase.co"
]);

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 Mo

module.exports = async function handler(req, res) {
  const raw = String((req.query && req.query.src) || "");

  let target;
  try {
    target = new URL(raw);
  } catch (e) {
    res.status(400).send("src invalide");
    return;
  }

  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    res.status(403).send("Hôte non autorisé");
    return;
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { "User-Agent": "RichmanEstate-OG-Proxy/1.0" },
      redirect: "follow"
    });

    const contentType = String(upstream.headers.get("content-type") || "");
    if (!upstream.ok || !contentType.toLowerCase().startsWith("image/")) {
      res.status(502).send("Image introuvable en amont");
      return;
    }

    const sizeHeader = Number(upstream.headers.get("content-length") || "0");
    if (sizeHeader > MAX_IMAGE_BYTES) {
      res.status(413).send("Image trop volumineuse");
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) {
      res.status(413).send("Image trop volumineuse");
      return;
    }

    res.setHeader("Content-Type", contentType);
    // Cacheable sans risque : c'est une image, identique pour bots et humains
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.status(200).send(buffer);
  } catch (e) {
    res.status(502).send("Erreur de récupération de l'image");
  }
};
