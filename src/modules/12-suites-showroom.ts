/* ==========================================================================
   Richman Estate — 12-suites-showroom.ts
   Suites & résidences : chargement, filtres, calculateur séjour
   ========================================================================== */

import { escapeHTML, safeJsArg } from "../core/sanitize";
import { botFetch } from "../core/api";
import { supabaseClient } from "../core/supabase";
import { state } from "../core/state";
import { showToast } from "./02-admin-crud";
import { extractItemMediaArray } from "./08-media-carousel";
import { renderShowroomPagination, fallbackCopyTextToClipboard } from "./09-showroom-pagination";

export async function loadPublicSuites() {
  const grid = document.getElementById("public-suites-grid");
  if (!grid) return;

  // Colonnes explicites : access_code est réservée au staff (grant SQL par colonne)
  const { data, error } = await supabaseClient
    .from("suites")
    .select("id,name,price,specs,status,created_at,room_number,category,floor,media_urls")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading public suites:", error.message);
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: #fca5a5; padding: 40px 0;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 24px; margin-bottom: 8px;"></i>
        <p>Impossible de charger les résidences pour le moment.</p>
      </div>
    `;
    return;
  }

  state.publicSuitesList = data || [];

  // Dynamically Sync Stats Footer Counters with EXACT available suites count
  const confirmedCount = state.publicSuitesList.filter(s => s.status === 'confirmed').length;
  const exactAvailable = confirmedCount > 0 ? confirmedCount : state.publicSuitesList.length;
  const statSuitesCountEl = document.getElementById("stat-suites-count");
  if (statSuitesCountEl && (window as any).animateCustomCounter) {
    (window as any).animateCustomCounter(statSuitesCountEl, exactAvailable, 1000, 0);
  }

  applyPublicSuitesFilters();

  // Check URL query param ?select=<name_or_id>
  const urlParams = new URLSearchParams(window.location.search);
  const selectParam = urlParams.get('select') || urlParams.get('id');
  if (selectParam) {
    const cleanParam = selectParam.toLowerCase().trim();
    const foundSuite = state.publicSuitesList.find(s =>
      s.id === selectParam ||
      s.name.toLowerCase().trim() === cleanParam ||
      s.name.toLowerCase().includes(cleanParam)
    );
    if (foundSuite) {
      setTimeout(() => {
        (window as any).openSuiteDetailModal(foundSuite.id);
        const showroomEl = document.getElementById("showroom-section");
        if (showroomEl) {
          showroomEl.scrollIntoView({ behavior: "smooth" });
        }
      }, 500);
      // Retire le paramètre de l'URL sans recharger la page : évite que chaque
      // re-chargement (realtime, filtres) ne rouvre la fiche en boucle.
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch (e) { console.warn('[Richman]', e); }
    }
  }
}

export function applyPublicSuitesFilters() {
  const grid = document.getElementById("public-suites-grid");
  if (!grid) return;

  const searchVal = ((document.getElementById("public-suites-search") as HTMLInputElement | null)?.value || "").toLowerCase().trim();
  const categoryFilter = (document.getElementById("public-suites-filter-category") as HTMLSelectElement | null)?.value || "all";
  const statusFilter = (document.getElementById("public-suites-filter-status") as HTMLSelectElement | null)?.value || "all";
  const sortBy = (document.getElementById("public-suites-sort") as HTMLSelectElement | null)?.value || "recent";

  let list: any[] = [...state.publicSuitesList];

  // 1. Search Query
  if (searchVal) {
    list = list.filter(s => {
      return (s.name && s.name.toLowerCase().includes(searchVal)) ||
             (s.specs && s.specs.toLowerCase().includes(searchVal)) ||
             (s.floor && s.floor.toLowerCase().includes(searchVal)) ||
             (s.room_number && s.room_number.toLowerCase().includes(searchVal)) ||
             (s.category && s.category.toLowerCase().includes(searchVal));
    });
  }

  // 2. Category Filter
  if (categoryFilter !== 'all') {
    list = list.filter(s => (s.category || 'suite').toLowerCase() === categoryFilter.toLowerCase());
  }

  // 3. Status Filter
  if (statusFilter !== 'all') {
    list = list.filter(s => s.status === statusFilter);
  }

  // 4. Sorting
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
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  grid.innerHTML = "";

  const statSuitesCountEl = document.getElementById("stat-suites-count");
  if (statSuitesCountEl && (window as any).animateCustomCounter) {
    (window as any).animateCustomCounter(statSuitesCountEl, list.length, 600, 0);
  }

  const suitesPaginationWrap = document.getElementById("suites-pagination-wrap");

  if (list.length === 0) {
    if (suitesPaginationWrap) suitesPaginationWrap.style.display = "none";
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: #8e8e8e; padding: 60px 0;">
        <i class="fa-solid fa-hotel" style="font-size: 32px; color: #71717a; margin-bottom: 12px; display: block;"></i>
        <p style="font-size: 15px; font-weight: 500; color: #d4d4d8;">Aucun hébergement ne correspond à vos critères de recherche.</p>
      </div>
    `;
    return;
  }

  // Pagination Slicing for Suites
  const totalCount = list.length;
  const isAll = state.suitesPerPage === 'all';
  const numPerPage = isAll ? totalCount : (state.suitesPerPage as number);
  const totalPages = isAll ? 1 : Math.ceil(totalCount / numPerPage) || 1;

  if (state.currentSuitesPage > totalPages) state.currentSuitesPage = totalPages;
  if (state.currentSuitesPage < 1) state.currentSuitesPage = 1;

  const startIndex = isAll ? 0 : (state.currentSuitesPage - 1) * numPerPage;
  const pagedList = isAll ? list : list.slice(startIndex, startIndex + numPerPage);

  const catLabels: Record<string, { label: string; classText: string }> = {
    suite: { label: '🏨 Suite de Luxe', classText: 'SUITE' },
    appartement: { label: '🏢 Appartement', classText: 'APPARTEMENT' },
    chambre: { label: '🛏️ Chambre', classText: 'CHAMBRE' },
    penthouse: { label: '🌆 Penthouse', classText: 'PENTHOUSE' },
    villa: { label: '🏡 Villa Privée', classText: 'VILLA' },
    loft: { label: '🛖 Loft Prestige', classText: 'LOFT' }
  };

  pagedList.forEach(item => {
    const isAvailable = item.status === 'confirmed';
    const catInfo = catLabels[item.category] || catLabels.suite;

    const photos = extractItemMediaArray(item, 'suite');
    const hasMultiplePhotos = photos.length > 1;
    const initialIndex = state.cardActiveSlideMap.get(item.id) || 0;

    const roomBadge = item.room_number ? `<span class="public-card-plate" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #fff;">🚪 ${escapeHTML(item.room_number)}</span>` : '';
    const floorInfo = item.floor ? `<span class="meta-chip"><i class="fa-solid fa-layer-group" style="color: #c5a880;"></i> ${escapeHTML(item.floor)}</span>` : '';

    const card = document.createElement("div");
    card.className = "public-vehicle-card public-suite-card";
    card.innerHTML = `
      <div>
        <div class="public-card-media" onclick="window.openRichmanLightbox('${escapeHTML(item.id)}', 'suite')">
          <span class="public-badge-status ${isAvailable ? 'confirmed' : 'rented'}">
            <i class="fa-solid ${isAvailable ? 'fa-circle-check' : 'fa-clock'}"></i>
            <span>${isAvailable ? 'Disponible' : 'Occupé'}</span>
          </span>
          <span class="public-badge-category">
            ${escapeHTML(catInfo.classText)}
          </span>

          <button type="button" class="btn-card-fullscreen" title="Voir en Plein Écran" onclick="event.stopPropagation(); window.openRichmanLightbox('${escapeHTML(item.id)}', 'suite')">
            <i class="fa-solid fa-expand"></i>
          </button>

          <div class="card-media-slider" id="carousel-${escapeHTML(item.id)}">
            ${photos.map((src: string, i: number) => `
              <img src="${escapeHTML(src)}" alt="${escapeHTML(item.name)}" class="card-slide-img ${i === initialIndex ? 'active' : ''}" loading="lazy" onerror="this.onerror=null; this.src='assets/logo.webp';" />
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
              <h3 class="public-card-title" title="Voir la fiche détaillée" onclick="window.openSuiteDetailModal('${escapeHTML(item.id)}')">${escapeHTML(item.name)}</h3>
              ${roomBadge}
            </div>

            <div class="public-card-meta-chips">
              <span class="meta-chip"><i class="fa-solid fa-hotel" style="color: #c5a880;"></i> ${escapeHTML(catInfo.label)}</span>
              ${floorInfo}
              <span class="meta-chip"><i class="fa-solid fa-shield-halved"></i> Conciergerie 24/7</span>
            </div>

            <p class="public-card-specs">${escapeHTML(item.specs || "Hébergement de prestige tout confort avec service hôtelier VIP.")}</p>
          </div>

          <div class="public-card-bottom">
            <div class="public-card-price-wrap">
              <span class="public-card-price-label">Tarif Séjour</span>
              <span class="public-card-price-val">${escapeHTML(item.price || 'Sur devis')}</span>
            </div>

            <div class="public-card-actions">
              <button type="button" class="btn-card-share-action" onclick="window.shareSuiteLink(decodeURIComponent('${safeJsArg(item.id || '')}'), decodeURIComponent('${safeJsArg(item.name || '')}'))" title="Partager cette résidence">
                <i class="fa-solid fa-share-nodes"></i>
              </button>
                <button type="button" class="btn-card-reserve ${isAvailable ? '' : 'rented'}" onclick="window.openSuiteReservationModal('${escapeHTML(item.id)}')">
                  <i class="fa-solid ${isAvailable ? 'fa-key' : 'fa-calendar-days'}"></i>
                  <span>${isAvailable ? 'Réserver' : 'Disponibilité'}</span>
                </button>
            </div>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  renderShowroomPagination("suites", state.currentSuitesPage, totalCount, state.suitesPerPage as any, (window as any).goToSuitesPage);
}

document.addEventListener("DOMContentLoaded", () => {
  // Suite Share Functions
  (window as any).shareSuiteLink = function (suiteId: string, suiteName: string) {
    const suite = state.publicSuitesList.find(s =>
      (suiteId && String(s.id) === String(suiteId)) ||
      (suiteName && s.name.toLowerCase().trim() === String(suiteName).toLowerCase().trim())
    );
    const identifier = suite ? (suite.name || suite.id) : (suiteName || suiteId || 'suite');
    const cleanParam = encodeURIComponent(identifier.trim());
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?select=${cleanParam}`;
    const displayName = suite ? suite.name : (suiteName || 'Résidence');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast(`✨ Lien copié ! Prêt à être partagé : ${displayName}`, 'success');
      }).catch(() => {
        fallbackCopyTextToClipboard(shareUrl, displayName);
      });
    } else {
      fallbackCopyTextToClipboard(shareUrl, displayName);
    }
  };

  (window as any).shareCurrentModalSuite = function () {
    const sIdInput = document.getElementById("res-suite-id");
    const sNameInput = document.getElementById("res-suite-name");
    const suite = state.publicSuitesList.find(s => String(s.id) === String((sIdInput as HTMLInputElement)?.value));
    const rawName = suite ? suite.name : ((sNameInput as HTMLInputElement)?.value || "");
    (window as any).shareSuiteLink((sIdInput as HTMLInputElement)?.value || rawName, rawName);
  };

  // ==========================================================================
  // Suite Detail Modal — fiche vitrine (ouverte par les liens partagés ?select=)
  // ==========================================================================
  let detailModalCurrentSuite: any = null;

  (window as any).openSuiteDetailModal = function (suiteId: string) {
    const overlay = document.getElementById("suite-detail-modal-overlay");
    if (!overlay) return;

    let suite: any = null;
    if (suiteId) {
      const cleanId = String(suiteId).toLowerCase().trim();
      suite = state.publicSuitesList.find(s =>
        String(s.id).toLowerCase().trim() === cleanId ||
        s.name.toLowerCase().trim() === cleanId ||
        (s.room_number && String(s.room_number).toLowerCase().trim() === cleanId)
      );
    }
    if (!suite) return;
    detailModalCurrentSuite = suite;

    const isAvailable = suite.status === 'confirmed';
    const photos = extractItemMediaArray(suite, 'suite');
    const photoSrc = photos[0] || 'https://ghbeopdnfdxuqfjzmmeb.supabase.co/storage/v1/object/public/public_assets/logo.webp';

    const catLabels: Record<string, string> = {
      suite: '🏨 Suite de Luxe',
      appartement: '🏢 Appartement',
      chambre: '🛏️ Chambre',
      penthouse: '🌆 Penthouse',
      villa: '🏡 Villa Privée',
      loft: '🛖 Loft Prestige'
    };

    const imgEl = document.getElementById("suite-detail-img") as HTMLImageElement | null;
    if (imgEl) {
      imgEl.src = photoSrc;
      imgEl.alt = suite.name || 'Hébergement';
      imgEl.onerror = function (this: HTMLImageElement) {
        this.onerror = null;
        this.src = 'assets/logo.webp';
      };
    }

    const statusBadge = document.getElementById("suite-detail-status-badge");
    if (statusBadge) {
      statusBadge.className = `public-badge-status ${isAvailable ? 'confirmed' : 'rented'}`;
      statusBadge.innerHTML = `<i class="fa-solid ${isAvailable ? 'fa-circle-check' : 'fa-clock'}"></i> <span>${isAvailable ? 'Disponible' : 'Occupé'}</span>`;
    }

    const setText = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText("suite-detail-category-badge", (suite.category || 'SUITE').toUpperCase());
    setText("suite-detail-room-badge", suite.room_number || (suite.floor || 'VIP'));
    setText("suite-detail-title", suite.name || 'Résidence');
    setText("suite-detail-cat-chip", catLabels[(suite.category || '').toLowerCase()] || catLabels.suite);
    setText("suite-detail-specs", suite.specs || "Hébergement de prestige tout confort avec service hôtelier VIP.");

    const floorChip = document.getElementById("suite-detail-floor-chip");
    if (floorChip) {
      if (suite.floor) {
        floorChip.style.display = "";
        setText("suite-detail-floor-val", suite.floor);
      } else {
        floorChip.style.display = "none";
      }
    }

    const photosChip = document.getElementById("suite-detail-photos-chip");
    if (photosChip) {
      if (photos.length > 1) {
        photosChip.style.display = "";
        setText("suite-detail-photos-val", `${photos.length} photos`);
      } else {
        photosChip.style.display = "none";
      }
    }

    const priceEl = document.getElementById("suite-detail-price");
    if (priceEl) {
      const priceRaw = suite.price || 'Sur devis';
      priceEl.innerHTML = /\//.test(priceRaw)
        ? escapeHTML(priceRaw)
        : `${escapeHTML(priceRaw)} <span style="font-size: 11px; font-weight: 500; color: #a1a1aa;">/ nuit</span>`;
    }

    const reserveBtn = document.getElementById("suite-detail-reserve-btn");
    if (reserveBtn) {
      reserveBtn.className = `btn-card-reserve ${isAvailable ? '' : 'rented'}`;
      reserveBtn.innerHTML = `<i class="fa-solid ${isAvailable ? 'fa-key' : 'fa-calendar-days'}"></i> <span>${isAvailable ? 'Réserver la Suite' : 'Demander Disponibilité'}</span>`;
    }

    overlay.classList.add("active");
    overlay.removeAttribute("aria-hidden");
  };

  (window as any).closeSuiteDetailModal = function () {
    const overlay = document.getElementById("suite-detail-modal-overlay");
    if (overlay) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  };

  const btnCloseSuiteDetailModal = document.getElementById("suite-detail-close-btn");
  const suiteDetailOverlay = document.getElementById("suite-detail-modal-overlay");

  if (btnCloseSuiteDetailModal) btnCloseSuiteDetailModal.addEventListener("click", () => (window as any).closeSuiteDetailModal());
  if (suiteDetailOverlay) {
    suiteDetailOverlay.addEventListener("click", (e) => {
      if (e.target === suiteDetailOverlay) (window as any).closeSuiteDetailModal();
    });
  }

  const openSuiteDetailLightbox = () => {
    if (!detailModalCurrentSuite) return;
    (window as any).closeSuiteDetailModal();
    (window as any).openRichmanLightbox(detailModalCurrentSuite.id, 'suite');
  };
  const suiteDetailMedia = document.getElementById("suite-detail-media");
  const suiteDetailExpandBtn = document.getElementById("suite-detail-expand-btn");
  if (suiteDetailMedia) suiteDetailMedia.addEventListener("click", openSuiteDetailLightbox);
  if (suiteDetailExpandBtn) suiteDetailExpandBtn.addEventListener("click", (e) => { e.stopPropagation(); openSuiteDetailLightbox(); });

  const suiteDetailShareBtn = document.getElementById("suite-detail-share-btn");
  if (suiteDetailShareBtn) {
    suiteDetailShareBtn.addEventListener("click", () => {
      if (detailModalCurrentSuite) {
        (window as any).shareSuiteLink(detailModalCurrentSuite.id, detailModalCurrentSuite.name);
      }
    });
  }

  const suiteDetailReserveBtn = document.getElementById("suite-detail-reserve-btn");
  if (suiteDetailReserveBtn) {
    suiteDetailReserveBtn.addEventListener("click", () => {
      if (!detailModalCurrentSuite) return;
      (window as any).closeSuiteDetailModal();
      (window as any).openSuiteReservationModal(detailModalCurrentSuite.id);
    });
  }

  // Filter Listeners for Suites
  const suiteSearch = document.getElementById("public-suites-search");
  const suiteCatFilter = document.getElementById("public-suites-filter-category");
  const suiteStatusFilter = document.getElementById("public-suites-filter-status");
  const suiteSort = document.getElementById("public-suites-sort");

  function onSuitesFilterChange() {
    state.currentSuitesPage = 1;
    applyPublicSuitesFilters();
  }

  if (suiteSearch) suiteSearch.addEventListener("input", onSuitesFilterChange);
  if (suiteCatFilter) suiteCatFilter.addEventListener("change", onSuitesFilterChange);
  if (suiteStatusFilter) suiteStatusFilter.addEventListener("change", onSuitesFilterChange);
  if (suiteSort) suiteSort.addEventListener("change", onSuitesFilterChange);

  // Suite Reservation Modal Handlers
  (window as any).openSuiteReservationModal = function (suiteId: string) {
    const overlay = document.getElementById("suite-reservation-modal-overlay");
    if (!overlay) return;

    let suite: any = null;
    if (suiteId) {
      const cleanId = String(suiteId).toLowerCase().trim();
      suite = state.publicSuitesList.find(s =>
        String(s.id).toLowerCase().trim() === cleanId ||
        s.name.toLowerCase().trim() === cleanId ||
        (s.room_number && String(s.room_number).toLowerCase().trim() === cleanId)
      );
    }
    if (!suite && state.publicSuitesList.length > 0) {
      suite = state.publicSuitesList[0];
    }

    if (suite) {
      const sIdInput = document.getElementById("res-suite-id");
      const sNameInput = document.getElementById("res-suite-name");
      const sPriceInput = document.getElementById("res-suite-price");

      if (sIdInput) (sIdInput as HTMLInputElement).value = suite.id;
      if (sNameInput) (sNameInput as HTMLInputElement).value = suite.name;
      if (sPriceInput) (sPriceInput as HTMLInputElement).value = suite.price || "";

      const titleEl = document.getElementById("res-suite-title");
      const priceEl = document.getElementById("res-suite-price-display");
      const imgEl = document.getElementById("res-suite-img");
      const catBadge = document.getElementById("res-suite-category-badge");
      const roomBadge = document.getElementById("res-suite-room-badge");

      let photoSrc = 'https://ghbeopdnfdxuqfjzmmeb.supabase.co/storage/v1/object/public/public_assets/logo.webp';
      if (suite.media_urls) {
        if (suite.media_urls.startsWith("[")) {
          try {
            const arr = JSON.parse(suite.media_urls);
            photoSrc = arr[0] || photoSrc;
          } catch (e) { console.warn('[Richman]', e); }
        } else {
          photoSrc = suite.media_urls;
        }
      }

      if (titleEl) titleEl.textContent = suite.name;
      if (priceEl) priceEl.textContent = suite.price || "Sur devis";
      if (imgEl) {
        imgEl.setAttribute('src', photoSrc);
        (imgEl as HTMLImageElement).onerror = function (this: HTMLImageElement) {
          this.onerror = null;
          this.src = 'assets/logo.webp';
        };
      }
      if (catBadge) catBadge.textContent = (suite.category || 'SUITE').toUpperCase();
      if (roomBadge) roomBadge.textContent = suite.room_number || (suite.floor || 'VIP');

      const startDateInput = document.getElementById("res-suite-start-date");
      const today = new Date().toISOString().split('T')[0];
      if (startDateInput) {
        (startDateInput as HTMLInputElement).min = today;
        (startDateInput as HTMLInputElement).value = today;
      }
    }

    updateSuiteReservationEstimatedCost();

    overlay.classList.add("active");
    overlay.removeAttribute("aria-hidden");
    checkSuiteReservationEligibility();
  };

  (window as any).closeSuiteReservationModal = function () {
    const overlay = document.getElementById("suite-reservation-modal-overlay");
    if (overlay) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  };

  const btnCloseSuiteResModal = document.getElementById("suite-reservation-close-btn");
  const suiteResModalOverlay = document.getElementById("suite-reservation-modal-overlay");
  const btnQuickReserveSuite = document.getElementById("btn-quick-reserve-suite");

  if (btnCloseSuiteResModal) btnCloseSuiteResModal.addEventListener("click", () => (window as any).closeSuiteReservationModal());
  if (suiteResModalOverlay) {
    suiteResModalOverlay.addEventListener("click", (e) => {
      if (e.target === suiteResModalOverlay) (window as any).closeSuiteReservationModal();
    });
  }
  if (btnQuickReserveSuite) {
    btnQuickReserveSuite.addEventListener("click", () => {
      if (state.publicSuitesList.length > 0) {
        (window as any).openSuiteReservationModal(state.publicSuitesList[0].id);
      } else {
        (window as any).openSuiteReservationModal();
      }
    });
  }

  function updateSuiteReservationEstimatedCost() {
    const priceStr = (document.getElementById("res-suite-price") as HTMLInputElement)?.value || "";
    const duration = parseInt((document.getElementById("res-suite-duration-select") as HTMLSelectElement)?.value || "1", 10);

    const basePriceNum = parseInt(priceStr.replace(/[^0-9]/g, ''), 10) || 5000;
    const total = basePriceNum * duration;

    const formulaEl = document.getElementById("res-suite-cost-formula");
    const totalEl = document.getElementById("res-suite-cost-total");

    if (formulaEl) {
      formulaEl.textContent = `${duration} nuit(s) × ${new Intl.NumberFormat('fr-FR').format(basePriceNum)} €`;
    }
    if (totalEl) {
      totalEl.textContent = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(total);
    }
  }

  const resSuiteDurationSelect = document.getElementById("res-suite-duration-select");
  if (resSuiteDurationSelect) resSuiteDurationSelect.addEventListener("change", updateSuiteReservationEstimatedCost);

  async function checkSuiteReservationEligibility() {
    const authGate = document.getElementById("suite-res-auth-gate");
    const form = document.getElementById("suite-reservation-form");
    const submitBtn = document.getElementById("btn-submit-suite-reservation");

    const rawUser = localStorage.getItem("richman_user");
    const activeUser = rawUser ? JSON.parse(rawUser) : null;

    if (!activeUser || !activeUser.name) {
      if (authGate) {
        authGate.style.display = "block";
        authGate.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; padding: 14px; border-radius: 12px; text-align: center;">
            <i class="fa-solid fa-lock" style="font-size: 22px; color: #ef4444; margin-bottom: 6px; display: block;"></i>
            <strong style="font-size: 14px; color: #fff;">Connexion Discord Requise</strong>
            <p style="margin: 6px 0 12px 0; font-size: 12.5px; color: #d4d4d8;">Vous devez être connecté avec votre compte Discord pour réserver une suite ou une résidence.</p>
            <a href="login.html" class="admin-btn-primary" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; padding: 9px 18px; font-size: 13px; border-radius: 10px; background: #5865F2; color: #fff; border: none; font-weight: 600;"><i class="fa-brands fa-discord"></i> Se Connecter avec Discord</a>
          </div>
        `;
      }
      if (form) form.querySelectorAll("input, select, textarea").forEach(el => ((el as HTMLInputElement).disabled = true));
      if (submitBtn) {
        (submitBtn as HTMLButtonElement).disabled = true;
        submitBtn.style.opacity = "0.5";
        submitBtn.style.cursor = "not-allowed";
      }
      return false;
    }

    const nameInput = document.getElementById("res-suite-client-name");
    if (nameInput && !(nameInput as HTMLInputElement).value) (nameInput as HTMLInputElement).value = activeUser.name;

    const isOwner = localStorage.getItem("richman_is_owner") === "true";
    let canReserve = isOwner;

    if (!isOwner && activeUser.discord_id) {
      try {
        const res = await botFetch(`/api/check-user-roles?discordId=${activeUser.discord_id}`);
        if (res.ok) {
          const roleData = await res.json();
          canReserve = Boolean(roleData.hasCitoyenRole && roleData.hasMembreRole);
        }
      } catch (e) {
        canReserve = true;
      }
    } else if (!isOwner && !activeUser.discord_id) {
      canReserve = true;
    }

    if (!canReserve) {
      if (authGate) {
        authGate.style.display = "block";
        authGate.innerHTML = `
          <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); color: #fde68a; padding: 14px; border-radius: 12px; text-align: center;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 22px; color: #f59e0b; margin-bottom: 6px; display: block;"></i>
            <strong style="font-size: 14px; color: #fff;">Rôles Discord Requis</strong>
            <p style="margin: 6px 0 10px 0; font-size: 12.5px; color: #d4d4d8;">Vous devez avoir validé le règlement (rôle <strong>Membre</strong>) et complété votre enregistrement (rôle <strong>Citoyen</strong>) sur notre Discord pour réserver un séjour.</p>
            <a href="https://discord.gg/Zv8fBjptt6" target="_blank" rel="noopener noreferrer" style="color: #fff; text-decoration: underline; font-weight: 600; font-size: 12.5px;">Accéder au Discord Officiel</a>
          </div>
        `;
      }
      if (form) form.querySelectorAll("input, select, textarea").forEach(el => ((el as HTMLInputElement).disabled = true));
      if (submitBtn) {
        (submitBtn as HTMLButtonElement).disabled = true;
        submitBtn.style.opacity = "0.5";
        submitBtn.style.cursor = "not-allowed";
      }
      return false;
    }

    // Access Granted
    if (authGate) {
      authGate.style.display = "block";
      authGate.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); color: #86efac; padding: 8px 12px; border-radius: 10px; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <i class="fa-solid fa-circle-check" style="color: #10b981;"></i>
          <span>Profil vérifié : <strong>${escapeHTML(activeUser.name)}</strong> (Rôles Membre &amp; Citoyen validés)</span>
        </div>
      `;
    }
    if (form) form.querySelectorAll("input, select, textarea").forEach(el => ((el as HTMLInputElement).disabled = false));
    if (submitBtn) {
      (submitBtn as HTMLButtonElement).disabled = false;
      submitBtn.style.opacity = "1";
      submitBtn.style.cursor = "pointer";
    }
    return true;
  }

  // Suite Reservation Form Submission
  const suiteResForm = document.getElementById("suite-reservation-form");
  if (suiteResForm) {
    suiteResForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("btn-submit-suite-reservation");
      const origHtml = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transmission en cours...';
        (submitBtn as HTMLButtonElement).disabled = true;
      }

      const suiteId = (document.getElementById("res-suite-id") as HTMLInputElement)?.value;
      const suiteName = (document.getElementById("res-suite-name") as HTMLInputElement)?.value || "Suite Prestige";
      const clientName = (document.getElementById("res-suite-client-name") as HTMLInputElement)?.value || "Citoyen";
      const phone = (document.getElementById("res-suite-client-phone") as HTMLInputElement)?.value || "";
      const startDate = (document.getElementById("res-suite-start-date") as HTMLInputElement)?.value || "";
      const duration = (document.getElementById("res-suite-duration-select") as HTMLSelectElement)?.value || "1";
      const totalAmount = document.getElementById("res-suite-cost-total")?.textContent?.trim() || "Sur devis";
      const notes = (document.getElementById("res-suite-notes") as HTMLTextAreaElement)?.value || "";

      const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");
      let userDiscordId = activeUser.discord_id || null;

      if (!userDiscordId) {
        try {
          const { data: { session } } = await supabaseClient.auth.getSession();
          if (session && session.user) {
            userDiscordId = session.user.user_metadata?.provider_id || session.user.user_metadata?.sub || (session.user.identities && session.user.identities[0]?.id) || session.user.id || null;
            if (userDiscordId) {
              activeUser.discord_id = userDiscordId;
              localStorage.setItem("richman_user", JSON.stringify(activeUser));
            }
          }
        } catch (e) { console.warn('[Richman]', e); }
      }

      try {
        let bookingId = null;

        // 1. Insert into Supabase bookings table
        const { data: newBooking, error: bError } = await supabaseClient.from("bookings").insert([{
          client_name: clientName,
          item_name: suiteName,
          type: "suite",
          amount: totalAmount,
          status: "pending",
          dates: startDate,
          duration: duration,
          phone: phone,
          notes: notes,
          discord_id: userDiscordId
        }]).select();

        if (bError) throw bError;
        if (newBooking && newBooking.length > 0) {
          bookingId = newBooking[0].id;
        }

        // Insert initial booking message in booking_messages
        if (bookingId) {
          try {
            await supabaseClient.from("booking_messages").insert([{
              booking_id: bookingId,
              sender_name: clientName,
              sender_id: activeUser.discord_id || null,
              sender_role: "client",
              content: `Demande de réservation pour ${suiteName} (${duration} nuit(s), arrivée : ${startDate || 'Immédiat'}).${notes ? ` Demande : ${notes}` : ''}`
            }]);
          } catch (msgErr) {
            console.warn("Initial suite booking message insert warning:", msgErr);
          }
        }

        try {
          await supabaseClient.from("logs").insert([{
            action: `Demande Réservation Suite [${suiteName}] par ${clientName} (${phone}) - ${duration} nuit(s)`,
            user_name: clientName,
            type: "success"
          }]);
        } catch (logErr) { /* journal optionnel */ }

        // 2. Trigger Bot API to create ticket in Discord
        let selectedSuite = state.publicSuitesList.find(s => s.id === suiteId);
        let suitePhotoUrl = 'https://ghbeopdnfdxuqfjzmmeb.supabase.co/storage/v1/object/public/public_assets/logo.webp';
        if (selectedSuite && selectedSuite.media_urls) {
          if (selectedSuite.media_urls.startsWith("[")) {
            try { suitePhotoUrl = JSON.parse(selectedSuite.media_urls)[0] || suitePhotoUrl; } catch (e) { console.warn('[Richman] JSON parse:', (e as Error).message); }
          } else { suitePhotoUrl = selectedSuite.media_urls; }
        }

        try {
          await botFetch('/api/create-vehicle-reservation-ticket', {
            method: 'POST',
            body: JSON.stringify({
              booking_id: bookingId,
              suite_id: suiteId,
              item_name: suiteName,
              type: 'suite',
              client_name: clientName,
              phone: phone,
              dates: startDate,
              duration: duration,
              amount: totalAmount,
              notes: notes,
              discord_id: userDiscordId,
              discordId: userDiscordId,
              photo_url: suitePhotoUrl
            })
          });
        } catch (botErr) {
          console.warn("Bot notification warning:", botErr);
        }

        showToast(`🎉 Demande de séjour pour "${suiteName}" transmise avec succès !`, 'success');
        (window as any).closeSuiteReservationModal();
        (suiteResForm as HTMLFormElement).reset();

        setTimeout(() => {
          window.location.href = "client.html";
        }, 1200);

      } catch (err) {
        console.error("Erreur réservation suite :", err);
        showToast(`Erreur : ${(err as Error).message || 'Impossible d\'enregistrer la réservation'}`, 'danger');
      } finally {
        if (submitBtn) {
          submitBtn.innerHTML = origHtml;
          (submitBtn as HTMLButtonElement).disabled = false;
        }
      }
    });
  }

  // Load public suites if on suites page
  if (document.getElementById("public-suites-grid") || window.location.pathname.includes("suites")) {
    setTimeout(() => loadPublicSuites(), 300);
  }

  // Admin Quick DM Modal for Bookings
  (window as any).openBookingDMModal = function (discordId: string, clientName: string, itemName: string) {
    const msg = prompt(`Envoyer un Message Privé Discord à ${clientName} concernant ${itemName} :`);
    if (msg && msg.trim()) {
      botFetch('/api/send-user-dm', {
        method: 'POST',
        body: JSON.stringify({
          discordId,
          title: `🛎️ Message Conciergerie • Dossier ${itemName}`,
          message: msg.trim(),
          type: 'info'
        })
      })
      .then(res => res.json())
      .then(res => {
        if (res.success) {
          showToast(`✉️ Message privé envoyé à ${clientName} sur Discord !`, 'success');
        } else {
          showToast(`Erreur : ${res.error || 'Impossible d\'envoyer le MP'}`, 'danger');
        }
      })
      .catch(err => showToast(`Erreur envoi MP : ${(err as Error).message}`, 'danger'));
    }
  };
});
