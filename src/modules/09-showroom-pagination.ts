/* ==========================================================================
   Richman Estate — 09-showroom-pagination.ts
   Pagination showroom (flotte & suites)
   ========================================================================== */

import { escapeHTML } from "../core/sanitize";
import { formatLuxuryCarName } from "../core/vehicles";
import { state } from "../core/state";
import { showToast } from "./02-admin-crud";
import { isVehicleFavorite, getVehicleType, getVehicleRentalSchedule, getVehicleRatingSummary } from "./07-vehicles-showroom";
import { extractItemMediaArray } from "./08-media-carousel";

let fleetPerPage: any = 24;
try {
  const saved = localStorage.getItem("richman_fleet_per_page");
  if (saved) fleetPerPage = saved === 'all' ? 'all' : parseInt(saved, 10) || 24;
} catch (e) { console.warn('[Richman]', e); }

try {
  const saved = localStorage.getItem("richman_suites_per_page");
  if (saved) state.suitesPerPage = saved === 'all' ? 'all' : parseInt(saved, 10) || 24;
} catch (e) { console.warn('[Richman]', e); }

function scrollToShowroomTop() {
  const showroomEl = document.getElementById("showroom-section");
  if (showroomEl) {
    const yOffset = -30;
    const y = showroomEl.getBoundingClientRect().top + window.pageYOffset + yOffset;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}

export function renderShowroomPagination(prefix: string, currentPage: number, totalItems: number, perPage: any, onChangePage: (page: number) => void) {
  const wrap = document.getElementById(`${prefix}-pagination-wrap`);
  if (!wrap) return;

  if (totalItems === 0) {
    wrap.style.display = "none";
    return;
  }

  const isAll = perPage === 'all';
  const numPerPage = isAll ? totalItems : perPage;
  const totalPages = isAll ? 1 : Math.ceil(totalItems / numPerPage);

  if (totalPages <= 1 && totalItems <= 12) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "flex";

  const startItem = isAll ? 1 : (currentPage - 1) * numPerPage + 1;
  const endItem = isAll ? totalItems : Math.min(currentPage * numPerPage, totalItems);

  const rangeEl = document.getElementById(`${prefix}-page-range`);
  const totalCountEl = document.getElementById(`${prefix}-total-count`);
  if (rangeEl) rangeEl.textContent = `${startItem}-${endItem}`;
  if (totalCountEl) totalCountEl.textContent = String(totalItems);

  const prevBtn = document.getElementById(`${prefix}-prev-page`) as HTMLButtonElement | null;
  const nextBtn = document.getElementById(`${prefix}-next-page`) as HTMLButtonElement | null;
  if (prevBtn) prevBtn.disabled = (currentPage <= 1);
  if (nextBtn) nextBtn.disabled = (currentPage >= totalPages);

  const pagesContainer = document.getElementById(`${prefix}-pagination-pages`);
  if (pagesContainer) {
    pagesContainer.innerHTML = "";

    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');

      let start = Math.max(2, currentPage - 1);
      let end = Math.min(totalPages - 1, currentPage + 1);

      if (currentPage <= 3) {
        start = 2;
        end = 4;
      } else if (currentPage >= totalPages - 2) {
        start = totalPages - 3;
        end = totalPages - 1;
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    pages.forEach(p => {
      if (p === '...') {
        const ellipsis = document.createElement("span");
        ellipsis.className = "page-ellipsis";
        ellipsis.textContent = "…";
        pagesContainer.appendChild(ellipsis);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `page-number-btn ${p === currentPage ? 'active' : ''}`;
        btn.textContent = String(p);
        btn.onclick = () => onChangePage(p);
        pagesContainer.appendChild(btn);
      }
    });
  }

  const perPagePills = wrap.querySelectorAll(".per-page-pill");
  perPagePills.forEach(pill => {
    const pillVal = (pill as HTMLElement).dataset.per;
    pill.classList.toggle("active", String(pillVal) === String(perPage));
  });
}

export function applyPublicFleetFilters() {
  const grid = document.getElementById("public-fleet-grid");
  if (!grid) return;

  const searchVal = ((document.getElementById("public-fleet-search") as HTMLInputElement | null)?.value || "").toLowerCase().trim();
  const typeFilter = (document.getElementById("public-fleet-filter-type") as HTMLSelectElement | null)?.value || "all";
  const classFilter = (document.getElementById("public-fleet-filter-class") as HTMLSelectElement | null)?.value || "all";
  const statusFilter = (document.getElementById("public-fleet-filter-status") as HTMLSelectElement | null)?.value || "all";
  const sortBy = (document.getElementById("public-fleet-sort") as HTMLSelectElement | null)?.value || "recent";

  let list: any[] = [...state.publicVehiclesList];

  // 0. Favorites Filter
  if (state.onlyFavoritesFilter) {
    list = list.filter(v => isVehicleFavorite(v.id, v.name));
  }

  // 1. Search Query
  if (searchVal) {
    list = list.filter(v => {
      let metaText = "";
      try {
        if (v.specs && v.specs.startsWith("{")) {
          const m = JSON.parse(v.specs);
          metaText = `${m.specs_text || ''} ${m.class || ''} ${m.plate || ''}`;
        }
      } catch (e) { console.warn('[Richman]', e); }
      return v.name.toLowerCase().includes(searchVal) ||
             (v.specs && v.specs.toLowerCase().includes(searchVal)) ||
             metaText.toLowerCase().includes(searchVal);
    });
  }

  // 2. Type Filter (Voiture, Moto, Bateau, Hélico, Avion)
  if (typeFilter !== 'all') {
    list = list.filter(v => getVehicleType(v) === typeFilter.toLowerCase());
  }

  // 3. Class Filter (SUPER, SPORT, SUV, COUPE, etc.)
  if (classFilter !== 'all') {
    list = list.filter(v => {
      let vClass = "SUPER";
      try {
        if (v.specs && v.specs.startsWith("{")) {
          const m = JSON.parse(v.specs);
          vClass = (m.class || "SUPER").toUpperCase();
        }
      } catch (e) { console.warn('[Richman]', e); }
      return vClass.includes(classFilter.toUpperCase()) || classFilter.toUpperCase().includes(vClass);
    });
  }

  // 4. Status Filter
  if (statusFilter !== 'all') {
    list = list.filter(v => v.status === statusFilter);
  }

  // 5. Sorting
  if (sortBy === 'recent') {
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (sortBy === 'price-asc' || sortBy === 'price-desc') {
    const parsePrice = (p: string) => {
      const num = parseInt((p || '').replace(/[^0-9]/g, ''), 10);
      return isNaN(num) ? 0 : num;
    };
    list.sort((a, b) => {
      const pA = parsePrice(a.price);
      const pB = parsePrice(b.price);
      return sortBy === 'price-asc' ? pA - pB : pB - pA;
    });
  } else if (sortBy === 'name-asc') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Keep footer stat dynamically synchronized with the exact number of displayed available vehicles
  const statFleetCountEl = document.getElementById("stat-fleet-count");
  if (statFleetCountEl) {
    const activeCount = list.filter(v => v.status === 'confirmed').length;
    const displayCount = list.length === 0 ? 0 : (activeCount > 0 ? activeCount : list.length);
    (window as any).animateCustomCounter(statFleetCountEl, displayCount, 600, 0);
  }

  grid.innerHTML = "";

  const fleetPaginationWrap = document.getElementById("fleet-pagination-wrap");

  if (list.length === 0) {
    if (fleetPaginationWrap) fleetPaginationWrap.style.display = "none";
    if (state.onlyFavoritesFilter) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: #8e8e8e; padding: 60px 20px;">
          <i class="fa-regular fa-heart" style="font-size: 38px; color: #ef4444; margin-bottom: 14px; display: block; opacity: 0.6;"></i>
          <h3 style="font-size: 17px; font-weight: 700; color: #ffffff; margin-bottom: 6px;">Aucun véhicule dans vos favoris</h3>
          <p style="font-size: 13.5px; color: #a1a1aa; max-width: 420px; margin: 0 auto 16px auto;">Cliquez sur l'icône cœur <i class="fa-solid fa-heart" style="color: #ef4444;"></i> d'un bolide du showroom pour l'ajouter à votre sélection VIP.</p>
          <button type="button" class="showroom-fav-btn active" onclick="window.toggleFavoritesFilter()" style="margin: 0 auto;">Afficher tous les véhicules</button>
        </div>
      `;
    } else {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: #8e8e8e; padding: 60px 0;">
          <i class="fa-solid fa-car-side" style="font-size: 32px; color: #71717a; margin-bottom: 12px; display: block;"></i>
          <p style="font-size: 15px; font-weight: 500; color: #d4d4d8;">Aucun véhicule ne correspond à vos critères de recherche.</p>
        </div>
      `;
    }
    return;
  }

  // Pagination Slicing
  const totalCount = list.length;
  const isAll = fleetPerPage === 'all';
  const numPerPage = isAll ? totalCount : fleetPerPage;
  const totalPages = isAll ? 1 : Math.ceil(totalCount / numPerPage) || 1;

  if (state.currentFleetPage > totalPages) state.currentFleetPage = totalPages;
  if (state.currentFleetPage < 1) state.currentFleetPage = 1;

  const startIndex = isAll ? 0 : (state.currentFleetPage - 1) * numPerPage;
  const pagedList = isAll ? list : list.slice(startIndex, startIndex + numPerPage);

  pagedList.forEach(item => {
    let displaySpecs = "";
    let displayPlate = "LXS-RICH";
    let displayClass = "SUPER";

    try {
      if (item.specs && item.specs.startsWith("{")) {
        const meta = JSON.parse(item.specs);
        displaySpecs = meta.specs_text || "";
        displayPlate = meta.plate || "LXS-RICH";
        displayClass = meta.class || "SUPER";
      } else if (item.specs) {
        displaySpecs = item.specs;
      }
    } catch (e) { console.warn('[Richman]', e); }

    if (!displaySpecs || displaySpecs.toLowerCase().startsWith("gamme")) {
      displaySpecs = "Motorisation préparée haute performance, finitions carbone et intérieur cuir sur mesure.";
    }

    const photos = extractItemMediaArray(item, 'vehicule');
    const hasMultiplePhotos = photos.length > 1;
    const initialIndex = state.cardActiveSlideMap.get(item.id) || 0;

    const schedule = getVehicleRentalSchedule(item, (window as any).activeFleetBookings);
    const isAvailable = schedule.isAvailable;
    const cleanTitle = formatLuxuryCarName(item.name);
    const isFav = isVehicleFavorite(item.id, item.name);
    const ratingSummary = getVehicleRatingSummary(item.id);

    const card = document.createElement("div");
    card.className = "public-vehicle-card";
    card.innerHTML = `
      <div>
        <div class="public-card-media" onclick="window.openRichmanLightbox('${escapeHTML(item.id)}', 'vehicule')">
          <span class="public-badge-status ${isAvailable ? 'confirmed' : 'rented'}">
            <i class="fa-solid ${isAvailable ? 'fa-circle-check' : 'fa-clock'}"></i>
            <span>${isAvailable ? 'Disponible' : schedule.statusBadgeText}</span>
          </span>
          <span class="public-badge-category">
            ${escapeHTML(displayClass)}
          </span>
          <button type="button" class="btn-card-fav ${isFav ? 'active' : ''}" data-vehicle-id="${escapeHTML(item.id)}" onclick="window.toggleVehicleFavorite(event, '${escapeHTML(item.id)}', '${escapeHTML(item.name)}')" title="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">
            <i class="fa-${isFav ? 'solid' : 'regular'} fa-heart"></i>
          </button>
          <button type="button" class="btn-card-fullscreen" title="Voir en Plein Écran" onclick="event.stopPropagation(); window.openRichmanLightbox('${escapeHTML(item.id)}', 'vehicule')">
            <i class="fa-solid fa-expand"></i>
          </button>

          <div class="card-media-slider" id="carousel-${escapeHTML(item.id)}">
            ${photos.map((src: string, i: number) => `
              <img src="${escapeHTML(src)}" alt="${escapeHTML(cleanTitle)}" class="card-slide-img ${i === initialIndex ? 'active' : ''}" loading="lazy" onerror="this.onerror=null; this.src='assets/logo.webp';" />
            `).join('')}
          </div>

          ${hasMultiplePhotos ? `
            <button type="button" class="card-carousel-arrow prev" title="Photo précédente" onclick="event.stopPropagation(); window.slideCardCarousel('${escapeHTML(item.id)}', -1)">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <button type="button" class="card-carousel-arrow next" title="Photo suivante" onclick="event.stopPropagation(); window.slideCardCarousel('${escapeHTML(item.id)}', 1)">
              <i class="fa-solid fa-chevron-right"></i>
            </button>
            <div class="card-carousel-dots" id="dots-${escapeHTML(item.id)}">
              ${photos.map((_: string, i: number) => `
                <span class="carousel-dot ${i === initialIndex ? 'active' : ''}" onclick="event.stopPropagation(); window.goToCardSlide('${escapeHTML(item.id)}', ${i})"></span>
              `).join('')}
            </div>
            <div class="card-photo-counter" id="counter-${escapeHTML(item.id)}">${initialIndex + 1} / ${photos.length}</div>
          ` : ''}
        </div>

        <div class="public-card-body">
          <div>
            <div class="public-card-title-row">
              <h3 class="public-card-title" title="Voir la fiche détaillée" onclick="window.openVehicleDetailModal('${escapeHTML(item.id)}')">${escapeHTML(cleanTitle)}</h3>
              <span class="public-card-plate">${escapeHTML(displayPlate)}</span>
            </div>

            <div class="public-card-meta-chips">
              <span class="meta-chip meta-chip-rating" onclick="window.openVehicleReviewsModal('${escapeHTML(item.id)}')" title="Consulter et donner un avis">
                <i class="fa-solid fa-star" style="color: #fbbf24;"></i> ${ratingSummary.avg.toFixed(1)} <span style="opacity: 0.75; font-size: 10.5px;">(${ratingSummary.count})</span>
              </span>
              <span class="meta-chip"><i class="fa-solid fa-gauge-high"></i> ${escapeHTML(displayClass)}</span>
              <span class="meta-chip"><i class="fa-solid fa-shield-halved"></i> Flotte Assurée VIP</span>
            </div>

            <p class="public-card-specs">${escapeHTML(displaySpecs)}</p>
          </div>

          <div class="public-card-bottom">
            <div class="public-card-price-wrap">
              <span class="public-card-price-label">Tarif Location</span>
              <span class="public-card-price-val">${escapeHTML(item.price || 'Sur devis')} <span style="font-size: 11px; font-weight: 500; color: #a1a1aa;">/ 24h</span></span>
            </div>

            <div class="public-card-actions">
              <button type="button" class="btn-card-share-action" onclick="window.shareVehicleLink(decodeURIComponent('${encodeURIComponent(item.name || '')}'), decodeURIComponent('${encodeURIComponent(cleanTitle || '')}'))" title="Partager ce véhicule">
                <i class="fa-solid fa-share-nodes"></i>
              </button>
              <button type="button" class="btn-card-reserve ${isAvailable ? '' : 'rented'}" onclick="window.openVehicleReservationModal('${escapeHTML(item.id)}')">
                <i class="fa-solid ${isAvailable ? 'fa-key' : 'fa-calendar-days'}"></i>
                <span>${isAvailable ? 'Réserver' : schedule.reserveBtnText}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  renderShowroomPagination("fleet", state.currentFleetPage, totalCount, fleetPerPage, (window as any).goToFleetPage);

  if (typeof (window as any).initRichmanGridSystem === 'function') {
    (window as any).initRichmanGridSystem();
  }
}

// Fallback Clipboard Copy & Share Helpers
export function fallbackCopyTextToClipboard(text: string, displayTitle: string) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    showToast(`✨ Lien copié ! Prêt à partager : ${displayTitle || 'Véhicule'}`, 'success');
  } catch (err) {
    showToast("Impossible de copier automatiquement le lien.", "error");
  }
  document.body.removeChild(textArea);
}

document.addEventListener("DOMContentLoaded", () => {
  // Compat inter-modules : fonctions partagées également exposées sur window
  // (07 appelle window.applyPublicFleetFilters, 12 window.goToSuitesPage, etc.)
  (window as any).renderShowroomPagination = renderShowroomPagination;
  (window as any).applyPublicFleetFilters = applyPublicFleetFilters;
  (window as any).fallbackCopyTextToClipboard = fallbackCopyTextToClipboard;

  (window as any).changeFleetPage = function (delta: number) {
    const isAll = fleetPerPage === 'all';
    const numPerPage = isAll ? state.publicVehiclesList.length : fleetPerPage;
    const totalPages = isAll ? 1 : Math.ceil(state.publicVehiclesList.length / numPerPage);
    const targetPage = Math.min(Math.max(1, state.currentFleetPage + delta), totalPages);
    if (targetPage !== state.currentFleetPage) {
      state.currentFleetPage = targetPage;
      applyPublicFleetFilters();
      scrollToShowroomTop();
    }
  };

  (window as any).goToFleetPage = function (page: number) {
    state.currentFleetPage = Number(page);
    applyPublicFleetFilters();
    scrollToShowroomTop();
  };

  (window as any).setFleetPerPage = function (val: any) {
    fleetPerPage = val === 'all' ? 'all' : Number(val);
    state.currentFleetPage = 1;
    try {
      localStorage.setItem("richman_fleet_per_page", String(fleetPerPage));
    } catch (e) { console.warn('[Richman]', e); }
    applyPublicFleetFilters();
    scrollToShowroomTop();
  };

  (window as any).changeSuitesPage = function (delta: number) {
    const isAll = state.suitesPerPage === 'all';
    const numPerPage = isAll ? state.publicSuitesList.length : (state.suitesPerPage as number);
    const totalPages = isAll ? 1 : Math.ceil(state.publicSuitesList.length / numPerPage);
    const targetPage = Math.min(Math.max(1, state.currentSuitesPage + delta), totalPages);
    if (targetPage !== state.currentSuitesPage) {
      state.currentSuitesPage = targetPage;
      (window as any).applyPublicSuitesFilters();
      scrollToShowroomTop();
    }
  };

  (window as any).goToSuitesPage = function (page: number) {
    state.currentSuitesPage = Number(page);
    (window as any).applyPublicSuitesFilters();
    scrollToShowroomTop();
  };

  (window as any).setSuitesPerPage = function (val: any) {
    state.suitesPerPage = val === 'all' ? 'all' : Number(val);
    state.currentSuitesPage = 1;
    try {
      localStorage.setItem("richman_suites_per_page", String(state.suitesPerPage));
    } catch (e) { console.warn('[Richman]', e); }
    (window as any).applyPublicSuitesFilters();
    scrollToShowroomTop();
  };

  (window as any).shareVehicleLink = function (vehicleName: string, displayTitle: string) {
    if (!vehicleName) return;
    const cleanName = vehicleName.toLowerCase().trim();
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?select=${encodeURIComponent(cleanName)}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast(`✨ Lien copié ! Prêt à être partagé sur Discord : ${displayTitle || cleanName}`, 'success');
      }).catch(() => {
        fallbackCopyTextToClipboard(shareUrl, displayTitle);
      });
    } else {
      fallbackCopyTextToClipboard(shareUrl, displayTitle);
    }
  };

  (window as any).shareCurrentModalVehicle = function () {
    const vIdInput = document.getElementById("res-vehicle-id") as HTMLInputElement | null;
    const vNameInput = document.getElementById("res-vehicle-name") as HTMLInputElement | null;
    const vehicle = state.publicVehiclesList.find(v => v.id === vIdInput?.value);
    const rawName = vehicle ? vehicle.name : (vNameInput?.value || "");
    const cleanTitle = document.getElementById("res-car-title")?.textContent || rawName;
    (window as any).shareVehicleLink(rawName, cleanTitle);
  };
});
