/* ==========================================================================
   Richman Estate — 05-ctg-database.ts
   Base CTG : import catalogue véhicules & pagination
   Porté de main.js (05-ctg-database.js) — ES module + TypeScript.
   ========================================================================== */

import { escapeHTML, sanitizeUrl } from "../core/sanitize";
import { state } from "../core/state";
import { showToast, openModal, updateCalculatedPrice, writeLog } from "./02-admin-crud";

// ==========================================================================
// CTG Database Loader & Pagination Logic
// ==========================================================================
let ctgVehiclesCache: any = null;
let currentCTGPage = 1;
let totalCTGPages = 1;

export function getCTGClassStyle(className: any) {
  const name = className ? className.toUpperCase() : '';
  let color = '#22d3ee'; // default cyan (Compacts, Sedans, Vans, etc.)

  if (name.includes('SUPER')) color = '#f43f5e'; // rose/red
  else if (name.includes('SPORT') && !name.includes('CLASSIC')) color = '#fb923c'; // orange
  else if (name.includes('CLASSIC') || name.includes('COUPE')) color = '#c084fc'; // purple
  else if (name.includes('SUV')) color = '#34d399'; // green
  else if (name.includes('MUSCLE')) color = '#f87171'; // red
  else if (name.includes('OFF_ROAD') || name.includes('MOTO') || name.includes('CYCLE')) color = '#a78bfa'; // violet
  else if (name.includes('UTILITY') || name.includes('COMMERCIAL') || name.includes('SERVICE') || name.includes('INDUSTRIAL')) color = '#38bdf8'; // light blue
  else if (name.includes('EMERGENCY') || name.includes('MILITARY')) color = '#ef4444'; // deep red
  else if (name.includes('BOAT') || name.includes('HELI') || name.includes('PLANE')) color = '#06b6d4'; // cyan-teal

  return {
    color: color,
    border: `1px solid ${color}`,
    bg: `rgba(9, 15, 30, 0.65)`,
    shadow: `0 0 10px ${color}35`
  };
}

function applySavedCTGEdits() {
  if (!ctgVehiclesCache) return;
  try {
    const saved = localStorage.getItem("ctg_vehicles_custom_edits");
    if (saved) {
      const edits = JSON.parse(saved);
      ctgVehiclesCache = ctgVehiclesCache.map((v: any) => {
        if (edits[v.Name]) {
          return { ...v, ...edits[v.Name] };
        }
        return v;
      });
    }
  } catch (e) {
    console.error("Error applying CTG edits from storage:", e);
  }
}

