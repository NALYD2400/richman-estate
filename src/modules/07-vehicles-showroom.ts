/* ==========================================================================
   Richman Estate — 07-vehicles-showroom.ts
   Flotte : réservation, favoris, avis & notes, chargement showroom
   Porté de main.js (07-vehicles-showroom.js) — ES module + TypeScript.
   ========================================================================== */

import { escapeHTML } from "../core/sanitize";
import { state } from "../core/state";
import { supabaseClient } from "../core/supabase";
import { formatLuxuryCarName } from "../core/vehicles";
import { showToast } from "./02-admin-crud";

// ==========================================================================
// Flotte Prestige — Public Showroom & Vehicle Reservation Flow
// ==========================================================================

export function getVehicleRentalSchedule(vehicle: any, activeBookings: any) {
  if (!vehicle) {
    return { isAvailable: true, statusBadgeText: 'Disponible', reserveBtnText: 'Réserver', returnDateFormatted: '', returnDateISO: '', daysRemaining: 0 };
  }

  let activeBooking = null;
  if (activeBookings && Array.isArray(activeBookings)) {
    activeBooking = activeBookings.find((b: any) => {
      if ((b.status === 'confirmed' || b.status === 'rented') && (b.type === 'vehicule' || !b.type)) {
        const bName = (b.item_name || '').toUpperCase().trim();
        const vName = (vehicle.name || '').toUpperCase().trim();
        return bName === vName || bName.includes(vName) || vName.includes(bName);
      }
      return false;
    });
  }

  const isRented = vehicle.status === 'rented';
  if (!isRented) {
    return {
      isAvailable: true,
      statusBadgeText: 'Disponible',
      reserveBtnText: 'Réserver',
      returnDateFormatted: '',
      returnDateISO: '',
      daysRemaining: 0
    };
  }

  let start = new Date();
  let duration = 1;
  if (activeBooking) {
    duration = parseInt(activeBooking.duration) || 1;
    if (activeBooking.dates && !isNaN(Date.parse(activeBooking.dates))) {
      start = new Date(activeBooking.dates);
    } else if (activeBooking.created_at) {
      start = new Date(activeBooking.created_at);
    }
  }

  const returnDate = new Date(start.getTime() + duration * 24 * 60 * 60 * 1000);
  const now = new Date();

  const day = String(returnDate.getDate()).padStart(2, '0');
  const month = String(returnDate.getMonth() + 1).padStart(2, '0');
  const returnFormatted = `${day}/${month}`;

  const isoYear = returnDate.getFullYear();
  const isoMonth = String(returnDate.getMonth() + 1).padStart(2, '0');
  const isoDay = String(returnDate.getDate()).padStart(2, '0');
  const returnDateISO = `${isoYear}-${isoMonth}-${isoDay}`;

  const diffMs = returnDate.getTime() - now.getTime();
  const daysRemaining = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  return {
    isAvailable: false,
    statusBadgeText: `En Location • Dispo le ${returnFormatted}`,
    reserveBtnText: `Dès le ${returnFormatted}`,
    returnDateFormatted: returnFormatted,
    returnDateISO: returnDateISO,
    daysRemaining: daysRemaining,
    duration: duration
  };
}

// ==========================================================================
// VEHICLE FAVORITES SYSTEM (Client Persistence)
// ==========================================================================

function getVehicleFavorites(): any {
  try {
    return JSON.parse(localStorage.getItem("richman_vehicle_favorites") || "[]");
  } catch (e) {
    return [];
  }
}

function saveVehicleFavorites(favs: any) {
  localStorage.setItem("richman_vehicle_favorites", JSON.stringify(favs));
  updateFavoritesCountBadge();
}

export function isVehicleFavorite(id: any, name: any) {
  const favs = getVehicleFavorites();
  if (!Array.isArray(favs) || favs.length === 0) return false;
  const cleanId = String(id || "").toLowerCase().trim();
  const cleanName = String(name || "").toLowerCase().trim();
  return favs.some((f: any) => {
    const s = String(f).toLowerCase().trim();
    return s === cleanId || (cleanName && s === cleanName);
  });
}

