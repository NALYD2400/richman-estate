const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

// Regex patterns to capture actual static asset references
const HTML_PATTERNS = [
  /<(?:img|script|video|audio|source|embed|iframe)[^>]+src\s*=\s*["']([^"']+)["']/gi,
  /<link[^>]+href\s*=\s*["']([^"']+)["']/gi
];

const CSS_PATTERNS = [
  /url\(\s*["']?([^"')]+)["']?\s*\)/gi
];

const ignoredPrefixes = [
  '#',
  'data:',
  'javascript:',
  'mailto:',
  'tel:',
  'blob:',
  'about:'
];

function checkRemoteUrl(urlStr) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request(parsed, { method: 'HEAD', timeout: 5000 }, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve({ ok: true, status: res.statusCode });
        } else {
          // Retry with GET if HEAD is forbidden or rejected by CDN
          const getReq = client.request(parsed, { method: 'GET', timeout: 5000 }, (getRes) => {
            getRes.resume();
            resolve({ ok: getRes.statusCode >= 200 && getRes.statusCode < 400, status: getRes.statusCode });
          });
          getReq.on('error', () => resolve({ ok: false, error: 'GET error' }));
          getReq.on('timeout', () => { getReq.destroy(); resolve({ ok: false, error: 'GET timeout' }); });
          getReq.end();
        }
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

