// Adaptation des pages HTML pour Vite : remplace le bloc
// (CDN supabase + CDN dompurify + 16 scripts src/js/app) par une entrée module unique.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const pagesDir = resolve(process.argv[2]);
const pages = ["index", "vehicules", "suites", "client", "contact", "login", "admin"];

for (const page of pages) {
  const file = resolve(pagesDir, `${page}.html`);
  let html = readFileSync(file, "utf8");

  const before = html;
  html = html
    .replace(/[ \t]*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>\r?\n?/g, "")
    .replace(/[ \t]*<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/dompurify\/[^"]*"><\/script>\r?\n?/g, "")
    .replace(/[ \t]*<script src="src\/js\/app\/[\w.-]+\.js"><\/script>\r?\n/g, "");

  // Entrée module unique insérée juste avant </body>
  html = html.replace(/<\/body>/, `    <script type="module" src="/src/main/${page}.ts"></script>\n  </body>`);

  if (html === before) {
    console.error(`!! ${page}.html : aucun remplacement effectué`);
    continue;
  }
  writeFileSync(file, html);
  const count = (before.match(/src\/js\/app\//g) || []).length;
  console.log(`${page}.html : ${count} scripts remplacés par l'entrée module`);
}