function updateFavoritesCountBadge() {
  const badge = document.getElementById("fav-count-badge");
  if (badge) {
    const favs = getVehicleFavorites();
    badge.textContent = favs.length;
    badge.style.display = favs.length > 0 ? "inline-block" : "none";
  }
}

// ==========================================================================
// VEHICLE REVIEWS & RATINGS SYSTEM (Supabase + Fallback)
// ==========================================================================
let vehicleReviewsCache: any = {};

async function loadAllVehicleReviews() {
  let supabaseSuccess = false;
  try {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from("vehicle_reviews")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && data) {
        supabaseSuccess = true;
        vehicleReviewsCache = {};
        data.forEach(r => {
          if (!vehicleReviewsCache[r.vehicle_id]) vehicleReviewsCache[r.vehicle_id] = [];
          vehicleReviewsCache[r.vehicle_id].push(r);
        });
        // Purge local storage fallback when Supabase is actively synced
        try { localStorage.removeItem("richman_local_reviews"); } catch (e) {}
      }
    }
  } catch (e) {
    console.warn("Reviews load notice:", e);
  }
  // Fallback to local storage ONLY if Supabase is offline / failed
  if (!supabaseSuccess) {
    try {
      const localReviews = JSON.parse(localStorage.getItem("richman_local_reviews") || "[]");
      vehicleReviewsCache = {};
      localReviews.forEach((r: any) => {
        if (!vehicleReviewsCache[r.vehicle_id]) vehicleReviewsCache[r.vehicle_id] = [];
        if (!vehicleReviewsCache[r.vehicle_id].some((existing: any) => existing.id === r.id)) {
          vehicleReviewsCache[r.vehicle_id].push(r);
        }
      });
    } catch (e) { console.warn('[Richman]', e); }
  }

  updateGlobalSatisfactionStat();
}

function getVehicleReviews(vehicleId: any) {
  return vehicleReviewsCache[vehicleId] || [];
}

export function getVehicleRatingSummary(vehicleId: any) {
  const reviews = getVehicleReviews(vehicleId);
  if (reviews.length === 0) {
    return { avg: 5.0, count: 0, isDefault: true };
  }
  const sum = reviews.reduce((acc: number, r: any) => acc + Number(r.rating || 5), 0);
  const avg = sum / reviews.length;
  return { avg: Math.round(avg * 10) / 10, count: reviews.length, isDefault: false };
}

function updateGlobalSatisfactionStat() {
  const ratingStatEl = document.getElementById("stat-fleet-rating");
  if (!ratingStatEl) return;
  let allRatings: any[] = [];
  Object.values(vehicleReviewsCache).forEach((arr: any) => {
    arr.forEach((r: any) => allRatings.push(Number(r.rating || 5)));
  });
  let globalAvg = 4.9;
  if (allRatings.length > 0) {
    const sum = allRatings.reduce((a, b) => a + b, 0);
    globalAvg = Math.round((sum / allRatings.length) * 10) / 10;
  }
  ratingStatEl.setAttribute("data-target", globalAvg.toFixed(1));
  ratingStatEl.textContent = globalAvg.toFixed(1);
}