async function auditAllAssets() {
  console.log('================================================================================');
  console.log('🔍 AUDIT D\'INTÉGRITÉ DES ASSETS (IMAGES, VIDÉOS, FONTS, SCRIPTS, STYLES)');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  const htmlFiles = fs.readdirSync(path.join(ROOT, 'src', 'pages')).filter(f => f.endsWith('.html')).map(f => path.join(ROOT, 'src', 'pages', f));
  const cssFiles = [
    path.join(ROOT, 'src', 'styles', 'styles.css'),
    path.join(ROOT, 'src', 'styles', 'variables.css'),
    path.join(ROOT, 'src', 'styles', 'base.css')
  ].filter(fs.existsSync);

  const localAssets = new Set();
  const remoteAssets = new Set();

  // 1. Scan HTML files
  for (const hf of htmlFiles) {
    const content = fs.readFileSync(hf, 'utf8');
    const relFile = path.relative(ROOT, hf);

    // Filter out preconnect/dns-prefetch link tags
    const linkRegex = /<link[^>]+(?:rel=["'](?:stylesheet|icon|apple-touch-icon|shortcut icon|preload)["'][^>]+href=["']([^"']+)["']|href=["']([^"']+)["'][^>]+rel=["'](?:stylesheet|icon|apple-touch-icon|shortcut icon|preload)["'])[^>]*>/gi;
    let lMatch;
    while ((lMatch = linkRegex.exec(content)) !== null) {
      const raw = (lMatch[1] || lMatch[2] || '').trim();
      if (!raw || ignoredPrefixes.some(p => raw.startsWith(p))) continue;
      if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) {
        remoteAssets.add(raw.startsWith('//') ? 'https:' + raw : raw);
      } else {
        localAssets.add({ source: relFile, link: raw });
      }
    }

    // Media & scripts
    const mediaRegex = /<(?:img|script|video|audio|source|embed|iframe)[^>]+src\s*=\s*["']([^"']+)["']/gi;
    let mMatch;
    while ((mMatch = mediaRegex.exec(content)) !== null) {
      const raw = mMatch[1].trim();
      if (!raw || ignoredPrefixes.some(p => raw.startsWith(p))) continue;
      if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) {
        remoteAssets.add(raw.startsWith('//') ? 'https:' + raw : raw);
      } else {
        localAssets.add({ source: relFile, link: raw });
      }
    }
  }

  // 2. Scan CSS files
  for (const cf of cssFiles) {
    const content = fs.readFileSync(cf, 'utf8');
    const relFile = path.relative(ROOT, cf);

    for (const pat of CSS_PATTERNS) {
      let match;
      const regex = new RegExp(pat.source, pat.flags);
      while ((match = regex.exec(content)) !== null) {
        const raw = match[1].trim();
        if (!raw || ignoredPrefixes.some(p => raw.startsWith(p))) continue;
        if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) {
          remoteAssets.add(raw.startsWith('//') ? 'https:' + raw : raw);
        } else {
          localAssets.add({ source: relFile, link: raw });
        }
      }
    }
  }

  console.log(`📁 Fichiers scannés : ${htmlFiles.length} pages HTML, ${cssFiles.length} feuilles CSS`);
  console.log(`🔗 Références locales uniques : ${localAssets.size}`);
  console.log(`🌐 Références externes uniques : ${remoteAssets.size}\n`);

  console.log('--- 1. Vérification des Assets Locaux ---');
  for (const item of localAssets) {
    const clean = item.link.split('?')[0].split('#')[0];
    // Les pages sont servies à la racine en prod : les références relatives/absolues
    // pointent dans public/ ; les sources Vite (/src/main, src/styles) dans src/.
    // Les CSS référencent parfois ../.. — on normalise en retirant les ../ de tête.
    const stripped = clean.replace(/^(?:\.\.\/)+/, '').replace(/^\//, '');
    const candidates = [
      path.join(ROOT, 'public', stripped),
      path.join(ROOT, clean.replace(/^\//, '')),
      path.resolve(path.dirname(path.join(ROOT, 'src', 'pages', path.basename(item.source))), clean)
    ];
    let resolved = candidates.find(c => fs.existsSync(c));
    if (!resolved) resolved = candidates[candidates.length - 1];

    if (!fs.existsSync(resolved) && !path.extname(resolved)) {
      if (fs.existsSync(resolved + '.html')) resolved = resolved + '.html';
    }

    if (fs.existsSync(resolved)) {
      passed++;
      console.log(`  ✅ [LOCAL] "${item.link}" dans ${item.source} -> OK (${fs.statSync(resolved).size} octets)`);
    } else {
      failed++;
      console.log(`  ❌ [LOCAL] "${item.link}" dans ${item.source} -> INTROUVABLE (${path.relative(ROOT, resolved)})`);
    }
  }

  // 3. Scan specific key project assets
  console.log('\n--- 2. Vérification des Assets du Dossier /assets & /fonts ---');
  const mandatoryAssets = [
    'assets/logo.webp',
    'favicon.ico',
    'fonts/GeistPixel-Circle.woff2',
    'assets/hotel/01_facade_jour.jpg',
    'assets/hotel/01_facade_nuit.jpg',
    'assets/hotel/02_piscine_jour.jpg',
    'assets/hotel/02_piscine_nuit.jpg',
    'assets/hotel/03_panoramique_jour.jpg',
    'assets/hotel/03_panoramique_nuit.jpg',
    'assets/hotel/04_arches_entree_jour.jpg',
    'assets/hotel/04_arches_entree_nuit.jpg',
    'assets/hotel/05_terrasse_restaurant_jour.jpg',
    'assets/hotel/05_terrasse_restaurant_nuit.jpg',
    'assets/hotel/06_allee_cabanas_jour.jpg',
    'assets/hotel/06_allee_cabanas_nuit.jpg',
    'assets/hotel/07_allee_jardin_jour.jpg',
    'assets/hotel/07_allee_jardin_nuit.jpg',
    'assets/hotel/08_tennis_jour.jpg',
    'assets/hotel/08_tennis_nuit.jpg',
    'assets/hotel/09_garages_jour.jpg',
    'assets/hotel/09_garages_nuit.jpg',
    'assets/hotel/10_carrefour_panneau_jour.jpg',
    'assets/hotel/10_carrefour_panneau_nuit.jpg'
  ];

  for (const ma of mandatoryAssets) {
    const full = path.join(ROOT, 'public', ma);
    if (fs.existsSync(full)) {
      passed++;
      console.log(`  ✅ [ASSET] ${ma} (${fs.statSync(full).size} octets)`);
    } else {
      failed++;
      console.log(`  ❌ [ASSET] ${ma} MANQUANT`);
    }
  }

  console.log('\n--- 3. Vérification des CDN & Dépendances Externes ---');
  for (const u of remoteAssets) {
    const res = await checkRemoteUrl(u);
    if (res.ok) {
      passed++;
      console.log(`  ✅ [CDN] ${u} -> HTTP ${res.status}`);
    } else {
      failed++;
      console.log(`  ❌ [CDN] ${u} -> ${res.error || 'HTTP ' + res.status}`);
    }
  }

  const total = passed + failed;
  const score = Math.round((passed / total) * 100);

  console.log('\n================================================================================');
  console.log(`📊 SCORE VÉRIFICATION DES ASSETS : ${score}% (${passed}/${total} VALIDÉS)`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  auditAllAssets();
}

module.exports = { auditAllAssets };
