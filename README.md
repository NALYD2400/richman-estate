# 🏰 Richman Estate RP — v3 (Vite + TypeScript)

> Rebuild longue-durée du site Richman Estate : même design, même fonctionnalités,
> architecture modernisée. Le projet historique reste intact dans son dossier d'origine.

## Ce qui change par rapport à la v2

| Avant (v2) | Après (v3) |
|---|---|
| 7 pages chargeant chacune 16 `<script>` globaux (~8 000 lignes) | 1 bundle Vite par page, modules ES, code partagé en chunks |
| État partagé via `Object.defineProperty(window, ...)` | `src/core/state.ts` typé + imports/exports nommés |
| supabase-js et DOMPurify via CDN non épinglés | Dépendances npm versionnées, bundlées |
| Sanitization globale `window.*` | Noyau typé `src/core/` (sanitize, supabase, api, vehicles, state) |
| `escapeHTML` dans les `onclick` (faille XSS à répétition) | `safeJsArg` noyau + closures recommandées pour tout nouveau code |

## Démarrage

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit + vite build → dist/
npm run preview    # sert dist/ en local
```

Bot Discord (port 3001 en local, 0.0.0.0 détecté sur Render) :

```bash
cd bot && npm install && cp ../.env.example .env   # remplir les secrets
npm run bot        # depuis la racine
```

## Structure

```
├── public/               # Statiques servis tels quels (assets, fonts, data, robots)
├── src/
│   ├── core/             # Noyau typé : config, supabase, api (botFetch), sanitize, state, vehicles
│   ├── modules/          # Les 15 modules applicatifs portés (01→15), ordre historique conservé
│   ├── main/<page>.ts    # Entrée de chaque page (importe les modules)
│   ├── pages/*.html      # HTML des 7 pages (une seule balise <script type="module">)
│   └── styles/           # CSS inchangé (variables, base, components, pages)
├── bot/                  # Bot Discord + API REST (inchangé, durci — voir son README)
├── database/             # Schéma Supabase durci + patches de sécurité datés
├── scripts/              # Outils (adapt-pages.mjs)
└── tests/                # Suites de tests (voir ci-dessous)
```

## Déploiement

- **Site** : Vercel (framework « Vite », build `npm run build`, output `dist/`). Les
  en-têtes/CSP sont dans `vercel.json` — `script-src` ne référence plus les CDN JS.
- **Bot** : Render (ou équivalent Node). Variables requises : `DISCORD_TOKEN`,
  `BOT_API_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`. L'API écoute sur `0.0.0.0`
  automatiquement sur Render (`RENDER`), sur `127.0.0.1` en local.
- **Base** : appliquer `database/supabase_schema.sql` sur un projet Supabase neuf,
  puis les patches datés dans l'ordre s'il s'agit d'une base existante.

## Tests

```bash
npm run build       # vérification TypeScript + bundling
npm test            # suite connectivité (nécessite le preview/dev lancé)
npm run audit       # audit sécurité live Supabase
```

## Sécurité — rappels hérités de l'audit v2

- La clé publishable Supabase est publique par design ; la clé service reste côté bot.
- `suites.access_code` : lisible uniquement via la RPC staff `get_suite_access_codes`.
- Toutes les RPC sensibles : `REVOKE ... FROM PUBLIC, anon` (le `FROM anon` seul est
  insuffisant — `anon` hérite de `PUBLIC`).
- Toute interpolation de donnée dans un attribut `onclick` doit passer par `safeJsArg`
  (voir `src/core/sanitize.ts`) — préférer des closures pour tout nouveau code.