// ==========================================================================
// PUBLIC FLEET SHOWROOM LOADER & FILTERS
// ==========================================================================
export async function loadPublicVehicles() {
  const grid = document.getElementById("public-fleet-grid");
  if (!grid) return;

  if (!supabaseClient) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: #8e8e8e; padding: 40px 0;">
        <p>Initialisation de la base de données...</p>
      </div>
    `;
    return;
  }

  const { data, error } = await supabaseClient
    .from("vehicules")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading public vehicles:", error.message);
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: #fca5a5; padding: 40px 0;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 24px; margin-bottom: 8px;"></i>
        <p>Impossible de charger la flotte pour le moment.</p>
      </div>
    `;
    return;
  }

  state.publicVehiclesList = data || [];

  try {
    const { data: bData } = await supabaseClient
      .from("bookings")
      .select("*")
      .in("status", ["confirmed", "rented"]);
    (window as any).activeFleetBookings = bData || [];
  } catch (e) {
    (window as any).activeFleetBookings = [];
  }

  // Dynamically Sync Stats Footer Counters with EXACT available fleet count
  const confirmedCount = state.publicVehiclesList.filter((v: any) => v.status === 'confirmed').length;
  const exactAvailable = confirmedCount > 0 ? confirmedCount : state.publicVehiclesList.length;
  const statFleetCountEl = document.getElementById("stat-fleet-count");
  if (statFleetCountEl) {
    (window as any).animateCustomCounter(statFleetCountEl, exactAvailable, 1000, 0);
  }

  await loadAllVehicleReviews();
  updateFavoritesCountBadge();
  (window as any).applyPublicFleetFilters();

  // Check URL query param ?select=<name_or_id>
  const urlParams = new URLSearchParams(window.location.search);
  const selectParam = urlParams.get('select') || urlParams.get('id');
  if (selectParam) {
    const cleanParam = selectParam.toLowerCase().trim();
    const foundCar = state.publicVehiclesList.find((v: any) =>
      v.id === selectParam ||
      v.name.toLowerCase().trim() === cleanParam ||
      v.name.toLowerCase().includes(cleanParam)
    );
    if (foundCar) {
      setTimeout(() => {
        (window as any).openVehicleDetailModal(foundCar.id);
        const showroomEl = document.getElementById("showroom-section");
        if (showroomEl) {
          showroomEl.scrollIntoView({ behavior: "smooth" });
        }
      }, 500);
      // Retire le paramètre de l'URL sans recharger la page : évite que chaque
      // événement realtime Supabase (re-chargement de la flotte) ne rouvre la fiche.
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch (e) { console.warn('[Richman]', e); }
    }
  }
}

export function getVehicleType(v: any) {
  let vClass = "SUPER";
  let vType = "";
  try {
    if (v.specs && v.specs.startsWith("{")) {
      const m = JSON.parse(v.specs);
      vClass = (m.class || "SUPER").toUpperCase();
      vType = (m.type || "").toLowerCase();
    }
  } catch (e) { console.warn('[Richman]', e); }

  if (vType) return vType;
  if (vClass.includes("MOTO") || vClass.includes("CYCLE") || vClass.includes("BIKE")) return "moto";
  if (vClass.includes("BOAT") || vClass.includes("BATEAU")) return "bateau";
  if (vClass.includes("HELI")) return "helico";
  if (vClass.includes("PLANE") || vClass.includes("AVION")) return "avion";
  return "voiture";
}

