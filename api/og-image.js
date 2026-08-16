/* ==========================================================================
   Richman Estate — api/og-image.js
   Sert l'image OG (aperçu Discord) d'un véhicule ou d'une suite :
   /api/og-image?type=vehicule&select=09turishp[&v=hash]
   - 1re image configurée dans l'admin (specs.media_url / media_urls),
     qu'elle soit une URL http OU une data-URI base64 (les uploads admin sont
     stockés en base64 — Discord ne rend pas les data: URIs, on les sert donc
     en HTTP depuis notre domaine, port 443 classique)
   - fallback véhicule : screenshot CDN CTG ; fallback suite : logo
   Paramètre v : cache-buster généré par les fonctions OG (change si l'admin
   modifie les images) pour invalider le cache rapidement.
   ========================================================================== */

const { fetchItem, firstMediaUrl, siteUrl } = require("./_og-lib");

const ALLOWED_HOSTS = new Set([
  "api.staff.gta.ctgaming.fr",
  "staff.gta.ctgaming.fr",
  "ghbeopdnfdxuqfjzmmeb.supabase.co"
]);

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 Mo
const SCREENSHOT_CDN = "https://api.staff.gta.ctgaming.fr:2096/uploads/vehicle-screenshots";
// Bucket Supabase public_assets inexistant sur ce projet — logo servi depuis le site
const LOGO_FALLBACK = `${siteUrl()}/assets/logo.webp`;

function sendImage(res, buffer, contentType) {
  res.setHeader("Content-Type", contentType);
  // Court (5 min) : les changements d'images côté admin restent visibles vite
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.status(200).send(buffer);
}

async function proxyHttpImage(res, url) {
  const target = new URL(url);
  const ownHost = new URL(siteUrl()).hostname;
  if (target.protocol !== "https:" || (!ALLOWED_HOSTS.has(target.hostname) && target.hostname !== ownHost)) {
    res.status(403).send("Hôte non autorisé");
    return false;
  }
  const upstream = await fetch(target.toString(), {
    headers: { "User-Agent": "RichmanEstate-OG-Proxy/1.0" },
    redirect: "follow"
  });
  const contentType = String(upstream.headers.get("content-type") || "");
  if (!upstream.ok || !contentType.toLowerCase().startsWith("image/")) {
    return false; // laisse l'appelant retomber sur son fallback
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    res.status(413).send("Image trop volumineuse");
    return true; // répondu
  }
  sendImage(res, buffer, contentType);
  return true;
}

function serveDataUri(res, dataUri) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(dataUri.trim());
  if (!m) return false;
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    res.status(413).send("Image invalide ou trop volumineuse");
    return true; // répondu
  }
  sendImage(res, buffer, m[1]);
  return true;
}

module.exports = async function handler(req, res) {
  const query = (req.query || {});

  // 1) Mode legacy : proxy direct d'une URL http listée blanche
  const src = String(query.src || "").trim();
  if (src && /^https?:\/\//i.test(src)) {
    try {
      const done = await proxyHttpImage(res, src);
      if (!done) res.status(502).send("Image introuvable en amont");
    } catch (e) {
      res.status(502).send("Erreur de récupération de l'image");
    }
    return;
  }

  // 2) Mode principal : image OG d'un véhicule/suite depuis la base
  const type = String(query.type || "").toLowerCase();
  const select = String(query.select || "").trim();
  if ((type !== "vehicule" && type !== "suite") || !select) {
    res.status(400).send("Paramètres type/select requis");
    return;
  }

  try {
    let media = "";
    if (type === "vehicule") {
      const vehicle = await fetchItem("vehicules", "name,specs", select);
      if (vehicle) {
        try {
          if (vehicle.specs && String(vehicle.specs).startsWith("{")) {
            media = JSON.parse(vehicle.specs).media_url || "";
          }
        } catch (e) { /* specs illisibles : fallback */ }
      }
    } else {
      const suite = await fetchItem("suites", "name,media_urls", select);
      if (suite) media = suite.media_urls || "";
    }

    const first = firstMediaUrl(media);

    // Image admin en data-URI base64 → servie telle quelle en HTTP
    if (first && first.startsWith("data:image/")) {
      if (serveDataUri(res, first)) return;
    }

    // Image admin en URL http → proxy (si hôte autorisé)
    if (first && /^https?:\/\//i.test(first)) {
      const done = await proxyHttpImage(res, first);
      if (done) return;
    }

    // Finalements : screenshot CDN (véhicule) ou logo (suite)
    const fallback = type === "vehicule"
      ? `${SCREENSHOT_CDN}/${encodeURIComponent(select.toLowerCase().trim())}.webp`
      : LOGO_FALLBACK;
    const done = await proxyHttpImage(res, fallback);
    if (!done) res.status(502).send("Image introuvable en amont");
  } catch (e) {
    res.status(502).send("Erreur de récupération de l'image");
  }
};