export async function loadCTGDatabase(page = 1) {
  const grid = document.getElementById("ctg-database-grid");
  if (!grid) return;

  currentCTGPage = page;

  // 1. Load local JSON if not cached
  if (!ctgVehiclesCache) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #8e8e8e; padding: 40px 0; font-family: var(--font-sans);"><i class="fa-solid fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 8px;"></i><br>Chargement de la base locale (1159 véhicules)...</div>`;
    try {
      let res = await fetch("/data/ctg_vehicles.json");
      if (!res.ok) {
        res = await fetch("data/ctg_vehicles.json");
      }
      if (!res.ok) {
        res = await fetch("/ctg_vehicles.json");
      }
      if (!res.ok) {
        res = await fetch("ctg_vehicles.json");
      }
      if (!res.ok) throw new Error("Erreur de chargement de ctg_vehicles.json");
      ctgVehiclesCache = await res.json();
      applySavedCTGEdits();
    } catch (err) {
      console.error(err);
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #fca5a5; padding: 40px 0; font-family: var(--font-sans);"><i class="fa-solid fa-triangle-exclamation" style="font-size: 24px; margin-bottom: 8px;"></i><br>Impossible de charger la base locale des véhicules. Vérifiez que ctg_vehicles.json est bien présent.</div>`;
      return;
    }
  }

  // 2. Client-side Search and Filters
  const searchQuery = (document.getElementById("ctg-search-input") as HTMLInputElement | null)?.value.toLowerCase().trim() || "";
  const filterType = (document.getElementById("ctg-filter-type") as HTMLSelectElement | null)?.value || "";
  const filterClass = (document.getElementById("ctg-filter-class") as HTMLSelectElement | null)?.value || "";
  const filterConcession = (document.getElementById("ctg-filter-concession") as HTMLSelectElement | null)?.value || "all";

  let filtered = [...ctgVehiclesCache];

  // Apply Search
  if (searchQuery) {
    filtered = filtered.filter((item: any) =>
      item.Name.toLowerCase().includes(searchQuery) ||
      (item.Manufacturer && item.Manufacturer.toLowerCase().includes(searchQuery))
    );
  }

  // Apply Type
  if (filterType) {
    filtered = filtered.filter((item: any) => item.Type === filterType);
  }

  // Apply Class
  if (filterClass) {
    filtered = filtered.filter((item: any) => item.Class === filterClass);
  }

  // Apply Availability
  if (filterConcession !== "all") {
    if (filterConcession === "concession") {
      filtered = filtered.filter((item: any) => item.Concession === 1);
    } else if (filterConcession === "hors-concession") {
      filtered = filtered.filter((item: any) => item.Concession === 0);
    } else if (filterConcession === "cox") {
      filtered = filtered.filter((item: any) => item.coxAvailable === true);
    } else if (filterConcession === "onsale") {
      filtered = filtered.filter((item: any) => item.onSale === true);
    }
  }

  const total = filtered.length;
  const limit = 24;
  totalCTGPages = Math.ceil(total / limit) || 1;

  // Adjust current page if out of bounds
  if (currentCTGPage > totalCTGPages) currentCTGPage = totalCTGPages;
  if (currentCTGPage < 1) currentCTGPage = 1;

  // Update Badge
  const countBadge = document.getElementById("ctg-count-badge");
  if (countBadge) {
    countBadge.textContent = `${total.toLocaleString('fr-FR')} véhicule${total !== 1 ? 's' : ''}`;
  }

  // Update Pagination UI
  const pageInfo = document.getElementById("ctg-page-info");
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentCTGPage} sur ${totalCTGPages}`;
  }

  const prevBtn = document.getElementById("ctg-prev-page") as HTMLButtonElement | null;
  const nextBtn = document.getElementById("ctg-next-page") as HTMLButtonElement | null;
  if (prevBtn) prevBtn.disabled = currentCTGPage <= 1;
  if (nextBtn) nextBtn.disabled = currentCTGPage >= totalCTGPages;

  // Slice data for current page
  const startIdx = (currentCTGPage - 1) * limit;
  const pageData = filtered.slice(startIdx, startIdx + limit);

  grid.innerHTML = "";
  if (pageData.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #8e8e8e; padding: 40px 0; font-family: var(--font-sans);">Aucun véhicule trouvé dans la base locale.</div>`;
    return;
  }

  pageData.forEach((item: any) => {
    const card = document.createElement("div");
    card.className = "admin-card-item";
    card.style.display = "flex";
    card.style.flexDirection = "column";

    const rawImageUrl = item.screenshotUrl
      ? `https://api.staff.gta.ctgaming.fr:2096${item.screenshotUrl}`
      : 'assets/logo.webp';
    const imageUrl = escapeHTML(sanitizeUrl(rawImageUrl, 'assets/logo.webp'));

    const displayName = escapeHTML(`${item.Manufacturer ? item.Manufacturer.toLowerCase() : ''} ${item.Name}`.trim());
    const safeItemName = escapeHTML(item.Name || '');
    const safeClass = escapeHTML(item.Class || 'SPORT');
    const encodedName = encodeURIComponent(item.Name || '');
    const safePriceNum = Number(item.Price) || 0;
    const classStyle = getCTGClassStyle(item.Class);

      card.innerHTML = `
        <div class="ctg-image-wrapper">
          <img src="${imageUrl}" alt="${safeItemName}" onerror="this.src='assets/logo.webp';" />
          <span class="type-tag" style="position: absolute; top: 8px; right: 8px; font-family: monospace; font-size: 10px; z-index: 2;">${safeClass}</span>
        </div>
        <h3 style="margin: 4px 0 2px 0; font-size: 14.5px; font-weight: 700; text-transform: capitalize; color: #ffffff;">${displayName}</h3>
        <div style="margin: 0 0 8px 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: 11.5px; color: #71717a; display: inline-flex; align-items: center; gap: 4px;">Spawn : <strong style="color: #ffffff; font-family: monospace; font-size: 11.5px; background: #18181b; padding: 2px 6px; border-radius: 4px; border: 1px solid #27272a;">${safeItemName}</strong></span>
          <span style="font-size: 12px; color: #a1a1aa; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;"><i class="fa-solid fa-gauge-high" style="font-size: 11px;"></i> ${Math.round(parseFloat(item.MaxSpeed || 0) * 3.6)} km/h</span>
        </div>
        <div style="margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid #1f1f23; flex-wrap: wrap;">
          <span class="card-price">${item.Price ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(item.Price) : 'Importable'}</span>
          <div style="display: flex; gap: 4px;">
            <button class="admin-btn-secondary" onclick="window.openEditCTGModal(decodeURIComponent('${encodedName}'))" style="padding: 0 8px; font-size: 11px; height: 28px;" title="Modifier les infos"><i class="fa-solid fa-pen"></i></button>
            <button class="admin-btn-primary" onclick="window.importCTGToFleet(decodeURIComponent('${encodedName}'), '${safePriceNum}', '${safeClass}')" style="padding: 0 10px; font-size: 11.5px; height: 28px;" title="Importer dans la Flotte"><i class="fa-solid fa-file-import"></i> Importer</button>
          </div>
        </div>
      `;
    grid.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // CTG Database Dedicated Modal Handlers
  const ctgModalOverlay = document.getElementById('ctg-modal-overlay');
  const ctgModalCloseBtn = document.getElementById('ctg-modal-close-btn');
  const ctgModalCancelBtn = document.getElementById('ctg-modal-cancel-btn');
  const ctgModalForm = document.getElementById('ctg-modal-form');

  function openCTGModal() {
    if (ctgModalOverlay) {
      ctgModalOverlay.classList.add('active');
      ctgModalOverlay.removeAttribute('aria-hidden');
    }
  }

  function closeCTGModal() {
    if (ctgModalOverlay) {
      if (document.activeElement && ctgModalOverlay.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      ctgModalOverlay.classList.remove('active');
      ctgModalOverlay.setAttribute('aria-hidden', 'true');
      if (ctgModalForm) (ctgModalForm as HTMLFormElement).reset();
    }
  }

  if (ctgModalCloseBtn) ctgModalCloseBtn.addEventListener('click', closeCTGModal);
  if (ctgModalCancelBtn) ctgModalCancelBtn.addEventListener('click', closeCTGModal);
  if (ctgModalOverlay) {
    ctgModalOverlay.addEventListener('click', (e) => {
      if (e.target === ctgModalOverlay) closeCTGModal();
    });
  }

  (window as any).openEditCTGModal = function (name: any) {
    if (!ctgVehiclesCache) return;
    const item = ctgVehiclesCache.find((v: any) => v.Name === name);
    if (!item) return;

    openCTGModal();

    const originalNameInput = document.getElementById('ctg-item-original-name') as HTMLInputElement | null;
    if (originalNameInput) originalNameInput.value = item.Name;

    const nameInput = document.getElementById('ctg-item-name') as HTMLInputElement | null;
    if (nameInput) nameInput.value = item.Name;

    const manufacturerInput = document.getElementById('ctg-item-manufacturer') as HTMLInputElement | null;
    if (manufacturerInput) manufacturerInput.value = item.Manufacturer || '';

    const classSelect = document.getElementById('ctg-item-class') as HTMLSelectElement | null;
    if (classSelect) classSelect.value = item.Class || 'SPORT';

    const concessionSelect = document.getElementById('ctg-item-concession') as HTMLSelectElement | null;
    if (concessionSelect) concessionSelect.value = item.Concession !== undefined ? item.Concession.toString() : '0';

    const priceInput = document.getElementById('ctg-item-price') as HTMLInputElement | null;
    if (priceInput) priceInput.value = item.Price || 0;

    const speedInput = document.getElementById('ctg-item-speed') as HTMLInputElement | null;
    if (speedInput) {
      const speed = item.MaxSpeed ? Math.round(parseFloat(item.MaxSpeed) * 3.6) : 0;
      speedInput.value = String(speed);
    }

    const imageInput = document.getElementById('ctg-item-image') as HTMLInputElement | null;
    if (imageInput) imageInput.value = item.screenshotUrl || '';
  };

  if (ctgModalForm) {
    ctgModalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const origName = (document.getElementById('ctg-item-original-name') as HTMLInputElement | null)?.value;
      if (!origName || !ctgVehiclesCache) return;

      const manufacturer = ((document.getElementById('ctg-item-manufacturer') as HTMLInputElement | null)?.value || '').toUpperCase().trim();
      const className = (document.getElementById('ctg-item-class') as HTMLSelectElement | null)?.value || 'SPORT';
      const concession = parseInt((document.getElementById('ctg-item-concession') as HTMLSelectElement | null)?.value || '0', 10);
      const price = parseFloat((document.getElementById('ctg-item-price') as HTMLInputElement | null)?.value) || 0;
      const speedKmh = parseFloat((document.getElementById('ctg-item-speed') as HTMLInputElement | null)?.value) || 0;
      const screenshotUrl = ((document.getElementById('ctg-item-image') as HTMLInputElement | null)?.value || '').trim();

      // 1. Update in-memory cache
      const vehicle = ctgVehiclesCache.find((v: any) => v.Name === origName);
      if (vehicle) {
        vehicle.Manufacturer = manufacturer;
        vehicle.Class = className;
        vehicle.Concession = concession;
        vehicle.Price = price;
        if (speedKmh > 0) {
          vehicle.MaxSpeed = (speedKmh / 3.6).toString();
        }
        if (screenshotUrl) {
          vehicle.screenshotUrl = screenshotUrl;
        }
      }

      // 2. Persist in localStorage
      try {
        const saved = localStorage.getItem("ctg_vehicles_custom_edits");
        const edits = saved ? JSON.parse(saved) : {};
        edits[origName] = {
          Manufacturer: manufacturer,
          Class: className,
          Concession: concession,
          Price: price,
          MaxSpeed: speedKmh > 0 ? (speedKmh / 3.6).toString() : vehicle?.MaxSpeed,
          screenshotUrl: screenshotUrl || vehicle?.screenshotUrl
        };
        localStorage.setItem("ctg_vehicles_custom_edits", JSON.stringify(edits));
      } catch (err) {
        console.error("Erreur sauvegarde localStorage:", err);
      }

      // 3. Log action
      const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");
      await writeLog(`Modification fiche Base CTG: ${origName} (${manufacturer || 'Inconnu'})`, activeUser.name || 'Fondateur', 'success');

      // 4. Update UI
      showToast(`✅ Véhicule "${origName}" mis à jour directement dans la Base de Données !`, "success");
      closeCTGModal();
      loadCTGDatabase(currentCTGPage);
    });
  }

  (window as any).editFleetItem = function (id: any) {
    const item = state.allVehicles ? state.allVehicles.find((v: any) => v.id === id) : null;
    if (!item) return;

    openModal();

    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) modalTitle.textContent = "Modifier le Véhicule";

    const adminModalForm = document.getElementById('admin-modal-form') as HTMLFormElement | null;
    if (adminModalForm) adminModalForm.dataset.editId = id;

    const nameInput = document.getElementById('item-name') as HTMLInputElement | null;
    if (nameInput) nameInput.value = item.name || '';

    const priceInput = document.getElementById('item-price') as HTMLInputElement | null;
    if (priceInput) priceInput.value = item.price || '';

    const statusSelect = document.getElementById('item-status') as HTMLSelectElement | null;
    if (statusSelect) statusSelect.value = item.status || 'confirmed';

    let meta: any = {};
    try {
      if (item.specs && item.specs.startsWith('{')) {
        meta = JSON.parse(item.specs);
      }
    } catch (e) {}

    const classSelect = document.getElementById('item-class') as HTMLSelectElement | null;
    if (classSelect) classSelect.value = meta.class || 'SUPER';

    const plateInput = document.getElementById('item-plate') as HTMLInputElement | null;
    if (plateInput) plateInput.value = meta.plate || '';

    const specsInput = document.getElementById('item-specs') as HTMLInputElement | null;
    if (specsInput) specsInput.value = meta.specs_text || (typeof item.specs === 'string' && !item.specs.startsWith('{') ? item.specs : '');

    const dealerPriceInput = document.getElementById('item-dealer-price') as HTMLInputElement | null;
    if (dealerPriceInput) dealerPriceInput.value = meta.dealer_price || 0;

    const rentalPercentInput = document.getElementById('item-rental-percent') as HTMLInputElement | null;
    if (rentalPercentInput) rentalPercentInput.value = meta.rental_pct || 0.5;

    const mediaUrlInput = document.getElementById('item-media-url') as HTMLInputElement | null;
    if (mediaUrlInput && meta.media_url) {
      if (typeof meta.media_url === 'string') {
        mediaUrlInput.value = meta.media_url;
      } else if (Array.isArray(meta.media_url)) {
        mediaUrlInput.value = meta.media_url.join(', ');
      }
    }

    const mode = meta.use_auto_price ? 'auto' : 'custom';
    const modeRadio = document.querySelector(`input[name='price-mode'][value='${mode}']`) as HTMLInputElement | null;
    if (modeRadio) {
      modeRadio.checked = true;
      modeRadio.dispatchEvent(new Event('change'));
    }
  };

  (window as any).importCTGToFleet = function (name: any, price: any, type: any) {
    openModal();

    const nameInput = document.getElementById('item-name') as HTMLInputElement | null;
    if (nameInput) nameInput.value = name.toUpperCase();

    const classSelect = document.getElementById('item-class') as HTMLSelectElement | null;
    if (classSelect) classSelect.value = type || 'SPORT';

    const dealerPriceInput = document.getElementById('item-dealer-price') as HTMLInputElement | null;
    if (dealerPriceInput) dealerPriceInput.value = price || 0;

    const autoRadio = document.querySelector("input[name='price-mode'][value='auto']") as HTMLInputElement | null;
    if (autoRadio) {
      autoRadio.checked = true;
      autoRadio.dispatchEvent(new Event('change'));
    }

    const specsInput = document.getElementById('item-specs') as HTMLInputElement | null;
    if (specsInput) {
      specsInput.value = `Gamme ${type || 'SPORT'}`;
    }

    // Pre-calculate price
    updateCalculatedPrice();

    showToast("Véhicule importé avec calcul de tarif automatique !", "success");
  };

  // CTG Database Event Listeners
  const ctgSearchInput = document.getElementById('ctg-search-input');
  const ctgFilterType = document.getElementById('ctg-filter-type');
  const ctgFilterClass = document.getElementById('ctg-filter-class');
  const ctgFilterConcession = document.getElementById('ctg-filter-concession');
  const ctgPrevPageBtn = document.getElementById('ctg-prev-page');
  const ctgNextPageBtn = document.getElementById('ctg-next-page');

  let ctgDebounceTimer: any;
  if (ctgSearchInput) {
    ctgSearchInput.addEventListener('input', () => {
      clearTimeout(ctgDebounceTimer);
      ctgDebounceTimer = setTimeout(() => {
        loadCTGDatabase(1);
      }, 350);
    });
  }
  if (ctgFilterType) ctgFilterType.addEventListener('change', () => loadCTGDatabase(1));
  if (ctgFilterClass) ctgFilterClass.addEventListener('change', () => loadCTGDatabase(1));
  if (ctgFilterConcession) ctgFilterConcession.addEventListener('change', () => loadCTGDatabase(1));

  if (ctgPrevPageBtn) {
    ctgPrevPageBtn.addEventListener('click', () => {
      if (currentCTGPage > 1) {
        loadCTGDatabase(currentCTGPage - 1);
      }
    });
  }
  if (ctgNextPageBtn) {
    ctgNextPageBtn.addEventListener('click', () => {
      if (currentCTGPage < totalCTGPages) {
        loadCTGDatabase(currentCTGPage + 1);
      }
    });
  }

  // Stepper selection
  const stepItems = document.querySelectorAll(".step-item");
  stepItems.forEach((item) => {
    item.addEventListener("click", () => {
      stepItems.forEach((s) => s.classList.remove("active"));
      item.classList.add("active");
    });
  });

  // Auth Mode Switcher (Register vs Login)
  const authToggleBtn = document.getElementById("auth-toggle-mode");
  const formTitle = document.getElementById("form-title") as HTMLElement;
  const formSubtitle = document.getElementById("form-subtitle") as HTMLElement;
  const nameRow = document.getElementById("name-row") as HTMLElement;
  const passwordHint = document.getElementById("password-hint") as HTMLElement;
  const authSubmitBtn = document.getElementById("auth-submit-btn") as HTMLElement;
  const footerPrompt = document.getElementById("footer-prompt") as HTMLElement;

  let isSignUpMode = true;

  if (authToggleBtn) {
    authToggleBtn.addEventListener("click", () => {
      isSignUpMode = !isSignUpMode;

      if (isSignUpMode) {
        formTitle.textContent = "Create New Profile";
        formSubtitle.textContent = "Input your basic details to begin the journey.";
        nameRow.style.display = "grid";
        passwordHint.style.display = "block";
        authSubmitBtn.textContent = "Create Account";
        footerPrompt.textContent = "Member of the team?";
        authToggleBtn.textContent = "Log in";
      } else {
        formTitle.textContent = "Welcome Back";
        formSubtitle.textContent = "Enter your credentials to access your studio.";
        nameRow.style.display = "none";
        passwordHint.style.display = "none";
        authSubmitBtn.textContent = "Sign In";
        footerPrompt.textContent = "Don't have an account?";
        authToggleBtn.textContent = "Sign up";
      }
    });
  }

  // ---- Compat HTML : handlers globaux (affectations window d'origine conservées) ----
  (window as any).getCTGClassStyle = getCTGClassStyle;
  (window as any).loadCTGDatabase = loadCTGDatabase;
});
