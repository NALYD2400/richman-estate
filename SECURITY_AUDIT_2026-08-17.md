# 🔐 Audit de sécurité complet — Richman Estate RP v3 (17/08/2026)

**Périmètre** : `C:\Users\dylan\Desktop\procject richman 2` — site Vite/TS (7 pages), API Discord bot (Node, port 3001 / Render), Supabase (schéma + 4 patches SQL), fonctions serverless Vercel (OG), tests.
**Méthode** : revue statique complète (bot, frontend, SQL, configs, tests, git history), `npm audit` (registre), recherche de secrets dans les sources, `dist/` et l'historique git. **Aucune action destructive** ; les clés ne sont pas reproduites dans ce rapport.
**Limite** : l'état *live* (base Supabase, env Render) n'est pas vérifiable depuis ici — les constats « code » sont certains, les constats « déploiement » sont conditionnels et signalés comme tels.

---

## Verdict global

Le projet a bénéficié de ~12 passes d'audit dont les correctifs sont **majoritairement solides et cohérents** (RLS exhaustive, trigger anti-escalade, RPC `SECURITY DEFINER` gardées, comparaison constante du secret, rate-limits, CORS restreint, DOMPurify, pas de secret dans `git` ni dans `dist/`). **Mais 3 failles sérieuses restent ouvertes dans l'état actuel du code/config**, dont une porte d'usurpation de messages (IDOR fail-open) et un XSS stocké potentiel dans les `onclick` de la vitrine publique.

| # | Sévérité | Constat |
|---|---|---|
| 1 | 🔴 Critique | Secrets en clair sur disque + `BOT_API_SECRET` prévisible → contrôle total du bot Discord et du webhook si fuite |
| 2 | 🔴 Élevée | Absence de `SUPABASE_SERVICE_ROLE_KEY` + contrôle de propriété **fail-open** sur `/api/sync-booking-message` (IDOR chat) |
| 3 | 🟠 Élevée | XSS stocké résiduel : `escapeHTML`/`encodeURIComponent` utilisés en contexte JS d'attribut `onclick` (vitrine publique) |
| 4 | 🟠 Élevée | Flooding/spam anonyme : RPC `create_booking` et policies `bookings`/`contact_messages`/`vehicle_reviews` ouvertes à `anon` |
| 5 | 🟠 Moyenne | Privilège staff dérivé du **nom** des rôles Discord (`isStaffMember`) |
| 6 | 🟡 Moyenne | CSP `'unsafe-inline'` + `connect-src`/CORS trop larges (`*.onrender.com`, `*.vercel.app`) |
| 7 | 🟡 Moyenne | Dépendances : `vite 5.4.21` → 1 high + 1 moderate (`npm audit`) ; pas de lockfile côté `bot/` |
| 8 | 🟡 Moyenne | Divers : logs falsifiables, oracle d'existence bookings, `discord_roles` UI cassé, rate-limit XFF conditionnel, JWT anon committé dans les tests |

---

## 🔴 1. Secrets en clair + secret API faible et prévisible (Critique)

**Constat**
- `.env` (racine) et `bot/.env` contiennent en clair : `DISCORD_TOKEN` (bot réel), `DISCORD_WEBHOOK_URL` (token webhook complet), `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- `bot/.env` l.48 : `BOT_API_SECRET=richman_estate_secret_bot_api_key_2026_secure` — **mot-clé prévisible, modèle dictionnaire, suffixe daté**. C'est LA seule protection des endpoints admin de l'API publique du bot.
- L'API est publique sur `https://richman-discord-bot.onrender.com` (`0.0.0.0` sur Render, `bot/services/apiServer.js` l.1795-1802) : endpoints à fort impact accessibles avec ce secret : `/api/send-user-dm` (phishing DM de masse), `/api/manage-user-roles` (attribution de rôles), `/api/register-member` (renommage + rôles), `/api/sync-*`, `/api/close-ticket`…

**Impact si fuite** (collaborateur, backup, zip, post-it, brute-force) : prise de contrôle complète du bot Discord (MP de phishing à tous les membres, modification des rôles/pseudos, suppression de salons), posts via le webhook, lecture/écriture du catalogue via la clé anon, et toutes les fonctions staff de l'API.

