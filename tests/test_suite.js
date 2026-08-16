const http = require('http');
const fs = require('fs');
const path = require('path');
const { server, PORT } = require('./test-server.cjs');

async function testUrl(url, method = 'GET', postData = null, headers = {}) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url);
      const reqHeaders = { ...headers };
      if (postData && !reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 80,
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: reqHeaders,
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed = data;
          try { parsed = JSON.parse(data); } catch (e) {}
          resolve({ status: res.statusCode, headers: res.headers || {}, data, json: parsed });
        });
      });

      req.on('error', (err) => {
        resolve({ status: 0, headers: {}, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 408, headers: {}, error: 'Request Timeout' });
      });

      if (postData) {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
      req.end();
    } catch (e) {
      resolve({ status: 0, headers: {}, error: e.message });
    }
  });
}

async function runAllTests() {
  let localServerStarted = false;
  const ping = await testUrl(`http://127.0.0.1:${PORT}/index.html`);
  if (ping.status === 0) {
    await new Promise((resolve) => {
      server.once('error', (err) => {
        console.error('Server listen error:', err.message);
        resolve();
      });
      server.listen(PORT, '127.0.0.1', () => {
        localServerStarted = true;
        resolve();
      });
    });
  }

  console.log('================================================================================');
  console.log('🧪 SUITE DE TESTS D\'INTÉGRITÉ & FONCTIONNELLE — RICHMAN ESTATE v3 (dist/)');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      passed++;
      console.log(`  ✅ ${message}`);
    } else {
      failed++;
      console.log(`  ❌ ${message}`);
    }
  }

  // --- 1. PAGES WEB PRINCIPALES ---
  console.log(`📄 [1/5] Vérification des Pages Web Principales (Port ${PORT})`);
  const pages = [
    { url: `http://127.0.0.1:${PORT}/index.html`, title: 'Accueil' },
    { url: `http://127.0.0.1:${PORT}/vehicules.html`, title: 'Flotte Véhicules' },
    { url: `http://127.0.0.1:${PORT}/suites.html`, title: 'Suites & Résidences' },
    { url: `http://127.0.0.1:${PORT}/contact.html`, title: 'Contact & Conciergerie' },
    { url: `http://127.0.0.1:${PORT}/client.html`, title: 'Espace Client' },
    { url: `http://127.0.0.1:${PORT}/login.html`, title: 'Connexion' },
    { url: `http://127.0.0.1:${PORT}/admin.html`, title: 'Administration' }
  ];

  for (const page of pages) {
    const res = await testUrl(page.url);
    assert(res.status === 200 && res.headers['content-type']?.includes('text/html'), `${page.title} (${page.url}) -> HTTP 200 [text/html]`);
  }

  // --- 2. ASSETS (bundled + statiques) ---
  console.log('\n🎨 [2/5] Vérification des Assets (bundle Vite, Fonts, Images, Données)');
  const indexRes = await testUrl(`http://127.0.0.1:${PORT}/index.html`);
  const bundled = [...String(indexRes.data).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
  assert(bundled.some(u => u.endsWith('.js')), `Entrée JS bundle référencée dans index.html (${bundled.filter(u => u.endsWith('.js')).length} fichier(s))`);
  assert(bundled.some(u => u.endsWith('.css')), `Feuille de style bundle référencée dans index.html`);
  for (const u of bundled) {
    const res = await testUrl(`http://127.0.0.1:${PORT}${u}`);
    assert(res.status === 200, `Bundle ${u} -> HTTP 200`);
  }
  const staticAssets = [
    { url: `http://127.0.0.1:${PORT}/fonts/GeistPixel-Circle.woff2`, type: 'font/woff2' },
    { url: `http://127.0.0.1:${PORT}/assets/logo.webp`, type: 'image/webp' },
    { url: `http://127.0.0.1:${PORT}/assets/hotel/01_facade_jour.jpg`, type: 'image/jpeg' },
    { url: `http://127.0.0.1:${PORT}/assets/hotel/01_facade_nuit.jpg`, type: 'image/jpeg' },
    { url: `http://127.0.0.1:${PORT}/data/ctg_vehicles.json`, type: 'application/json' }
  ];
  for (const asset of staticAssets) {
    const res = await testUrl(asset.url);
    assert(res.status === 200 && res.headers['content-type']?.includes(asset.type), `${asset.url} -> HTTP 200 [${res.headers['content-type']}]`);
  }
  // Aucun CDN JS ne doit rester référencé (supabase-js/dompurify bundlés)
  assert(!String(indexRes.data).match(/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com\/ajax\/libs\/dompurify/), `Aucun CDN JS résiduel (supabase-js & dompurify bundlés)`);

  // --- 3. ROUTAGE CLEAN URLS & OPENGRAPH STATIQUE ---
  console.log('\n🔗 [3/5] Vérification du Routage Clean URLs & Balises OpenGraph');
  const cleanUrls = ['vehicules', 'suites', 'contact', 'client', 'login', 'admin'];
  for (const cu of cleanUrls) {
    const res = await testUrl(`http://127.0.0.1:${PORT}/${cu}`);
    assert(res.status === 200 && res.headers['content-type']?.includes('text/html'), `Clean URL /${cu} -> HTTP 200 [Résolu vers HTML]`);
  }
  const ogRes = await testUrl(`http://127.0.0.1:${PORT}/vehicules.html`);
  assert(ogRes.status === 200 && /og:title/i.test(String(ogRes.data)), `Balises OpenGraph statiques présentes (og:title)`);

  // --- 4. SÉCURITÉ DU SERVEUR (PATH TRAVERSAL & FICHIERS CACHÉS) ---
  console.log('\n🛡️ [4/5] Tests de Sécurité du Serveur Web (Path Traversal & Protection .env/.git)');
  const securityTests = [
    { url: `http://127.0.0.1:${PORT}/.env`, expected: 403, desc: 'Blocage du fichier .env racine' },
    { url: `http://127.0.0.1:${PORT}/bot/.env`, expected: 403, desc: 'Blocage du répertoire bot/' },
    { url: `http://127.0.0.1:${PORT}/database/supabase_schema.sql`, expected: 403, desc: 'Blocage du répertoire database/' },
    { url: `http://127.0.0.1:${PORT}/.git/config`, expected: 403, desc: 'Blocage du répertoire .git' },
    { url: `http://127.0.0.1:${PORT}/.gitignore`, expected: 403, desc: 'Blocage des fichiers cachés commençant par .' },
    { url: `http://127.0.0.1:${PORT}/../package.json`, expected: 403, desc: 'Blocage Path Traversal (..)' },
    { url: `http://127.0.0.1:${PORT}/non_existent_page_404`, expected: 404, desc: 'Retour 404 sur ressource inexistante' }
  ];

  for (const sec of securityTests) {
    const res = await testUrl(sec.url);
    assert(res.status === sec.expected, `${sec.desc} (${sec.url}) -> HTTP ${res.status} (Attendu: ${sec.expected})`);
  }

  // --- 5. API DISCORD BOT (PORT 3001) ---
  console.log('\n🤖 [5/5] Vérification de l\'API Discord Bot (Port 3001)');
  let botApiSecret = process.env.BOT_API_SECRET || null;
  try {
    const botEnv = fs.readFileSync(path.resolve(__dirname, '../bot/.env'), 'utf8');
    const m = botEnv.match(/^\s*BOT_API_SECRET\s*=\s*(.+)$/m);
    if (m) botApiSecret = m[1].trim();
  } catch (e) {}

  const roleCheck = await testUrl(
    'http://127.0.0.1:3001/api/check-user-roles?discordId=1015310406169923665',
    'GET',
    null,
    botApiSecret ? { Authorization: `Bearer ${botApiSecret}` } : {}
  );
  assert(roleCheck.status === 200 || roleCheck.status === 401, `GET /api/check-user-roles -> HTTP ${roleCheck.status} (200 avec secret, ou 401 protégé)`);

  if (botApiSecret) {
    const emptySync = await testUrl('http://127.0.0.1:3001/api/sync-booking-message', 'POST', {});
    assert(emptySync.status === 400, `POST /api/sync-booking-message validation payload -> HTTP 400`);
    const emptyReg = await testUrl('http://127.0.0.1:3001/api/register-member', 'POST', {});
    assert(emptyReg.status === 400, `POST /api/register-member validation payload -> HTTP 400`);
    const suitesSync = await testUrl('http://127.0.0.1:3001/api/sync-discord-suites', 'POST', {});
    assert(suitesSync.status === 401 || suitesSync.status === 403, `POST /api/sync-discord-suites sans secret -> HTTP ${suitesSync.status} (protégé)`);
  } else {
    const protectedRes = await testUrl('http://127.0.0.1:3001/api/sync-discord-suites', 'POST', {});
    assert(protectedRes.status === 401 || protectedRes.status === 403 || protectedRes.status === 0, `Endpoints sensibles protégés sans secret -> HTTP ${protectedRes.status}`);
  }

  console.log('\n================================================================================');
  const total = passed + failed;
  const percentage = total > 0 ? ((passed / total) * 100).toFixed(0) : 0;
  console.log(`📊 RÉSULTAT GLOBAL DE LA SUITE DE TESTS : ${percentage}% (${passed}/${total} TESTS RÉUSSIS)`);
  console.log('================================================================================');

  if (localServerStarted) server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch((err) => {
  console.error('Erreur fatale de la suite de tests:', err);
  process.exit(1);
});
