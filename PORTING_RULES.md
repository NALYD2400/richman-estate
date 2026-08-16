# Contrat de portage JS → TS (modules 01→15)

Source (LECTURE SEULE, ne jamais modifier) : `C:\Users\dylan\Desktop\project rp richman\src\js\app\`
Destination : `C:\Users\dylan\Desktop\procject richman 2\src\modules\` (un fichier `.ts` par `.js`, même radical : `02-admin-crud.js` → `02-admin-crud.ts`)

## Règles

1. **Fidélité** : porter la logique à l'identique. Pas de refactor créatif, pas de renommage. Le but est un port ES modules + TypeScript qui se comporte exactement pareil.
2. **Imports du noyau** (déjà créés, ne pas les recréer) :
   - `import { escapeHTML, safeJsArg, sanitizeUrl, sanitizeHTML, setSafeInnerHTML } from "../core/sanitize";`
   - `import { supabaseClient, getSupabaseClient } from "../core/supabase";`
   - `import { botFetch, } from "../core/api";` et `import { getBotApiBase } from "../core/config";`
   - `import { formatLuxuryCarName, resolveVehiclePhotoUrl } from "../core/vehicles";`
   - Supprimer toute création locale de client Supabase et tout accès `window.supabaseClient` → utiliser l'import. Supprimer les usages de `DOMPurify` global → `sanitizeHTML`/`setSafeInnerHTML` du noyau.
3. **État partagé** : remplacer les identifiants nus suivants par `state.X` (lecture ET écriture), via `import { state } from "../core/state";` :
   `publicVehiclesList, publicSuitesList, onlyFavoritesFilter, currentFleetPage, currentSuitesPage, suitesPerPage, allVehicles, allSuites, allBookingsList, usersCache, uploadedImagesArray, uploadedSuiteImagesArray, cardActiveSlideMap`
   Les blocs `Object.defineProperty(window, ...)` (« Exports inter-parties ») sont SUPPRIMÉS.
4. **Fonctions partagées** : exporter en `export function ...` et importer depuis le module propriétaire. Carte de propriété (fonctions uniquement) :
   - `02-admin-crud` : showToast, openModal, closeModal, closeSuiteModal, closeUserModal, updateCalculatedPrice, applyFleetFilters, writeLog, loadVehicles, loadSuites, loadLogs, loadConciergeMessages
   - `03-admin-users` : applyUsersFilters, loadUsers
   - `04-confirm-modal` : updateKPIs
   - `05-ctg-database` : getCTGClassStyle, loadCTGDatabase
   - `06-auth-oauth` : renderHeaderNavUserPill, bindAdminUserCardDetails
   - `07-vehicles-showroom` : getVehicleRentalSchedule, isVehicleFavorite, getVehicleRatingSummary, getVehicleType, loadPublicVehicles
   - `08-media-carousel` : extractItemMediaArray
   - `09-showroom-pagination` : renderShowroomPagination, applyPublicFleetFilters, fallbackCopyTextToClipboard
   - `10-dropdowns-grid` : initRichmanGridSystem
   - `12-suites-showroom` : applyPublicSuitesFilters, loadPublicSuites
   - `13-client-portal` : appendMessageBubble, initClientPortal
   (`formatLuxuryCarName` vient du noyau `core/vehicles`, pas de 07.)
   En cas de dépendance circulaire : garder l'appel sous forme `(window as any).fn(...)` et conserver l'affectation window ci-dessous.
5. **Compat HTML** : le HTML statique appelle des handlers via `onclick="window.xxx(...)"`. CONSERVER toutes les affectations `window.xxx = xxx` existantes dans le fichier d'origine (écrire `(window as any).xxx = xxx;`). En ajouter aucune de nouvelle.
6. **onclick générés en JS** : si le fichier d'origine génère du HTML avec `onclick="...safeJsArg(x)..."`, le conserver tel quel (safeJsArg importé du noyau). Ne pas réécrire en closures lors de ce port.
7. **TypeScript** : `noImplicitAny` est désactivé — typer `any` par défaut est acceptable. `document.getElementById(...)` → `as HTMLElement | null` si nécessaire, ou `(document.getElementById("x") as HTMLInputElement)`. Ne pas se battre avec les types : le build doit passer, pas être parfait.
8. **Structure** : garder le `document.addEventListener("DOMContentLoaded", () => {...})` d'origine. Les déclarations `async function` restent des déclarations.
9. Vérifier chaque fichier porté avec `node --input-type=module --check` impossible pour TS → à la fin, lancer `cd "C:/Users/dylan/Desktop/procject richman 2" && npx tsc --noEmit` ne fonctionnera qu'une fois tous les fichiers présents : ignorer les erreurs de modules manquants d'autres agents, ne laisser AUCUNE erreur de syntaxe dans ses propres fichiers.
