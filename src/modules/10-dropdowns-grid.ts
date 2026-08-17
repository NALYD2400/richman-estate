/* ==========================================================================
   Richman Estate — 10-dropdowns-grid.ts
   Dropdowns custom & grille dynamique 2-5 colonnes
   ========================================================================== */

import { escapeHTML } from "../core/sanitize";
import { botFetch } from "../core/api";
import { supabaseClient } from "../core/supabase";
import { formatLuxuryCarName } from "../core/vehicles";
import { state } from "../core/state";
import { showToast } from "./02-admin-crud";
import { getVehicleRentalSchedule, getVehicleRatingSummary } from "./07-vehicles-showroom";
import { extractItemMediaArray } from "./08-media-carousel";
import { applyPublicFleetFilters } from "./09-showroom-pagination";

export function initRichmanGridSystem() {
  const isSuitesPage = !!document.getElementById("public-suites-grid");
  const validCols = isSuitesPage ? [2, 3, 4] : [2, 3, 4, 5];
  const targetGrids = [
    document.getElementById("public-fleet-grid"),
    document.getElementById("public-suites-grid")
  ].filter(Boolean);
  if (targetGrids.length === 0) return;
  let savedCols = 3;
  try {
    const key = isSuitesPage ? "richman_suites_grid_cols" : "richman_fleet_grid_cols";
    const stored = localStorage.getItem(key);
    if (stored) savedCols = parseInt(stored, 10);
  } catch (e) { console.warn('[Richman]', e); }
  if (!validCols.includes(savedCols)) savedCols = 3;
  (window as any).setRichmanGridCols(savedCols, false);
}