**Vérifié** : `git rev-list --all --objects` → seuls `.env.example` ont été commités ; `dist/` → aucune trace du token/webhook/secret. ✅ Le dépôt GitHub (`github.com/NALYD2400/richman-estate`) ne fuit pas les secrets — le risque est **local/de copie** et de **prévisibilité**.

**Recommandations**
1. Supprimer les secrets des fichiers `.env` du disque de travail → variables d'environnement (Render dashboard, GitHub Actions secrets, Vercel env).
2. Régénérer `BOT_API_SECRET` aléatoirement : `openssl rand -hex 32` (≥ 32 octets). Récupérer le code qui lit `process.env.BOT_API_SECRET` (aucun changement nécessaire, `constants.js` l.43).
3. **Reset du token Discord** (Discord Developer Portal → Bot → Reset Token) et **recréer le webhook** (Discord → channel → Intégrations) — les valeurs actuelles doivent être considérées comme compromises.
4. Ajouter un `package-lock.json` dans `bot/` (épinglage reproductible, voir #7).

---

## 🔴 2. IDOR fail-open sur `/api/sync-booking-message` + clé service absente (Élevée)

**Constat A — clé service absente (`bot/.env`)**
`bot/.env` ne définit **pas** `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SERVICE_KEY`. `bot/config/constants.js` l.40-42 retombe sur la clé anon (`SUPABASE_KEY = … || SUPABASE_ANON_KEY`), avec un simple `console.warn` (l.50-52). Or toutes les RPC du chat/statuts vérifient `auth.jwt() ->> 'role' IN ('service_role','supabase_admin')` ou `is_admin()` → avec un JWT anon (uid NULL), elles **lèvent toutes une exception** (`RAISE EXCEPTION`). Conséquence en cascade :
- `supabase.js addBookingMessage/updateBookingStatus/syncItemStatus/getBookingById` → échecs silencieux (catchés partout) ;
- la synchro chat web↔Discord et la mise à jour des statuts ne fonctionnent **pas** en l'état.

**Constat B — contrôle de propriété fail-open (IDOR)**
`bot/services/apiServer.js` `/api/sync-booking-message` (l.1258-1358) :
- Pour un appelant client non-staff, le code appelle `getBookingById(booking_id, {Authorization: <JWT appelant>})` (l.1280-1286). La RPC `get_booking_details` **refuse** l'appelant non-propriétaire (`RAISE EXCEPTION`, `supabase_schema.sql`/patch 08-17) → `resp.data` n'est pas un tableau → `booking = null` ;
- **Le contrôle d'appartenance n'est exécuté que si `booking` est non-null** (`if (booking) { … ownsBooking … }` l.1295-1316) : `booking = null` ⇒ **contrôle sauté** ;
- Le flux continue : insertion du message (`addBookingMessage`, échoue avec clé anon mais catché) puis **envoi du message dans le salon Discord ticket trouvé par `booking_id`** (l.1333-1352) en tant que « 💻 Client (Web) », et `200 {success:true}`.

En clair : **la condition qui devrait bloquer l'attaquant est précisément la condition qui désactive le contrôle** (le lookup échoue pour les non-propriétaires). Un utilisateur authentifié qui connaît/obtient un `booking_id` (UUID v4, difficile à deviner mais exposé par les salons, screenshots, partages) peut **poster des messages dans le ticket Discord de n'importe quel dossier** et les faire passer pour le client. C'est une faille de conception (fail-open), aggravée par le constat A.

**Recommandations**
1. **Fail-closed** : dans `/api/sync-booking-message`, si le dossier n'est pas trouvé **ou** pas possédé → `403` systématique (ne jamais laisser passer un `booking` null) ; vérifier l'appartenance via `resolveTokenDiscordId` + `profile.discord_id`/`user.id` **avant** toute écriture.
2. Ajouter `SUPABASE_SERVICE_ROLE_KEY` dans l'environnement du bot (jamais dans un fichier). Le code est prêt (`supabase.js` l.21, `constants.js` l.42).
3. Après ajout de la clé, re-tester le flux complet chat web↔Discord (actuellement non fonctionnel).

---

## 🟠 3. XSS stocké résiduel dans les `onclick` (Élevée)

Le correctif historique `safeJsArg` (`src/core/sanitize.ts` l.22-25 = `encodeURIComponent().replace(/'/g, '%27')`) est correct, mais son application est **incohérente** : plusieurs interpolations de données dans des `onclick` (contexte JS dans attribut HTML) utilisent `escapeHTML` ou `encodeURIComponent` **seul**, qui ne neutralisent pas l'apostrophe en contexte JS :

| Fichier:ligne | Donnée interpolée | Encodeur utilisé | Risque |
|---|---|---|---|
| `src/modules/09-showroom-pagination.ts` l.282 | `item.name` (catalogue) | `escapeHTML` | `&#039;` est décodé en `'` par le parser HTML → sortie de chaîne JS |
| `src/modules/09-showroom-pagination.ts` l.336 | `item.name`, `cleanTitle` | `encodeURIComponent` | `'` non échappé par `encodeURIComponent` |
| `src/modules/12-suites-showroom.ts` l.237 | `item.id`, `item.name` | `encodeURIComponent` | idem |
| `src/modules/05-ctg-database.ts` l.176, 194 | `item.Name` (JSON CTG externe), `item.Class` | `encodeURIComponent` / `escapeHTML` | idem, données issues d'une source externe (`public/ctg_vehicles.json`) |

**Condition d'exploitation** : une donnée du catalogue (nom de véhicule/suite) ou du JSON CTG contenant une apostrophe — e.g. `Pegassi'-alert(document.cookie)-''` — exécutée dans le contexte de la vitrine publique (vol de session JWT stockée en localStorage/sessionStorage → escalade). Les noms sont saisis/importés par les admins, mais le JSON CTG est une source externe non maîtrisée, et le pointeur de la 10ᵉ passe (AUDIT.md) montrait déjà le schéma d'exploitation exact.

**Recommandations**
1. Remplacer par `safeJsArg(...)` (avec `decodeURIComponent` côté récepteur, déjà présent) sur **les 4 emplacements** ci-dessus, ou mieux : **closures `addEventListener`** (zéro chaîne) — recommandation déjà portée dans `sanitize.ts` l.20.
2. Ajouter un test statique de non-régression : interdire `onclick="…${encodeURIComponent(…)}…"` / `${escapeHTML(…)…}` en contexte JS (voir AUDIT.md 10ᵉ passe, suggestion (b)).

---

## 🟠 4. Flooding/spam anonyme de la file staff (Élevée)

En l'état final du schéma (patch 08-17), ces surfaces restent ouvertes **sans authentification** :
- RPC `create_booking` : `GRANT … TO anon, authenticated, service_role` (patch l.584) ;
- Policy `bookings_insert_pending` : accepte `user_id IS NULL AND auth.uid() IS NULL` (l.593) → **un anonyme peut insérer des réservations directement en REST** ;
- `contact_insert_public` : tout anonyme crée des demandes conciergerie (l.771-776) ;
- `vehicle_reviews_insert_public` : avis anonymes illimités (l.793-799).

Ces appels passent **directement par l'API Supabase** (clé anon publique dans le bundle), donc **contournent totalement le rate-limit du bot** (8 req/min sur les endpoints de création). Impact : saturation de la file staff (bookings + tickets contact), base polluée, notifications Discord en rafale.

**Recommandations**
1. Réserver la création de bookings/contact aux **authentifiés** : remplacer la branche anon par une exigence `auth.uid() IS NOT NULL` (le site exige de toute façon une session Discord pour réserver — `06-auth-oauth.ts`).
2. Ou activer un vrai rate-limit applicatif (Supabase `auth` + quota GoTrue, ou passer la création par le bot API qui est déjà limité).
3. Envisager de **désactiver l'inscription email** (patch 08-17, étape recommandée e) — le site ne l'utilise pas ; elle réduit aussi la surface anti-spam de comptes.

---

## 🟠 5. Privilège staff dérivé du nom des rôles Discord (Moyenne)

`bot/config/constants.js` `isStaffMember()` l.112-118 : un membre est staff si un de ses rôles contient **par nom** l'un des mots-clés `staff, admin, owner, fondateur, gérant, gerant, concierge, modérateur, moderator, direction, responsable, patron, majordome`.

Un rôle non privilégié dont le nom contient l'un de ces mots (ex. « Ex-responsable évents », « Ancien Staff », « Partenariat ») confère : boutons d'acceptation/refus de réservations (`interactionCreate.js` l.147), réponses DM, clôture de tickets, et marquage `sender_role='staff'` dans la synchro chat (`chatSyncHandler.js` l.39). Le check « pas le créateur du ticket ⇒ staff » (`chatSyncHandler.js` l.40-42) amplifie : tout membre non-créateur qui peut écrire dans un ticket est traité staff.

**Recommandation** : `isStaffMember` basé uniquement sur les **IDs de rôles** (whitelist `ROLE_*_ID`) + `MASTER_OWNERS` + permissions Discord ; supprimer le matching par mots-clés (ou le restreindre à un ensemble d'IDs explicite).

---

## 🟡 6. Config headers/CSP/CORS (Moyenne)

- `vercel.json` l.44 : `script-src 'self' 'unsafe-inline' https://js.stripe.com` — `'unsafe-inline'` annule en pratique la protection XSS du CSP (et les attributs `onclick` ne sont de toute façon pas couverts par une politique sans nonce). Recommandé : supprimer `unsafe-inline` (nonces/hashes), retirer les domaines CDN inutilisés (`js.stripe.com`, `cdnjs.cloudflare.com`, `db.onlinewebfonts.com`, `fonts.googleapis.com` — à confirmer côté pages), resserrer `connect-src` : `https://*.onrender.com` → nom exact du service ; `https://*.supabase.co` → `https://ghbeopdnfdxuqfjzmmeb.supabase.co` (+ `wss://`).
- `bot/services/apiServer.js` l.212-216 : CORS autorise `https://[a-z0-9-]+\.vercel\.app` (tous les projets Vercel, y compris ceux d'attaquants) et `https://([a-z0-9-]+\.)*richman-estate\.com`. Restreindre au(x) domaine(s) de production réel(s) + previews du projet exact.
- Headers manquants (mineur) : `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` ; `X-XSS-Protection` est obsolète (à retirer, remplacé par le CSP).

---

## 🟡 7. Dépendances (Moyenne)

`npm audit` (registre, exécuté) :
- **vite 5.4.21** → 1 **high** : `GHSA-fx2h-pf6j-xcff` (bypass `server.fs.deny` via chemins alternatifs Windows — CVE-2025-46565, exploitable sur le dev-server, machine Windows) + advisories `GHSA-4w7w-66w2-5vf9` (path traversal `.map`) et `GHSA-v6wh-96g9-6wx3` (disclosure hash NTLMv2 via `launch-editor`). Fix disponible : vite 8 (majeur).
- **esbuild 0.21.5** → 1 moderate : `GHSA-67mh-4wv8-2f99` (dev-server, CORS).
- Impact production : **nul** (outils de build/dev uniquement — Vercel build côté serveur) ; impact dev réel si quelqu'un expose `npm run dev`/`preview` sur le réseau.
- **`bot/`** : pas de `package-lock.json` → versions flottantes (`discord.js ^14.14.1`, `dotenv ^16.4.5`), dépendances transitives non auditées (undici). Ajouter le lockfile et auditer.

Versions saines par ailleurs : `@supabase/supabase-js 2.112.3`, `dompurify 3.4.13` (CVE-2025-26791 corrigée), `rollup 4.62.4`, `typescript 5.9.3`.

---

## 🟡 8. Divers (Moyen/faible)

| Constat | Fichier | Note |
|---|---|---|
| `profiles.update({discord_roles})` depuis l'UI admin | `03-admin-users.ts` l.402 | Colonne révoquée pour `authenticated` (patch 08-17 l.303) → échec silencieux de la synchro des rôles Discord (fonctionnel). Passer par une RPC service_role ou supprimer la feature. |
| `logs` insérables par tout authentifié, contenu arbitraire (name/phone/action) | policies SQL | Falsification de l'audit trail par un client ; sans gravité mais à restreindre (whitelist d'actions serveur). |
| Oracle d'existence : `booking_exists` grantée anon/authenticated ; `get_booking_details` distingue « Accès refusé » de 0 ligne | SQL | Énumération UUID possible (risque faible, UUID v4). |
| Rate-limit IP : dernier élément de `X-Forwarded-For` | `apiServer.js` l.490-491 | Correct si le proxy **append** l'IP réelle (Render) ; à confirmer — sinon rotation du header = bypass. |
| `robots.txt` référence `sitemap.xml` inexistant | `public/robots.txt` l.6 | 404 pour les crawlers ; générer ou supprimer. |
| JWT anon en dur dans les tests | `tests/audit_system.js` l.28 | Clé anon = publique par design, pas un secret réel ; à déplacer en env pour l'hygiène. |
| `MASTER_OWNERS` second ID en dur (`1015310406169923665`) | `apiServer.js` l.181, `constants.js` l.77 | Cohérent avec `trusted_founders` (l.26) ; à garder synchronisé entre code et base. |
| 2ᵉ passe anti-énumération `check-user-roles` : GET autorisé pour son propre ID | `apiServer.js` l.687-693 | Correct. |

---

## ✅ Ce qui est bien fait (à préserver)

- **RLS activée sur toutes les tables** ; policies fines (propriétaire / `is_admin` / `is_strict_admin` / public).
- **Trigger `protect_role_update`** : rôle, `discord_roles`, `id`, `discord_id` verrouillés (auto-promotion impossible, y compris via `user_metadata` forgeable et via l'inscription email — patch 08-17).
- **`trusted_founders`** fermée (aucun grant anon/authenticated) ; fondateur reconnu uniquement via `auth.identities` (OAuth Discord).
- **RPC sensibles** : `REVOKE … FROM PUBLIC, anon` (leçon du bug `PUBLIC` hérité), `SECURITY DEFINER` avec `search_path` fixé, gardes `is_admin()`/`service_role`, `admin_set_role` avec règle « seul l'owner gère l'owner ».
- **Bot API** : comparaison du secret en temps constant, anti-IDOR sur `register-member`/tickets, anti-énumération sur `check-user-roles`, quotas par bucket (global 120/min, écritures Discord 8/min), payload ≤ 1 Mo, CORS restreint, cache auth borné, anti-spoofing XFF, confinement `127.0.0.1` en local.
- **Frontend** : DOMPurify configuré, `safeJsArg` correct dans les tableaux admin (bookings), `isMasterOwner` basé sur le rôle en base, redirection admin si non-staff, `sanitizeUrl` anti-`javascript:`.
- **OG/proxy** : whitelist d'hôtes + revalidation du schéma à chaque redirect (anti-SSRF), cap 15 Mo, MIME `image/*`, échappement `escapeAttr`.
- **Git & build** : aucun secret dans l'historique ni dans `dist/` ; `dompurify`/`supabase-js` épinglés.

---

## 📋 Actions prioritaires

1. **[Urgent]** Rotation des secrets (token Discord, webhook, `BOT_API_SECRET` aléatoire ≥ 32 octets) → variables d'environnement ; ne plus stocker de `.env` avec secrets sur disque.
2. **[Urgent]** Ajouter `SUPABASE_SERVICE_ROLE_KEY` à l'env du bot ; corriger `/api/sync-booking-message` en **fail-closed** (403 si dossier introuvable ou non possédé).
3. **[Urgent]** Corriger les 4 interpellations `onclick` XSS (→ `safeJsArg` ou closures) + test statique de régression.
4. **[Haut]** Fermer le flood anonyme (`create_booking`/bookings/contact/reviews → authentifiés requis) ; désactiver l'inscription email si inutilisée.
5. **[Haut]** `isStaffMember` par IDs de rôles uniquement (supprimer le matching par mots-clés).
6. **[Moyen]** CSP sans `unsafe-inline` + `connect-src`/CORS resserrés ; maj vite (v7/v8) ; lockfile `bot/`.
7. **[Vérif]** S'assurer de l'**ordre d'application des patches SQL en base** : `supabase_schema.sql` → `08-15` → `08-16` → `08-16b` → `08-17` (le patch 08-15 réintroduit temporairement le matching par `full_name` supprimé par le 08-17 — ne jamais réappliquer 08-15 après 08-17) ; exécuter l'étape 11b du patch 08-17 (purge des profils `owner` non légitimes) ; puis rejouer `npm run audit` avec les clés réelles.

*Rapport produit par audit statique complet du dépôt (17/08/2026). Les vérifications live (base, Render, tokens) restent à exécuter avec les accès réels.*