document.addEventListener("DOMContentLoaded", () => {
  let activeCategoryFilter = "all";

  (window as any).toggleVehicleFavorite = function (event: any, vehicleId: any, vehicleName: any) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    let favs = getVehicleFavorites();
    const cleanId = String(vehicleId || "").trim();
    const cleanName = String(vehicleName || "").toLowerCase().trim();

    const index = favs.findIndex((f: any) => {
      const s = String(f).toLowerCase().trim();
      return s === cleanId.toLowerCase() || (cleanName && s === cleanName);
    });

    if (index > -1) {
      favs.splice(index, 1);
      showToast("💔 Véhicule retiré de vos favoris", "info");
    } else {
      favs.push(cleanId);
      showToast("❤️ Véhicule ajouté à vos favoris !", "success");
    }
    saveVehicleFavorites(favs);
    (window as any).applyPublicFleetFilters();
  };

  (window as any).toggleFavoritesFilter = function (e: any) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    state.onlyFavoritesFilter = !state.onlyFavoritesFilter;
    state.currentFleetPage = 1;
    const btn = document.getElementById("btn-filter-favorites");
    if (btn) {
      if (state.onlyFavoritesFilter) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
    (window as any).applyPublicFleetFilters();
  };

  (window as any).openVehicleReviewsModal = function (vehicleId: any) {
    const vehicle = state.publicVehiclesList.find((v: any) => v.id === vehicleId);
    if (!vehicle) return;
    const modal = document.getElementById("vehicle-reviews-modal-overlay");
    if (!modal) return;

    const cleanTitle = formatLuxuryCarName(vehicle.name);
    const titleEl = document.getElementById("reviews-modal-vehicle-title");
    if (titleEl) titleEl.textContent = `Avis • ${cleanTitle}`;

    (document.getElementById("review-vehicle-id") as HTMLInputElement).value = vehicle.id;
    (document.getElementById("review-vehicle-name") as HTMLInputElement).value = cleanTitle;

    // Prefill name from active user
    const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");
    const nameInput = document.getElementById("review-client-name") as HTMLInputElement | null;
    if (nameInput && !nameInput.value) {
      nameInput.value = activeUser.name || "";
    }

    renderReviewsModalContent(vehicle.id);

    modal.classList.add("active");
    modal.removeAttribute("aria-hidden");
  };

  (window as any).closeVehicleReviewsModal = function () {
    const modal = document.getElementById("vehicle-reviews-modal-overlay");
    if (modal) {
      modal.classList.remove("active");
      modal.setAttribute("aria-hidden", "true");
    }
  };

  function renderReviewsModalContent(vehicleId: any) {
    const summary = getVehicleRatingSummary(vehicleId);
    const reviews = getVehicleReviews(vehicleId);

    const avgEl = document.getElementById("reviews-avg-rating");
    const countEl = document.getElementById("reviews-total-count");
    const starsEl = document.getElementById("reviews-stars-display");
    const listEl = document.getElementById("reviews-list-box");

    if (avgEl) avgEl.textContent = summary.avg.toFixed(1);
    if (countEl) countEl.textContent = summary.count;

    if (starsEl) {
      let starsHtml = "";
      const rounded = Math.round(summary.avg);
      for (let i = 1; i <= 5; i++) {
        if (i <= rounded) {
          starsHtml += `<i class="fa-solid fa-star"></i>`;
        } else {
          starsHtml += `<i class="fa-regular fa-star" style="opacity: 0.35;"></i>`;
        }
      }
      starsEl.innerHTML = starsHtml;
    }

    if (listEl) {
      if (reviews.length === 0) {
        listEl.innerHTML = `
          <div style="text-align: center; padding: 24px; color: #71717a; font-size: 13px;">
            <i class="fa-solid fa-award" style="font-size: 24px; color: #c5a880; margin-bottom: 8px; display: block;"></i>
            Soyez le premier à donner votre avis sur ce bolide d'exception !
          </div>
        `;
      } else {
        listEl.innerHTML = reviews.map((r: any) => {
          const stars = Array.from({ length: 5 }, (_, idx) =>
            idx < r.rating ? '<i class="fa-solid fa-star" style="color: #fbbf24; font-size: 11px;"></i>' : '<i class="fa-regular fa-star" style="color: #52525b; font-size: 11px;"></i>'
          ).join(" ");
          const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "Récemment";
          return `
            <div class="review-item-card">
              <div class="review-item-header">
                <span class="review-item-author"><i class="fa-solid fa-circle-user" style="color: #c5a880;"></i> ${escapeHTML(r.client_name)}</span>
                <span class="review-item-date">${dateStr}</span>
              </div>
              <div style="display: flex; gap: 2px;">${stars}</div>
              <p class="review-item-comment">"${escapeHTML(r.comment || 'Expérience VIP remarquable.')}"</p>
            </div>
          `;
        }).join("");
      }
    }
  }

  // Bind Star Picker and Reviews Form
  const starPicker = document.getElementById("star-picker-widget");
  if (starPicker) {
    const stars = starPicker.querySelectorAll("i");
    stars.forEach(star => {
      star.addEventListener("mouseenter", () => {
        const val = parseInt(star.getAttribute("data-val"), 10);
        stars.forEach(s => {
          const sVal = parseInt(s.getAttribute("data-val"), 10);
          s.classList.toggle("hovered", sVal <= val);
        });
      });
      star.addEventListener("mouseleave", () => {
        stars.forEach(s => s.classList.remove("hovered"));
      });
      star.addEventListener("click", () => {
        const val = parseInt(star.getAttribute("data-val"), 10);
        (document.getElementById("review-rating-val") as HTMLInputElement).value = String(val);
        stars.forEach(s => {
          const sVal = parseInt(s.getAttribute("data-val"), 10);
          s.classList.toggle("active", sVal <= val);
        });
      });
    });
  }

  const reviewForm = document.getElementById("vehicle-review-form");
  if (reviewForm) {
    reviewForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("btn-submit-review");
      const origHtml = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Publication...';
        (submitBtn as HTMLButtonElement).disabled = true;
      }

      const vehicleId = (document.getElementById("review-vehicle-id") as HTMLInputElement).value;
      const vehicleName = (document.getElementById("review-vehicle-name") as HTMLInputElement).value;
      const rating = parseInt((document.getElementById("review-rating-val") as HTMLInputElement).value || "5", 10);
      const clientName = (document.getElementById("review-client-name") as HTMLInputElement).value || "Citoyen";
      const comment = (document.getElementById("review-comment") as HTMLTextAreaElement).value || "";
      const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");

      const newReview = {
        id: "rev_" + Date.now(),
        vehicle_id: vehicleId,
        vehicle_name: vehicleName,
        client_name: clientName,
        rating: rating,
        comment: comment,
        discord_id: activeUser.discord_id || null,
        created_at: new Date().toISOString()
      };

      let insertedReview = newReview;
      let usedSupabase = false;

      try {
        if (supabaseClient) {
          const { data, error } = await supabaseClient.from("vehicle_reviews").insert([{
            vehicle_id: vehicleId,
            vehicle_name: vehicleName,
            client_name: clientName,
            rating: rating,
            comment: comment,
            discord_id: activeUser.discord_id || null
          }]).select();

          if (!error && data && data.length > 0) {
            insertedReview = data[0];
            usedSupabase = true;
          } else if (error) {
            console.warn("Supabase review insert notice:", error.message);
          }
        }
      } catch (err) {
        console.warn(err);
      }

      // Update in-memory cache
      if (!vehicleReviewsCache[vehicleId]) vehicleReviewsCache[vehicleId] = [];
      vehicleReviewsCache[vehicleId].unshift(insertedReview);

      // Only save to localStorage fallback if Supabase is unavailable
      if (!usedSupabase) {
        try {
          const localReviews = JSON.parse(localStorage.getItem("richman_local_reviews") || "[]");
          localReviews.unshift(insertedReview);
          localStorage.setItem("richman_local_reviews", JSON.stringify(localReviews));
        } catch (e) { console.warn('[Richman]', e); }
      }

      showToast("⭐ Merci ! Votre avis a été publié avec succès.", "success");
      renderReviewsModalContent(vehicleId);
      updateGlobalSatisfactionStat();
      (window as any).applyPublicFleetFilters();
      (reviewForm as HTMLFormElement).reset();
      (document.getElementById("review-rating-val") as HTMLInputElement).value = "5";
      if (starPicker) {
        starPicker.querySelectorAll("i").forEach(s => s.classList.add("active"));
      }
      if (submitBtn) {
        submitBtn.innerHTML = origHtml;
        (submitBtn as HTMLButtonElement).disabled = false;
      }
    });
  }

  const btnCloseReviewsModal = document.getElementById("vehicle-reviews-close-btn");
  const reviewsModalOverlay = document.getElementById("vehicle-reviews-modal-overlay");
  if (btnCloseReviewsModal) btnCloseReviewsModal.addEventListener("click", (window as any).closeVehicleReviewsModal);
  if (reviewsModalOverlay) {
    reviewsModalOverlay.addEventListener("click", (e) => {
      if (e.target === reviewsModalOverlay) (window as any).closeVehicleReviewsModal();
    });
  }

  // ---- Compat HTML : handlers globaux (affectations window d'origine conservées) ----
  (window as any).formatLuxuryCarName = formatLuxuryCarName;
  (window as any).getVehicleRentalSchedule = getVehicleRentalSchedule;
  (window as any).isVehicleFavorite = isVehicleFavorite;
  (window as any).getVehicleRatingSummary = getVehicleRatingSummary;
  (window as any).getVehicleType = getVehicleType;
  (window as any).loadPublicVehicles = loadPublicVehicles;
});