document.addEventListener("DOMContentLoaded", () => {
  const GRID_PREF_KEY = "richman_fleet_grid_cols";

  // ==========================================================================
  // Auto-init Luxury Custom Dropdowns
  // ==========================================================================
  function initLuxuryCustomSelects() {
    document.querySelectorAll(".showroom-select-wrap select").forEach(nativeSelectEl => {
      const nativeSelect = nativeSelectEl as HTMLSelectElement;
      if (nativeSelect.dataset.customized === "true") return;
      nativeSelect.dataset.customized = "true";

      const parentWrap = nativeSelect.parentElement;
      const isShowroom = parentWrap && parentWrap.classList.contains("showroom-select-wrap");
      const iconEl = parentWrap ? parentWrap.querySelector("i") : null;
      const iconClass = iconEl ? iconEl.className : "";

      nativeSelect.style.position = "absolute";
      nativeSelect.style.opacity = "0";
      nativeSelect.style.pointerEvents = "none";
      nativeSelect.style.width = "0";
      nativeSelect.style.height = "0";

      const container = document.createElement("div");
      container.className = "custom-select-container";
      if (isShowroom) container.classList.add("align-right");

      const trigger = document.createElement("div");
      trigger.className = "custom-select-trigger";
      trigger.setAttribute("tabindex", "0");

      const selectedOpt = nativeSelect.options[nativeSelect.selectedIndex] || nativeSelect.options[0];
      const selectedText = selectedOpt ? selectedOpt.textContent : "";

      trigger.innerHTML = `
        ${iconClass ? `<i class="${iconClass} trigger-icon"></i>` : ""}
        <span class="trigger-text">${selectedText}</span>
        <i class="fa-solid fa-chevron-down trigger-arrow"></i>
      `;

      const menu = document.createElement("div");
      menu.className = "custom-select-menu";

      function buildOptions() {
        menu.innerHTML = "";
        Array.from(nativeSelect.options).forEach((opt) => {
          const optDiv = document.createElement("div");
          optDiv.className = `custom-select-option ${opt.selected ? 'selected' : ''}`;
          optDiv.textContent = opt.textContent;
          optDiv.dataset.value = opt.value;

          optDiv.addEventListener("click", (e) => {
            e.stopPropagation();
            nativeSelect.value = opt.value;
            trigger.querySelector(".trigger-text")!.textContent = opt.textContent;
            menu.querySelectorAll(".custom-select-option").forEach(o => o.classList.remove("selected"));
            optDiv.classList.add("selected");
            container.classList.remove("open");

            nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
          });

          menu.appendChild(optDiv);
        });
      }

      buildOptions();

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = container.classList.contains("open");
        document.querySelectorAll(".custom-select-container.open").forEach(c => {
          if (c !== container) c.classList.remove("open");
        });
        if (!isOpen) {
          buildOptions();
          container.classList.add("open");
        } else {
          container.classList.remove("open");
        }
      });

      trigger.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          trigger.click();
        } else if (e.key === "Escape") {
          container.classList.remove("open");
        }
      });

      if (iconEl) {
        (iconEl as HTMLElement).style.display = "none";
      }

      container.appendChild(trigger);
      container.appendChild(menu);
      parentWrap!.appendChild(container);
    });
  }

  document.addEventListener("click", () => {
    document.querySelectorAll(".custom-select-container.open").forEach(c => c.classList.remove("open"));
  });

  // Initialize custom dropdowns on load
  initLuxuryCustomSelects();

  // ==========================================================================
  // SHOWROOM DYNAMIC GRID CONTROLLER (2, 3, 4, 5 COLUMNS - VEHICULES & SUITES)
  // ==========================================================================
  (window as any).setRichmanGridCols = function (cols: number, save = true) {
    const isSuites = !!document.getElementById("public-suites-grid");
    const validCols = isSuites ? [2, 3, 4] : [2, 3, 4, 5];
    const targetCols = validCols.includes(Number(cols)) ? Number(cols) : 3;

    if (save) {
      try {
        const key = isSuites ? "richman_suites_grid_cols" : "richman_fleet_grid_cols";
        localStorage.setItem(key, String(targetCols));
      } catch (e) { console.warn('[Richman]', e); }
    }

    // Apply to public fleet vehicle grid and suites grid
    const targetGrids = [
      document.getElementById("public-fleet-grid"),
      document.getElementById("public-suites-grid")
    ].filter(Boolean) as HTMLElement[];

    targetGrids.forEach(grid => {
      [2, 3, 4, 5].forEach(c => grid.classList.remove(`grid-cols-${c}`));
      grid.classList.add(`grid-cols-${targetCols}`);
    });

    // Update active class on switcher buttons
    const buttons = document.querySelectorAll(".grid-switcher-btn");
    buttons.forEach(btn => {
      const btnCols = Number((btn as HTMLElement).dataset.cols);
      btn.classList.toggle("active", btnCols === targetCols);
    });
  };

  // Initialize grid columns layout on load
  initRichmanGridSystem();
  (window as any).initRichmanGridSystem = initRichmanGridSystem;

  // Showroom Search and Filter Listeners
  const publicSearchInput = document.getElementById("public-fleet-search");
  const publicTypeSelect = document.getElementById("public-fleet-filter-type");
  const publicClassSelect = document.getElementById("public-fleet-filter-class");
  const publicStatusSelect = document.getElementById("public-fleet-filter-status");
  const publicSortSelect = document.getElementById("public-fleet-sort");

  function onFleetFilterChange() {
    state.currentFleetPage = 1;
    applyPublicFleetFilters();
  }

  if (publicSearchInput) publicSearchInput.addEventListener("input", onFleetFilterChange);
  if (publicTypeSelect) publicTypeSelect.addEventListener("change", onFleetFilterChange);
  if (publicClassSelect) publicClassSelect.addEventListener("change", onFleetFilterChange);
  if (publicStatusSelect) publicStatusSelect.addEventListener("change", onFleetFilterChange);
  if (publicSortSelect) publicSortSelect.addEventListener("change", onFleetFilterChange);

  // Modal Open / Close Logic
  (window as any).openVehicleReservationModal = function (vehicleId: string) {
    const overlay = document.getElementById("vehicle-reservation-modal-overlay");
    if (!overlay) return;
    initLuxuryCustomSelects();

    const vehicle = state.publicVehiclesList.find(v => v.id === vehicleId);

    if (vehicle) {
      const cleanCarName = formatLuxuryCarName(vehicle.name);
      const vIdInput = document.getElementById("res-vehicle-id") as HTMLInputElement | null;
      const vNameInput = document.getElementById("res-vehicle-name") as HTMLInputElement | null;
      const vPriceInput = document.getElementById("res-vehicle-price") as HTMLInputElement | null;

      if (vIdInput) vIdInput.value = vehicle.id;
      if (vNameInput) vNameInput.value = cleanCarName;
      if (vPriceInput) vPriceInput.value = vehicle.price || "";

      const titleEl = document.getElementById("res-car-title");
      const priceEl = document.getElementById("res-car-price-display");
      const imgEl = document.getElementById("res-car-img") as HTMLImageElement | null;
      const catBadge = document.getElementById("res-car-category-badge");
      const plateBadge = document.getElementById("res-car-plate-badge");

      let displayPlate = "LXS-RICH";
      let displayClass = "SUPER";
      let mediaUrl = "";

      try {
        if (vehicle.specs && vehicle.specs.startsWith("{")) {
          const meta = JSON.parse(vehicle.specs);
          displayPlate = meta.plate || "LXS-RICH";
          displayClass = meta.class || "SUPER";
          mediaUrl = meta.media_url || "";
        }
      } catch (e) { console.warn('[Richman]', e); }

      let photoSrc = "";
      if (mediaUrl) {
        if (mediaUrl.startsWith("[")) {
          try { photoSrc = JSON.parse(mediaUrl)[0] || ""; } catch (e) { console.warn('[Richman] JSON parse:', (e as Error).message); }
        } else { photoSrc = mediaUrl; }
      }
      if (!photoSrc) {
        photoSrc = `https://api.staff.gta.ctgaming.fr:2096/uploads/vehicle-screenshots/${encodeURIComponent(vehicle.name.toLowerCase().trim())}.webp`;
      }

      if (titleEl) titleEl.textContent = cleanCarName;
      if (priceEl) priceEl.textContent = vehicle.price || "Sur devis";
      if (imgEl) {
        imgEl.src = photoSrc;
        imgEl.onerror = function (this: HTMLImageElement) {
          this.onerror = null;
          this.src = 'assets/logo.webp';
        };
      }
      if (catBadge) catBadge.textContent = displayClass;
      if (plateBadge) plateBadge.textContent = displayPlate;

      // Handle Rental Schedule & Availability
      const schedule = getVehicleRentalSchedule(vehicle, (window as any).activeFleetBookings);
      const startDateInput = document.getElementById("res-start-date") as HTMLInputElement | null;
      let noticeEl = document.getElementById("res-rental-schedule-notice");

      if (!schedule.isAvailable) {
        if (startDateInput) {
          startDateInput.min = schedule.returnDateISO;
          startDateInput.value = schedule.returnDateISO;
        }
        if (!noticeEl) {
          noticeEl = document.createElement("div");
          noticeEl.id = "res-rental-schedule-notice";
          noticeEl.style.cssText = "margin-top: 14px; padding: 10px 14px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px; color: #fca5a5; font-size: 12.5px; display: flex; align-items: center; gap: 8px;";
          const formEl = document.getElementById("vehicle-reservation-form");
          if (formEl) formEl.insertBefore(noticeEl, formEl.children[1]);
        }
        noticeEl.innerHTML = `<i class="fa-solid fa-clock"></i> <span>Ce véhicule est actuellement en location jusqu'au <strong>${schedule.returnDateFormatted}</strong>. Votre réservation débutera dès sa libération.</span>`;
        noticeEl.style.display = "flex";
      } else {
        const today = new Date().toISOString().split('T')[0];
        if (startDateInput) {
          startDateInput.min = today;
          startDateInput.value = today;
        }
        if (noticeEl) {
          noticeEl.style.display = "none";
        }
      }
    } else if (state.publicVehiclesList.length > 0) {
      (window as any).openVehicleReservationModal(state.publicVehiclesList[0].id);
      return;
    }

    updateReservationEstimatedCost();

    overlay.classList.add("active");
    overlay.removeAttribute("aria-hidden");
    checkReservationEligibility();
  };

  (window as any).closeVehicleReservationModal = function () {
    const overlay = document.getElementById("vehicle-reservation-modal-overlay");
    if (overlay) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  };

  const btnCloseResModal = document.getElementById("vehicle-reservation-close-btn");
  const resModalOverlay = document.getElementById("vehicle-reservation-modal-overlay");
  const btnQuickReserve = document.getElementById("btn-quick-reserve");

  if (btnCloseResModal) btnCloseResModal.addEventListener("click", () => (window as any).closeVehicleReservationModal());
  if (resModalOverlay) {
    resModalOverlay.addEventListener("click", (e) => {
      if (e.target === resModalOverlay) (window as any).closeVehicleReservationModal();
    });
  }
  if (btnQuickReserve) {
    btnQuickReserve.addEventListener("click", () => {
      if (state.publicVehiclesList.length > 0) {
        (window as any).openVehicleReservationModal(state.publicVehiclesList[0].id);
      } else {
        (window as any).openVehicleReservationModal();
      }
    });
  }

  // ==========================================================================
  // Vehicle Detail Modal — fiche vitrine (ouverte par les liens partagés ?select=)
  // ==========================================================================
  let detailModalCurrentVehicle: any = null;

  (window as any).openVehicleDetailModal = function (vehicleId: string) {
    const overlay = document.getElementById("vehicle-detail-modal-overlay");
    if (!overlay) return;

    const vehicle = state.publicVehiclesList.find(v => v.id === vehicleId);
    if (!vehicle) return;
    detailModalCurrentVehicle = vehicle;

    const cleanTitle = formatLuxuryCarName(vehicle.name);
    let displayPlate = "LXS-RICH";
    let displayClass = "SUPER";
    let displaySpecs = "";

    try {
      if (vehicle.specs && vehicle.specs.startsWith("{")) {
        const meta = JSON.parse(vehicle.specs);
        displayPlate = meta.plate || "LXS-RICH";
        displayClass = meta.class || "SUPER";
        displaySpecs = meta.specs_text || "";
      } else if (vehicle.specs) {
        displaySpecs = vehicle.specs;
      }
    } catch (e) { console.warn('[Richman]', e); }

    if (!displaySpecs || displaySpecs.toLowerCase().startsWith("gamme")) {
      displaySpecs = "Motorisation préparée haute performance, finitions carbone et intérieur cuir sur mesure.";
    }

    const photos = extractItemMediaArray(vehicle, 'vehicule');
    const photoSrc = photos[0] || `https://api.staff.gta.ctgaming.fr:2096/uploads/vehicle-screenshots/${encodeURIComponent(vehicle.name.toLowerCase().trim())}.webp`;

    const schedule = getVehicleRentalSchedule(vehicle, (window as any).activeFleetBookings);
    const isAvailable = schedule.isAvailable;
    const ratingSummary = getVehicleRatingSummary(vehicle.id);

    const imgEl = document.getElementById("vehicle-detail-img") as HTMLImageElement | null;
    if (imgEl) {
      imgEl.src = photoSrc;
      imgEl.alt = cleanTitle;
      imgEl.onerror = function (this: HTMLImageElement) {
        this.onerror = null;
        this.src = 'assets/logo.webp';
      };
    }

    const statusBadge = document.getElementById("vehicle-detail-status-badge");
    if (statusBadge) {
      statusBadge.className = `public-badge-status ${isAvailable ? 'confirmed' : 'rented'}`;
      statusBadge.innerHTML = `<i class="fa-solid ${isAvailable ? 'fa-circle-check' : 'fa-clock'}"></i> <span>${isAvailable ? 'Disponible' : escapeHTML(schedule.statusBadgeText)}</span>`;
    }

    const setText = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText("vehicle-detail-class-badge", displayClass);
    setText("vehicle-detail-plate-badge", displayPlate);
    setText("vehicle-detail-title", cleanTitle);
    setText("vehicle-detail-rating-val", ratingSummary.avg.toFixed(1));
    setText("vehicle-detail-rating-count", `(${ratingSummary.count})`);
    setText("vehicle-detail-specs", displaySpecs);

    const photosChip = document.getElementById("vehicle-detail-photos-chip");
    if (photosChip) {
      if (photos.length > 1) {
        photosChip.style.display = "";
        setText("vehicle-detail-photos-val", `${photos.length} photos`);
      } else {
        photosChip.style.display = "none";
      }
    }

    const priceEl = document.getElementById("vehicle-detail-price");
    if (priceEl) {
      const priceRaw = vehicle.price || 'Sur devis';
      priceEl.innerHTML = /\//.test(priceRaw)
        ? escapeHTML(priceRaw)
        : `${escapeHTML(priceRaw)} <span style="font-size: 11px; font-weight: 500; color: #a1a1aa;">/ 24h</span>`;
    }

    const reserveBtn = document.getElementById("vehicle-detail-reserve-btn");
    if (reserveBtn) {
      reserveBtn.className = `btn-card-reserve ${isAvailable ? '' : 'rented'}`;
      reserveBtn.innerHTML = `<i class="fa-solid ${isAvailable ? 'fa-key' : 'fa-calendar-days'}"></i> <span>${isAvailable ? 'Réserver' : escapeHTML(schedule.reserveBtnText)}</span>`;
    }

    overlay.classList.add("active");
    overlay.removeAttribute("aria-hidden");
  };

  (window as any).closeVehicleDetailModal = function () {
    const overlay = document.getElementById("vehicle-detail-modal-overlay");
    if (overlay) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  };

  const btnCloseDetailModal = document.getElementById("vehicle-detail-close-btn");
  const detailModalOverlay = document.getElementById("vehicle-detail-modal-overlay");

  if (btnCloseDetailModal) btnCloseDetailModal.addEventListener("click", () => (window as any).closeVehicleDetailModal());
  if (detailModalOverlay) {
    detailModalOverlay.addEventListener("click", (e) => {
      if (e.target === detailModalOverlay) (window as any).closeVehicleDetailModal();
    });
  }

  const openDetailLightbox = () => {
    if (!detailModalCurrentVehicle) return;
    (window as any).closeVehicleDetailModal();
    (window as any).openRichmanLightbox(detailModalCurrentVehicle.id, 'vehicule');
  };
  const detailMedia = document.getElementById("vehicle-detail-media");
  const detailExpandBtn = document.getElementById("vehicle-detail-expand-btn");
  if (detailMedia) detailMedia.addEventListener("click", openDetailLightbox);
  if (detailExpandBtn) detailExpandBtn.addEventListener("click", (e) => { e.stopPropagation(); openDetailLightbox(); });

  const detailRatingChip = document.getElementById("vehicle-detail-rating-chip");
  if (detailRatingChip) {
    detailRatingChip.addEventListener("click", () => {
      if (detailModalCurrentVehicle) (window as any).openVehicleReviewsModal(detailModalCurrentVehicle.id);
    });
  }

  const detailShareBtn = document.getElementById("vehicle-detail-share-btn");
  if (detailShareBtn) {
    detailShareBtn.addEventListener("click", () => {
      if (detailModalCurrentVehicle) {
        (window as any).shareVehicleLink(detailModalCurrentVehicle.name, formatLuxuryCarName(detailModalCurrentVehicle.name));
      }
    });
  }

  const detailReserveBtn = document.getElementById("vehicle-detail-reserve-btn");
  if (detailReserveBtn) {
    detailReserveBtn.addEventListener("click", () => {
      if (!detailModalCurrentVehicle) return;
      (window as any).closeVehicleDetailModal();
      (window as any).openVehicleReservationModal(detailModalCurrentVehicle.id);
    });
  }

  // Cost Estimation Calculator
  function updateReservationEstimatedCost() {
    const priceStr = (document.getElementById("res-vehicle-price") as HTMLInputElement | null)?.value || "";
    const duration = parseInt((document.getElementById("res-duration-select") as HTMLSelectElement | null)?.value || "1", 10);

    const basePriceNum = parseInt(priceStr.replace(/[^0-9]/g, ''), 10) || 1200;
    const total = basePriceNum * duration;

    const formulaEl = document.getElementById("res-cost-formula");
    const totalEl = document.getElementById("res-cost-total");

    if (formulaEl) {
      formulaEl.textContent = `${duration} jour(s) × ${new Intl.NumberFormat('fr-FR').format(basePriceNum)} €`;
    }
    if (totalEl) {
      totalEl.textContent = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(total);
    }
  }

  const resDurationSelect = document.getElementById("res-duration-select");
  if (resDurationSelect) resDurationSelect.addEventListener("change", updateReservationEstimatedCost);

  // Eligibility Verification for Vehicle Reservation (Roles Membre & Citoyen)
  async function checkReservationEligibility() {
    const authGate = document.getElementById("res-auth-gate");
    const form = document.getElementById("vehicle-reservation-form");
    const submitBtn = document.getElementById("btn-submit-reservation");

    const rawUser = localStorage.getItem("richman_user");
    const activeUser = rawUser ? JSON.parse(rawUser) : null;

    if (!activeUser || !activeUser.name) {
      if (authGate) {
        authGate.style.display = "block";
        authGate.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; padding: 14px; border-radius: 12px; text-align: center;">
            <i class="fa-solid fa-lock" style="font-size: 22px; color: #ef4444; margin-bottom: 6px; display: block;"></i>
            <strong style="font-size: 14px; color: #fff;">Connexion Discord Requise</strong>
            <p style="margin: 6px 0 12px 0; font-size: 12.5px; color: #d4d4d8;">Vous devez être connecté avec votre compte Discord pour réserver un véhicule prestige.</p>
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

    const nameInput = document.getElementById("res-client-name") as HTMLInputElement | null;
    if (nameInput && !nameInput.value) nameInput.value = activeUser.name;

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
            <p style="margin: 6px 0 10px 0; font-size: 12.5px; color: #d4d4d8;">Vous devez avoir validé le règlement (rôle <strong>Membre</strong>) et complété votre enregistrement (rôle <strong>Citoyen</strong>) sur notre Discord pour louer un véhicule.</p>
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

  // Reservation Form Submission
  const vehicleResForm = document.getElementById("vehicle-reservation-form");
  if (vehicleResForm) {
    vehicleResForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("btn-submit-reservation");
      const origHtml = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transmission en cours...';
        (submitBtn as HTMLButtonElement).disabled = true;
      }

      const vehicleId = (document.getElementById("res-vehicle-id") as HTMLInputElement | null)?.value;
      const vehicleName = (document.getElementById("res-vehicle-name") as HTMLInputElement | null)?.value || "Supercar";
      const clientName = (document.getElementById("res-client-name") as HTMLInputElement | null)?.value || "Citoyen";
      const phone = (document.getElementById("res-client-phone") as HTMLInputElement | null)?.value || "";
      const startDate = (document.getElementById("res-start-date") as HTMLInputElement | null)?.value || "";
      const duration = (document.getElementById("res-duration-select") as HTMLSelectElement | null)?.value || "1";
      const totalAmount = document.getElementById("res-cost-total")?.textContent?.trim() || "Sur devis";
      const notes = (document.getElementById("res-notes") as HTMLTextAreaElement | null)?.value || "";

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
          item_name: vehicleName,
          type: "vehicule",
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
              content: `Demande de réservation pour ${vehicleName} (${duration} jour(s), début : ${startDate || 'Immédiat'}).${notes ? ` Demande : ${notes}` : ''}`
            }]);
          } catch (msgErr) {
            console.warn("Initial booking message insert warning:", msgErr);
          }
        }

        try {
          await supabaseClient.from("logs").insert([{
            action: `Demande Réservation Véhicule [${vehicleName}] par ${clientName} (${phone}) - ${duration} jour(s)`,
            user_name: clientName,
            type: "success"
          }]);
        } catch (logErr) {
          console.warn("Log insert warning:", logErr);
        }

        const photoUrl = (document.getElementById("res-car-img") as HTMLImageElement | null)?.src || "";

        // 2. Call Discord Bot API to create Ticket and trigger DM bridge
        botFetch('/api/create-vehicle-reservation-ticket', {
          method: 'POST',
          body: JSON.stringify({
            booking_id: bookingId,
            vehicle_id: vehicleId,
            item_name: vehicleName,
            client_name: clientName,
            phone: phone,
            dates: startDate,
            duration: duration,
            amount: totalAmount,
            notes: notes,
            discord_id: userDiscordId,
            discordId: userDiscordId,
            photo_url: photoUrl
          })
        }).catch(err => console.warn("Discord ticket API error:", err));

        showToast(`🎉 Demande envoyée ! Un ticket privé et un message MP ont été créés sur Discord.`, "success");
        (vehicleResForm as HTMLFormElement).reset();
        (window as any).closeVehicleReservationModal();
      } catch (err) {
        console.error(err);
        showToast("Erreur lors de la réservation : " + (err as Error).message, "danger");
      } finally {
        if (submitBtn) {
          submitBtn.innerHTML = origHtml;
          (submitBtn as HTMLButtonElement).disabled = false;
        }
      }
    });
  }
});
