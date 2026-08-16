// Serveur statique minimal pour les tests : sert dist/ avec clean URLs,
// et bloque les fichiers sensibles (.env, .git, database/, bot/).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'dist');
const PORT = parseInt(process.env.TEST_PORT || '8080', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const onEnd = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    res.writeHead(status, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      ...extra
    });
    res.end(body);
  };

  // Fichiers sensibles et traversal (req.url BRUT : l'URL constructor normaliserait ../)
  const rawUrl = req.url || '';
  if (rawUrl.includes('..') || rawUrl.toLowerCase().includes('%2e') || rawUrl.includes('\0') || urlPath.includes('\0')) {
    return onEnd(403, 'Forbidden');
  }
  const first = urlPath.split('/')[1];
  if (first.startsWith('.') || first === 'bot' || first === 'database' || first === 'node_modules' || first === 'server' || first === 'src' || first === 'tests') {
    return onEnd(403, 'Forbidden');
  }

  let filePath = path.join(ROOT, urlPath);
  // Clean URL : /vehicules -> /vehicules.html (avant tout statSync)
  if (!path.extname(filePath)) {
    const candidate = path.join(ROOT, `${urlPath.replace(/\/$/, '')}.html`);
    if (fs.existsSync(candidate)) filePath = candidate;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) return onEnd(404, 'Not Found');
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const cache = urlPath.startsWith('/assets/') ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {};
    onEnd(200, data, type, cache);
  });
});

module.exports = { server, PORT };
