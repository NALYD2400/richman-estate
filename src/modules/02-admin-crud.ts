/* ==========================================================================
   Richman Estate — 02-admin-crud.ts
   Admin : onglets dashboard, modales CRUD flotte & suites, recherche live
   Porté de 02-admin-crud.js (découpage historique de main.js).

   Note de portage : les fonctions partagées (carte PORTING_RULES) sont
   remontées au niveau module pour être exportées ; les références DOM qu'elles
   utilisent sont des handles module assignés dans le DOMContentLoaded
   d'origine (comportement identique : mêmes nœuds, même timing).
   L'état partagé (allVehicles, allSuites, allBookingsList, uploaded*)
   passe par `state` (core/state). Les blocs Object.defineProperty(window, ...)
   « Exports inter-parties » sont supprimés conformément au contrat.
   ========================================================================== */

import { escapeHTML, safeJsArg, sanitizeUrl } from "../core/sanitize";
import { supabaseClient } from "../core/supabase";
import { botFetch } from "../core/api";
import { state } from "../core/state";
import { getCTGClassStyle, loadCTGDatabase } from "./05-ctg-database";
import { loadUsers } from "./03-admin-users";
import { updateKPIs } from "./04-confirm-modal";

// ---- Handles DOM module (assignés dans le DOMContentLoaded ci-dessous) ----
let modalOverlay: HTMLElement | null = null;
let adminModalForm: HTMLElement | null = null;
let suiteModalOverlay: HTMLElement | null = null;
let suiteModalForm: HTMLElement | null = null;
let suiteUploadPreviewContainer: HTMLElement | null = null;
let suiteUploadPreviewGrid: HTMLElement | null = null;
let suiteUploadFileCount: HTMLElement | null = null;
let userModalOverlay: HTMLElement | null = null;
let previewContainer: HTMLElement | null = null;
let previewGrid: HTMLElement | null = null;
let fileCountSpan: HTMLElement | null = null;
let mediaUrlInput: HTMLInputElement | null = null;

export function showToast(message: any, type: any = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 999999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;';
    document.body.appendChild(container);
  }

  const validTypes = ['success', 'danger', 'warning', 'info', 'error'];
  const safeType = validTypes.includes(type) ? type : 'info';
  const iconClass = safeType === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation';

  const toast = document.createElement('div');
  toast.className = `admin-toast ${safeType}`;
  toast.style.pointerEvents = 'auto';

  const iconEl = document.createElement('i');
  iconEl.className = `fa-solid ${iconClass}`;

  const spanEl = document.createElement('span');
  spanEl.textContent = String(message || '');

  toast.appendChild(iconEl);
  toast.appendChild(spanEl);

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function openModal() {
  if (modalOverlay) {
    modalOverlay.classList.add('active');
    modalOverlay.removeAttribute('aria-hidden');
  }
}

export function closeModal() {
  if (modalOverlay) {
    if (document.activeElement && modalOverlay.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    modalOverlay.classList.remove('active');
    modalOverlay.setAttribute('aria-hidden', 'true');
    if (adminModalForm) {
      (adminModalForm as HTMLFormElement).reset();

      // Reset visibility and custom inputs
      const priceAutoFields = document.getElementById("price-auto-fields");
      if (priceAutoFields) priceAutoFields.style.display = "none";
      const itemPriceInput = document.getElementById("item-price") as HTMLInputElement | null;
      if (itemPriceInput) {
        itemPriceInput.disabled = false;
        itemPriceInput.placeholder = "ex: 3,500 € / j";
      }

      // Reset image upload preview
      state.uploadedImagesArray = [];
      const fileInput = document.getElementById("item-image-file") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      const urlContainer = document.getElementById("upload-url-input-container");
      if (urlContainer) urlContainer.style.display = "none";
      const urlInput = document.getElementById("item-media-url-input") as HTMLInputElement | null;
      if (urlInput) urlInput.value = "";
      renderUploadPreviews();
      if (adminModalForm) delete adminModalForm.dataset.editId;
      const modalTitle = document.getElementById('modal-title');
      if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-car-side" style="color: #c5a880; margin-right: 8px;"></i> Nouveau Véhicule';
    }
  }
}

// Aperçu plein écran d'une image (miniatures d'upload cliquables dans l'admin)
export function openAdminImagePreview(src: string) {
  if (!src) return;
  let overlay = document.getElementById("admin-image-preview-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "admin-image-preview-overlay";
    overlay.style.cssText = "position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.92); display: none; align-items: center; justify-content: center; cursor: zoom-out;";
    const img = document.createElement("img");
    img.id = "admin-image-preview-img";
    img.alt = "Aperçu de l'image";
    img.style.cssText = "max-width: 92vw; max-height: 92vh; object-fit: contain; border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,0.6);";
    overlay.appendChild(img);
    overlay.addEventListener("click", () => closeAdminImagePreview());
    document.body.appendChild(overlay);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAdminImagePreview();
    });
  }
  const img = document.getElementById("admin-image-preview-img") as HTMLImageElement | null;
  if (img) img.src = src;
  overlay.style.display = "flex";
}

function closeAdminImagePreview() {
  const overlay = document.getElementById("admin-image-preview-overlay");
  if (overlay) overlay.style.display = "none";
}

function renderSuiteUploadPreviews() {
  if (!suiteUploadPreviewContainer || !suiteUploadPreviewGrid) return;
  suiteUploadPreviewGrid.innerHTML = "";
  if (state.uploadedSuiteImagesArray.length === 0) {
    suiteUploadPreviewContainer.style.display = "none";
    return;
  }
  suiteUploadPreviewContainer.style.display = "flex";
  if (suiteUploadFileCount) {
    suiteUploadFileCount.textContent = `${state.uploadedSuiteImagesArray.length} photo(s) prête(s)`;
  }
  state.uploadedSuiteImagesArray.forEach((src, index) => {
    const thumb = document.createElement("div");
    thumb.style.cssText = "position: relative; width: 60px; height: 60px; border-radius: 8px; overflow: hidden; background: #000;";
    const img = document.createElement("img");
    img.src = src;
    img.title = "Cliquez pour agrandir";
    img.style.cssText = "width: 100%; height: 100%; object-fit: cover; border: 1px solid rgba(255,255,255,0.15); cursor: zoom-in;";
    img.addEventListener("click", () => openAdminImagePreview(src));
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.innerHTML = "&times;";
    removeBtn.style.cssText = "position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; border-radius: 50%; background: #ef4444; color: #fff; border: none; font-size: 12px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.5);";
    removeBtn.onclick = () => {
      state.uploadedSuiteImagesArray.splice(index, 1);
      renderSuiteUploadPreviews();
    };
    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    suiteUploadPreviewGrid.appendChild(thumb);
  });
}

export function closeSuiteModal() {
  if (suiteModalOverlay) {
    if (document.activeElement && suiteModalOverlay.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    suiteModalOverlay.classList.remove('active');
    suiteModalOverlay.setAttribute('aria-hidden', 'true');
    if (suiteModalForm) {
      (suiteModalForm as HTMLFormElement).reset();
      delete suiteModalForm.dataset.editId;
    }
    state.uploadedSuiteImagesArray = [];
    renderSuiteUploadPreviews();
  }
}

export function closeUserModal(updateHash = true) {
  if (userModalOverlay) {
    if (document.activeElement && userModalOverlay.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    userModalOverlay.classList.remove('active');
    userModalOverlay.setAttribute('aria-hidden', 'true');
  }
  if (updateHash && window.location.hash.includes('user-detail')) {
    history.pushState(null, '', '#users');
  }
}

export function updateCalculatedPrice() {
  const dealerPrice = parseFloat((document.getElementById("item-dealer-price") as HTMLInputElement | null)?.value as any) || 0;
  const pct = parseFloat((document.getElementById("item-rental-percent") as HTMLInputElement | null)?.value as any) || 0.5;
  const priceInput = document.getElementById("item-price") as HTMLInputElement | null;
  const activeRadio = (document.querySelector("input[name='price-mode']:checked") as HTMLInputElement | null)?.value;

  if (priceInput && activeRadio === "auto") {
    const calc = Math.round(dealerPrice * pct / 100);
    const formatted = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(calc);
    priceInput.value = `${formatted} / j`;
  }
}

export function renderUploadPreviews() {
  if (!previewGrid || !previewContainer) return;
  previewGrid.innerHTML = "";

  if (state.uploadedImagesArray.length === 0) {
    previewContainer.style.display = "none";
    if (fileCountSpan) fileCountSpan.textContent = "0 photo";
    if (mediaUrlInput) mediaUrlInput.value = "";
    return;
  }

  previewContainer.style.display = "flex";
  if (fileCountSpan) {
    fileCountSpan.textContent = `${state.uploadedImagesArray.length} photo(s) prête(s)`;
  }
  if (mediaUrlInput) {
    mediaUrlInput.value = state.uploadedImagesArray.length === 1 ? state.uploadedImagesArray[0] : JSON.stringify(state.uploadedImagesArray);
  }

  state.uploadedImagesArray.forEach((src, index) => {
    const thumb = document.createElement("div");
    thumb.className = "admin-thumb-item";

    const img = document.createElement("img");
    img.className = "admin-thumb-img";
    img.src = src;
    img.title = "Cliquez pour agrandir";
    img.addEventListener("click", () => openAdminImagePreview(src));

    const badge = document.createElement("span");
    badge.className = "admin-thumb-badge";
    badge.textContent = `${index + 1}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "admin-thumb-remove";
    removeBtn.innerHTML = "&times;";
    removeBtn.title = "Supprimer cette photo";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.uploadedImagesArray.splice(index, 1);
      renderUploadPreviews();
    });

    thumb.appendChild(img);
    thumb.appendChild(badge);
    thumb.appendChild(removeBtn);
    previewGrid.appendChild(thumb);
  });
}

// Supabase Real-Time Data Loaders for Admin Panel
export async function writeLog(action: any, userName: any, type: any, details = null) {
  const allowed = ['success', 'warning', 'danger', 'info', 'primary'];
  const safeType = allowed.includes(type) ? type : 'success';
  if (supabaseClient) {
    try {
      await supabaseClient.from("logs").insert([{ action, user_name: userName || 'Système', type: safeType }]);
    } catch (e) {
      console.warn("Log write warning:", e);
    }
  }
  // Real-time synchronization to Discord #admin-logs channel
  try {
    botFetch('/api/send-admin-log', {
      method: 'POST',
      body: JSON.stringify({ action, user_name: userName, type: safeType, details })
    }).catch(() => {});
  } catch (e) { console.warn('[Richman]', e); }
}

export function applyFleetFilters() {
  const container = document.getElementById("fleet-admin-list");
  const countBadge = document.getElementById("fleet-count-badge");
  if (!container) return;

  const searchQuery = (document.getElementById("fleet-search-input") as HTMLInputElement | null)?.value.toLowerCase().trim() || "";
  const filterStatus = (document.getElementById("fleet-filter-status") as HTMLInputElement | null)?.value || "all";
  const sortBy = (document.getElementById("fleet-sort-by") as HTMLInputElement | null)?.value || "recent";

  let filtered = [...state.allVehicles];

  // 1. Apply Search Query
  if (searchQuery) {
    filtered = filtered.filter(item =>
      item.name.toLowerCase().includes(searchQuery) ||
      (item.specs && item.specs.toLowerCase().includes(searchQuery)) ||
      (item.price && item.price.toLowerCase().includes(searchQuery))
    );
  }

  // 2. Apply Status Filter
  if (filterStatus !== "all") {
    filtered = filtered.filter(item => item.status === filterStatus);
  }

  // 3. Apply Sorting
  if (sortBy === "recent") {
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (sortBy === "oldest") {
    filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  } else if (sortBy === "price-asc" || sortBy === "price-desc") {
    const getPriceNum = (pStr) => {
      const parsed = parseInt(pStr.replace(/[^0-9]/g, ''), 10);
      return isNaN(parsed) ? 0 : parsed;
    };
    filtered.sort((a, b) => {
      const priceA = getPriceNum(a.price);
      const priceB = getPriceNum(b.price);
      return sortBy === 'price-asc' ? priceA - priceB : priceB - priceA;
    });
  }

  // Update badge count
  if (countBadge) {
    countBadge.textContent = `${filtered.length} voiture${filtered.length !== 1 ? 's' : ''}`;
  }

  // Render cards
  container.innerHTML = "";
  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #8e8e8e; padding: 40px 0; font-family: var(--font-sans);">Aucun véhicule ne correspond aux critères.</div>`;
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement("div");
    card.className = "admin-card-item";

    const toggleButton = item.status === 'confirmed'
      ? `<button class="admin-btn-secondary" onclick="window.updateItemStatus('${item.id}', 'fleet', 'rented')"><i class="fa-solid fa-car-side"></i> Louer</button>`
      : `<button class="admin-btn-primary" onclick="window.updateItemStatus('${item.id}', 'fleet', 'confirmed')"><i class="fa-solid fa-check"></i> Libérer</button>`;

    // Parse specs JSON if applicable
    let displaySpecs = item.specs || "";
    let displayPlate = "LXS-RICH-RP";
    let displayClass = "SUPER";
    let mediaHtml = "";

    try {
      if (item.specs && item.specs.startsWith("{")) {
        const meta = JSON.parse(item.specs);
        displaySpecs = meta.specs_text || "";
        displayPlate = meta.plate || "LXS-RICH-RP";
        displayClass = meta.class || "SUPER";

        const mediaUrl = meta.media_url || "";
        if (mediaUrl) {
          if (mediaUrl.startsWith("[")) {
            try {
              const mediaArray = JSON.parse(mediaUrl);
              if (Array.isArray(mediaArray) && mediaArray.length > 0) {
                let slidesHtml = "";
                mediaArray.forEach((url) => {
                  const isVideo = url.includes(".mp4") || url.includes("youtube.com") || url.includes("youtu.be") || url.includes("vimeo.com");
                  if (isVideo) {
                    if (url.includes("youtube.com") || url.includes("youtu.be")) {
                      let videoId = "";
                      if (url.includes("youtu.be/")) {
                        videoId = url.split("youtu.be/")[1]?.split("?")[0];
                      } else {
                        videoId = url.split("v/")[1] || url.split("vi/")[1] || url.split("v=")[1]?.split("&")[0];
                      }
                      const safeVideoId = encodeURIComponent(videoId || '');
                      slidesHtml += `
                        <div class="vehicle-slide" style="flex: 0 0 100%; width: 100%; height: 100%; scroll-snap-align: start;">
                          <iframe src="https://www.youtube.com/embed/${safeVideoId}?autoplay=1&mute=1&loop=1&playlist=${safeVideoId}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="width: 100%; height: 100%; border: none;"></iframe>
                        </div>`;
                    } else {
                      const safeMediaSrc = escapeHTML(sanitizeUrl(url, 'assets/logo.webp'));
                      slidesHtml += `
                        <div class="vehicle-slide" style="flex: 0 0 100%; width: 100%; height: 100%; scroll-snap-align: start;">
                          <video src="${safeMediaSrc}" controls muted autoplay loop style="width: 100%; height: 100%; object-fit: cover;"></video>
                        </div>`;
                    }
                  } else {
                    const safeImgSrc = escapeHTML(sanitizeUrl(url, 'assets/logo.webp'));
                    slidesHtml += `
                      <img class="vehicle-slide" src="${safeImgSrc}" alt="${escapeHTML(item.name)}" onerror="this.src='assets/logo.webp';" style="flex: 0 0 100%; width: 100%; height: 100%; scroll-snap-align: start; object-fit: cover;" />`;
                  }
                });

                mediaHtml = `
                  <div class="ctg-image-wrapper" style="position: relative;">
                    <div id="vehicle-slideshow-${item.id}" class="vehicle-slideshow" style="display: flex; overflow-x: auto; scroll-snap-type: x mandatory; width: 100%; height: 100%; scrollbar-width: none; scroll-behavior: smooth;">
                      ${slidesHtml}
                    </div>
                    <button type="button" class="card-carousel-nav-btn prev" onclick="event.stopPropagation(); window.slideVehicleCardCarousel('${item.id}', -1)" aria-label="Image précédente" title="Photo précédente">
                      <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <button type="button" class="card-carousel-nav-btn next" onclick="event.stopPropagation(); window.slideVehicleCardCarousel('${item.id}', 1)" aria-label="Image suivante" title="Photo suivante">
                      <i class="fa-solid fa-chevron-right"></i>
                    </button>
                    <div id="vehicle-dots-${item.id}" style="position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; background: rgba(0,0,0,0.55); padding: 4px 8px; border-radius: 99px; z-index: 2; pointer-events: none; backdrop-filter: blur(4px);">
                      ${mediaArray.map((_, i) => `<span class="vehicle-carousel-dot" style="width: 5px; height: 5px; border-radius: 50%; background: ${i === 0 ? '#ffffff' : 'rgba(255,255,255,0.4)'}; transition: all 0.2s;"></span>`).join('')}
                    </div>
                  </div>`;
              }
            } catch (err) {
              console.error("Error parsing mediaUrl array:", err);
            }
          } else {
            // Single video or image media
            const isVideo = mediaUrl.includes(".mp4") || mediaUrl.includes("youtube.com") || mediaUrl.includes("youtu.be") || mediaUrl.includes("vimeo.com");
            if (isVideo) {
              if (mediaUrl.includes("youtube.com") || mediaUrl.includes("youtu.be")) {
                let videoId = "";
                if (mediaUrl.includes("youtu.be/")) {
                  videoId = mediaUrl.split("youtu.be/")[1]?.split("?")[0];
                } else {
                  videoId = mediaUrl.split("v/")[1] || mediaUrl.split("vi/")[1] || mediaUrl.split("v=")[1]?.split("&")[0];
                }
                const safeVideoId = encodeURIComponent(videoId || '');
                mediaHtml = `
                  <div class="ctg-image-wrapper">
                    <iframe src="https://www.youtube.com/embed/${safeVideoId}?autoplay=1&mute=1&loop=1&playlist=${safeVideoId}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="width: 100%; height: 100%; border-radius: 12px; border: none; z-index: 0;"></iframe>
                  </div>`;
              } else {
                const safeVideoSrc = escapeHTML(sanitizeUrl(mediaUrl, ''));
                mediaHtml = `
                  <div class="ctg-image-wrapper">
                    <video src="${safeVideoSrc}" controls muted autoplay loop style="width: 100%; height: 100%; object-fit: cover; z-index: 0; border-radius: 12px;"></video>
                  </div>`;
              }
            } else {
              const safeImgSrc = escapeHTML(sanitizeUrl(mediaUrl, 'assets/logo.webp'));
              mediaHtml = `
                <div class="ctg-image-wrapper">
                  <img src="${safeImgSrc}" alt="${escapeHTML(item.name)}" onerror="this.src='assets/logo.webp';" />
                </div>`;
            }
          }
        }
      }
    } catch (e) {
      console.warn("Failed to parse JSON specs:", e.message);
    }

    // Fallback media if no custom media URL was provided but we have a spawn code from name
    if (!mediaHtml) {
      const spawnCode = encodeURIComponent((item.name || '').toLowerCase().trim());
      const defaultImg = `https://api.staff.gta.ctgaming.fr:2096/uploads/vehicle-screenshots/${spawnCode}.webp`;
      const classStyle = getCTGClassStyle(displayClass);

      mediaHtml = `
        <div class="ctg-image-wrapper">
          <img src="${escapeHTML(defaultImg)}" alt="${escapeHTML(item.name)}" onerror="this.src='assets/logo.webp';" />
          <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: radial-gradient(ellipse at center, ${classStyle.color}1e 0%, transparent 65%), radial-gradient(ellipse, transparent 20%, #0d0d10 70%); pointer-events: none; z-index: 1;"></div>
        </div>`;
    }

    const classStyle = getCTGClassStyle(displayClass);

    let renterInfoHtml = "";
    if (item.status === 'rented') {
      const activeBooking = state.allBookingsList.find(b =>
        (b.status === 'confirmed' || b.status === 'pending') &&
        b.item_name && (
          b.item_name.toLowerCase().trim() === item.name.toLowerCase().trim() ||
          item.name.toLowerCase().includes(b.item_name.toLowerCase().trim()) ||
          b.item_name.toLowerCase().includes(item.name.toLowerCase().trim())
        )
      );

      if (activeBooking) {
        renterInfoHtml = `
          <div class="active-rental-card-info" style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #ef4444; display: inline-flex; align-items: center; gap: 5px;">
                <i class="fa-solid fa-key" style="font-size: 10px;"></i> Loué à
              </span>
              <span style="font-size: 11px; font-weight: 600; color: #a1a1aa; font-family: monospace; background: rgba(0,0,0,0.35); padding: 1px 6px; border-radius: 4px;">#${escapeHTML(activeBooking.id.slice(0, 6).toUpperCase())}</span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #ffffff; display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-user-check" style="color: #c5a880; font-size: 12px;"></i>
              <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(activeBooking.client_name || 'Citoyen RP')}</span>
            </div>
            ${activeBooking.discord_id ? `
              <div style="font-size: 11.5px; color: #818cf8; display: flex; align-items: center; gap: 5px;">
                <i class="fa-brands fa-discord"></i>
                <span>ID : ${escapeHTML(activeBooking.discord_id)}</span>
              </div>
            ` : ''}
            ${activeBooking.dates ? `
              <div style="font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 5px;">
                <i class="fa-regular fa-calendar-days"></i>
                <span>${escapeHTML(activeBooking.dates)}</span>
              </div>
            ` : ''}
          </div>
        `;
      }
    }

      card.innerHTML = `
        ${mediaHtml}
        <div class="admin-card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="status-pill ${item.status}">${item.status === 'confirmed' ? 'Disponible' : item.status === 'rented' ? 'Occupé' : 'En attente'}</span>
            <span class="type-tag" style="background: ${classStyle.bg}; border: ${classStyle.border}; color: ${classStyle.color}; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 10px; border-radius: 20px; box-shadow: ${classStyle.shadow};">${escapeHTML(displayClass)}</span>
          </div>
          <span class="card-price">${escapeHTML(item.price)}</span>
        </div>
        <h3 style="margin-top: 6px; margin-bottom: 4px; font-size: 16px; font-weight: 700; color: #ffffff;">${escapeHTML(item.name)}</h3>
        <div style="display: flex; align-items: center; margin-bottom: 10px;">
          <span style="font-size: 12px; color: #a1a1aa;">Plaque : <strong style="font-size: 12.5px; font-family: monospace; font-weight: 700; color: #ffffff; background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14); letter-spacing: 0.04em;">${escapeHTML(displayPlate)}</strong></span>
        </div>
        <p class="card-sub" style="margin-bottom: 12px; min-height: 18px;">${escapeHTML(displaySpecs)}</p>
        ${renterInfoHtml}
        <div class="admin-card-actions-v2">
          <div class="admin-card-actions-row-main">
            ${toggleButton}
          </div>
          <div class="admin-card-actions-row-sub">
            <button class="admin-btn-secondary" onclick="window.editFleetItem('${item.id}')" title="Modifier la fiche"><i class="fa-solid fa-pen"></i> Modifier</button>
            <button class="admin-btn-danger" onclick="window.deleteItem('${item.id}', 'fleet')" title="Supprimer définitivement"><i class="fa-solid fa-trash"></i> Supprimer</button>
          </div>
        </div>
      `;
    container.appendChild(card);
  });
}

export async function loadVehicles() {
  const container = document.getElementById("fleet-admin-list");
  if (!container || !supabaseClient) return;

  const [{ data: vData, error: vError }, { data: bData }] = await Promise.all([
    supabaseClient.from("vehicules").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("bookings").select("*").order("created_at", { ascending: false })
  ]);

  if (vError) return console.error("Error loading vehicles:", vError.message);
  state.allVehicles = vData || [];
  if (bData) state.allBookingsList = bData;
  applyFleetFilters();

  const overviewFleetList = document.getElementById("overview-fleet-status-list");
  if (overviewFleetList) {
    overviewFleetList.innerHTML = "";
    state.allVehicles.slice(0, 3).forEach(item => {
      const div = document.createElement("div");
      div.className = "fleet-status-item";
      const statusClass = item.status === 'confirmed' ? 'available' : item.status === 'rented' ? 'rented' : 'maintenance';
      const statusText = item.status === 'confirmed' ? 'Disponible' : item.status === 'rented' ? 'En Location' : 'En attente';

      // Parse specs JSON if applicable
      let displayPlate = "LXS-RICH-RP";
      try {
        if (item.specs && item.specs.startsWith("{")) {
          const meta = JSON.parse(item.specs);
          displayPlate = meta.plate || "LXS-RICH-RP";
        } else if (item.specs) {
          displayPlate = item.specs;
        }
      } catch (e) { console.warn('[Richman]', e); }

      div.innerHTML = `
        <div class="fleet-item-info">
          <span class="fleet-name">${escapeHTML(item.name)}</span>
          <span class="fleet-plate">${escapeHTML(displayPlate)}</span>
        </div>
        <span class="status-badge ${statusClass}">${statusText}</span>
      `;
      overviewFleetList.appendChild(div);
    });
  }

  updateKPIs();
}

export function applySuitesFilters() {
  const container = document.getElementById("suites-admin-list");
  const countBadge = document.getElementById("suites-count-badge");
  if (!container) return;

  const searchQuery = (document.getElementById("suites-search-input") as HTMLInputElement | null)?.value.toLowerCase().trim() || "";
  const filterCategory = (document.getElementById("suites-filter-category") as HTMLSelectElement | null)?.value || "";
  const filterStatus = (document.getElementById("suites-filter-status") as HTMLSelectElement | null)?.value || "";
  const sortBy = (document.getElementById("suites-sort-by") as HTMLSelectElement | null)?.value || "default";

  let filtered = [...state.allSuites];

  // 1. Apply Search Query
  if (searchQuery) {
    filtered = filtered.filter(item =>
      (item.name && item.name.toLowerCase().includes(searchQuery)) ||
      (item.specs && item.specs.toLowerCase().includes(searchQuery)) ||
      (item.price && item.price.toLowerCase().includes(searchQuery)) ||
      (item.room_number && item.room_number.toLowerCase().includes(searchQuery)) ||
      (item.floor && item.floor.toLowerCase().includes(searchQuery)) ||
      (item.category && item.category.toLowerCase().includes(searchQuery))
    );
  }

  // 2. Apply Category Filter
  if (filterCategory) {
    filtered = filtered.filter(item => (item.category || '').toLowerCase() === filterCategory.toLowerCase());
  }

  // 3. Apply Status Filter
  if (filterStatus) {
    filtered = filtered.filter(item => item.status === filterStatus);
  }

  // 4. Apply Sorting
  if (sortBy === "price-asc" || sortBy === "price-desc") {
    const getPriceNum = (pStr: string) => {
      const parsed = parseInt((pStr || '').replace(/[^0-9]/g, ''), 10);
      return isNaN(parsed) ? 0 : parsed;
    };
    filtered.sort((a, b) => {
      const priceA = getPriceNum(a.price);
      const priceB = getPriceNum(b.price);
      return sortBy === 'price-asc' ? priceA - priceB : priceB - priceA;
    });
  } else if (sortBy === "name-asc") {
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else {
    filtered.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }

  // Update badge count
  if (countBadge) {
    countBadge.textContent = `${filtered.length} hébergement${filtered.length !== 1 ? 's' : ''}`;
  }

  container.innerHTML = "";
  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #8e8e8e; padding: 40px 0; font-family: var(--font-sans);">Aucun hébergement ne correspond aux critères.</div>`;
    return;
  }

  const catLabels: Record<string, { label: string; style: string }> = {
    suite: { label: '🏨 Suite', style: 'background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);' },
    appartement: { label: '🏢 Appartement', style: 'background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);' },
    chambre: { label: '🛏️ Chambre', style: 'background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);' },
    penthouse: { label: '🌆 Penthouse', style: 'background: rgba(197, 168, 128, 0.15); color: #c5a880; border: 1px solid rgba(197, 168, 128, 0.3);' },
    villa: { label: '🏡 Villa Privée', style: 'background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);' },
    loft: { label: '🛖 Loft Prestige', style: 'background: rgba(236, 72, 153, 0.15); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.3);' }
  };

  filtered.forEach(item => {
    const card = document.createElement("div");
    card.className = "admin-card-item";

    const isAvailable = item.status === 'confirmed' || item.status === 'available';
    const toggleButton = isAvailable
      ? `<button class="admin-btn-secondary" onclick="window.updateItemStatus('${item.id}', 'suites', 'rented')"><i class="fa-solid fa-bed"></i> Occuper cet hébergement</button>`
      : `<button class="admin-btn-primary" onclick="window.updateItemStatus('${item.id}', 'suites', 'confirmed')"><i class="fa-solid fa-check"></i> Libérer cet hébergement</button>`;

    const catInfo = catLabels[item.category] || catLabels.suite;
    const roomBadge = item.room_number ? `<span style="font-family: monospace; font-size: 11.5px; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); color: #fff; font-weight: 600;">🚪 ${escapeHTML(item.room_number)}</span>` : '';
    const codeBadge = item.access_code ? `<span style="font-family: monospace; font-size: 11.5px; background: rgba(56, 189, 248, 0.12); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; font-weight: 600;" title="Code d'accès / Digicode">🔑 ${escapeHTML(item.access_code)}</span>` : '';
    const floorInfo = item.floor ? `<div style="font-size: 12px; color: #a1a1aa; margin-top: 2px;"><i class="fa-solid fa-layer-group" style="margin-right: 4px; color: #c5a880;"></i> ${escapeHTML(item.floor)}</div>` : '';

    // Handle Media & Carousels
    let mediaHtml = '';
    let mediaArray: string[] = [];
    if (item.media_urls) {
      if (typeof item.media_urls === 'string' && item.media_urls.startsWith('[')) {
        try {
          const parsed = JSON.parse(item.media_urls);
          if (Array.isArray(parsed)) mediaArray = parsed.filter(Boolean);
        } catch (e) {}
      } else if (typeof item.media_urls === 'string' && item.media_urls.includes(',')) {
        mediaArray = item.media_urls.split(',').map(s => s.trim()).filter(Boolean);
      } else if (typeof item.media_urls === 'string' && item.media_urls.trim()) {
        mediaArray = [item.media_urls.trim()];
      } else if (Array.isArray(item.media_urls)) {
        mediaArray = item.media_urls.filter(Boolean);
      }
    }

    if (mediaArray.length === 0) {
      const fallbackUrl = (item.name && item.name.toUpperCase().includes('VILLA'))
        ? 'https://ghbeopdnfdxuqfjzmmeb.supabase.co/storage/v1/object/public/public_assets/media/villarichman.webp'
        : 'https://ghbeopdnfdxuqfjzmmeb.supabase.co/storage/v1/object/public/public_assets/media/penthouse.webp';
      mediaArray = [fallbackUrl];
    }

    if (mediaArray.length > 1) {
      let slidesHtml = '';
      mediaArray.forEach((url) => {
        const safeImgSrc = escapeHTML(sanitizeUrl(url, 'assets/hotel/01_facade_jour.jpg'));
        slidesHtml += `<img class="vehicle-slide" src="${safeImgSrc}" alt="${escapeHTML(item.name)}" onclick="window.openAdminImagePreview('${safeImgSrc}')" style="flex: 0 0 100%; width: 100%; height: 100%; scroll-snap-align: start; object-fit: cover; cursor: zoom-in;" />`;
      });

      mediaHtml = `
        <div class="ctg-image-wrapper" style="position: relative;">
          <div id="suite-slideshow-${item.id}" class="vehicle-slideshow" style="display: flex; overflow-x: auto; scroll-snap-type: x mandatory; width: 100%; height: 100%; scrollbar-width: none; scroll-behavior: smooth;">
            ${slidesHtml}
          </div>
          <button type="button" class="card-carousel-nav-btn prev" onclick="event.stopPropagation(); window.slideSuiteCardCarousel('${item.id}', -1)" aria-label="Image précédente" title="Photo précédente">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <button type="button" class="card-carousel-nav-btn next" onclick="event.stopPropagation(); window.slideSuiteCardCarousel('${item.id}', 1)" aria-label="Image suivante" title="Photo suivante">
            <i class="fa-solid fa-chevron-right"></i>
          </button>
          <div id="suite-dots-${item.id}" style="position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; background: rgba(0,0,0,0.55); padding: 4px 8px; border-radius: 99px; z-index: 2; pointer-events: none; backdrop-filter: blur(4px);">
            ${mediaArray.map((_, i) => `<span class="suite-carousel-dot" style="width: 5px; height: 5px; border-radius: 50%; background: ${i === 0 ? '#ffffff' : 'rgba(255,255,255,0.4)'}; transition: all 0.2s;"></span>`).join('')}
          </div>
        </div>`;
    } else {
      const safeImgSrc = escapeHTML(sanitizeUrl(mediaArray[0], 'assets/hotel/01_facade_jour.jpg'));
      mediaHtml = `
        <div class="ctg-image-wrapper" style="position: relative; cursor: zoom-in;" onclick="window.openAdminImagePreview('${safeImgSrc}')">
          <img src="${safeImgSrc}" alt="${escapeHTML(item.name)}" onerror="this.src='https://ghbeopdnfdxuqfjzmmeb.supabase.co/storage/v1/object/public/public_assets/media/penthouse.webp';" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>`;
    }

    let renterInfoHtml = "";
    if (item.status === 'rented') {
      const activeBooking = state.allBookingsList.find(b =>
        (b.status === 'confirmed' || b.status === 'pending') &&
        b.item_name && (
          b.item_name.toLowerCase().trim() === item.name.toLowerCase().trim() ||
          item.name.toLowerCase().includes(b.item_name.toLowerCase().trim()) ||
          b.item_name.toLowerCase().includes(item.name.toLowerCase().trim())
        )
      );

      if (activeBooking) {
        renterInfoHtml = `
          <div class="active-rental-card-info" style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #ef4444; display: inline-flex; align-items: center; gap: 5px;">
                <i class="fa-solid fa-key" style="font-size: 10px;"></i> Réservé par
              </span>
              <span style="font-size: 11px; font-weight: 600; color: #a1a1aa; font-family: monospace; background: rgba(0,0,0,0.35); padding: 1px 6px; border-radius: 4px;">#${escapeHTML(activeBooking.id.slice(0, 6).toUpperCase())}</span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #ffffff; display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-user-check" style="color: #c5a880; font-size: 12px;"></i>
              <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(activeBooking.client_name || 'Citoyen RP')}</span>
            </div>
            ${activeBooking.discord_id ? `
              <div style="font-size: 11.5px; color: #818cf8; display: flex; align-items: center; gap: 5px;">
                <i class="fa-brands fa-discord"></i>
                <span>ID : ${escapeHTML(activeBooking.discord_id)}</span>
              </div>
            ` : ''}
            ${activeBooking.dates ? `
              <div style="font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 5px;">
                <i class="fa-regular fa-calendar-days"></i>
                <span>${escapeHTML(activeBooking.dates)}</span>
              </div>
            ` : ''}
          </div>
        `;
      }
    }

    card.innerHTML = `
      ${mediaHtml}
      <div class="admin-card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span class="type-tag" style="${catInfo.style}">${catInfo.label}</span>
          ${roomBadge}
          ${codeBadge}
        </div>
        <span class="card-price">${escapeHTML(item.price)}</span>
      </div>
      <h3 style="margin-top: 6px; margin-bottom: 4px; font-size: 16px; font-weight: 700; color: #ffffff;">${escapeHTML(item.name)}</h3>
      ${floorInfo}
      <p class="card-sub" style="margin-top: 6px; margin-bottom: 12px; min-height: 18px;">${escapeHTML(item.specs || "")}</p>
      <div style="margin-bottom: 10px;">
        <span class="status-pill ${item.status}">${item.status === 'confirmed' ? 'Disponible' : item.status === 'rented' ? 'Occupé' : 'En attente'}</span>
      </div>
      ${renterInfoHtml}
      <div class="admin-card-actions-v2">
        <div class="admin-card-actions-row-main">
          ${toggleButton}
        </div>
        <div class="admin-card-actions-row-sub">
          <button class="admin-btn-secondary" onclick="window.openEditSuiteModal('${item.id}')" title="Modifier cet hébergement"><i class="fa-solid fa-pen"></i> Modifier</button>
          <button class="admin-btn-danger" onclick="window.deleteItem('${item.id}', 'suites')" title="Supprimer définitivement"><i class="fa-solid fa-trash"></i> Supprimer</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

export async function loadSuites() {
  const container = document.getElementById("suites-admin-list");
  if (!container || !supabaseClient) return;
  // access_code n'est plus lisible en SELECT direct (grant SQL par colonne) : RPC staff dédiée
  const [{ data, error }, { data: bData }] = await Promise.all([
    supabaseClient.from("suites")
      .select("id,name,price,specs,status,created_at,room_number,category,floor,media_urls")
      .order("created_at", { ascending: false }),
    supabaseClient.from("bookings").select("*").order("created_at", { ascending: false })
  ]);
  if (error) return console.error("Error loading suites:", error.message);

  state.allSuites = data || [];
  if (bData) state.allBookingsList = bData;

  // Digicodes : réservés au staff (get_suite_access_codes renvoie vide pour les non-admins)
  const { data: accessCodes, error: codesError } = await supabaseClient.rpc("get_suite_access_codes");
  if (codesError) console.warn("Chargement des digicodes impossible :", codesError.message);
  if (Array.isArray(accessCodes)) {
    const codeMap = new Map(accessCodes.map(c => [c.suite_id, c.access_code]));
    state.allSuites.forEach(s => { s.access_code = codeMap.get(s.id) || null; });
  }

  applySuitesFilters();
  updateKPIs();
}

export async function loadLogs() {
  const container = document.getElementById("logs-table-body");
  if (!container || !supabaseClient) return;
  const { data, error } = await supabaseClient.from("logs").select("*").order("created_at", { ascending: false }).limit(30);
  if (error) return console.error("Error loading logs:", error.message);

  container.innerHTML = "";
  if (!data || data.length === 0) {
    container.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #71717a; padding: 32px; font-size: 13px;">Aucun événement d'audit enregistré.</td></tr>`;
    return;
  }

  data.forEach(item => {
    const tr = document.createElement("tr");
    const dateStr = new Date(item.created_at).toLocaleString('fr-FR');
    let levelClass = 'role-citizen';
    let levelLabel = 'INFO';
    if (item.type === 'danger' || item.type === 'critical') {
      levelClass = 'role-owner';
      levelLabel = 'CRITIQUE';
    } else if (item.type === 'warning') {
      levelClass = 'role-vip';
      levelLabel = 'AVERTISSEMENT';
    } else if (item.type === 'success') {
      levelClass = 'role-admin';
      levelLabel = 'SUCCÈS';
    }

    tr.innerHTML = `
      <td style="font-family: monospace; font-size: 11.5px; color: #71717a;">${dateStr}</td>
      <td><strong style="color: #ffffff; font-size: 13px;">${escapeHTML(item.user_name || 'Système')}</strong></td>
      <td style="color: #e4e4e7; font-size: 12.5px;">${escapeHTML(item.action)}</td>
      <td><span style="font-family: monospace; font-size: 11px; background: #18181b; border: 1px solid #27272a; padding: 2px 6px; border-radius: 4px; color: #a1a1aa;">${escapeHTML(item.ip || 'Console Admin')}</span></td>
      <td><span class="user-role-badge-clean ${levelClass}">${levelLabel}</span></td>
    `;
    container.appendChild(tr);
  });
}

export async function loadConciergeMessages() {
  const container = document.getElementById("concierge-messages-list");
  if (!container || !supabaseClient) return;
  const { data, error } = await supabaseClient.from("contact_messages").select("*").order("created_at", { ascending: false });
  if (error) return console.error("Error loading concierge messages:", error.message);

  container.innerHTML = "";
  if (!data || data.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #71717a; padding: 40px 0; font-size: 13px;">Aucune demande de contact en attente.</div>`;
    return;
  }

  data.forEach(item => {
    const card = document.createElement("div");
    card.className = "concierge-msg-card";
    const dateStr = new Date(item.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const safeClient = escapeHTML(item.name || "Citoyen RP");
    const safeInitial = safeClient.slice(0, 2).toUpperCase() || "CL";
    const statusLabel = item.status === 'confirmed' ? 'Traité / Validé' : item.status === 'cancelled' ? 'Annulé' : 'En attente';

    card.innerHTML = `
      <div class="concierge-msg-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="admin-avatar" style="width: 32px; height: 32px; font-size: 12px;">${safeInitial}</div>
          <div>
            <h4 style="margin: 0; font-size: 14px; font-weight: 600; color: #fff;">${safeClient}</h4>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
              <span class="type-tag" style="font-size: 10.5px;">${escapeHTML(item.subject || 'Contact')}</span>
              <span class="status-pill ${escapeHTML(item.status || 'pending')}" style="font-size: 10.5px;">${statusLabel}</span>
            </div>
          </div>
        </div>
        <span style="font-size: 11.5px; color: #71717a; font-family: monospace;">${dateStr}</span>
      </div>

      <div class="concierge-msg-body">
        <div style="font-size: 11.5px; color: #a1a1aa; margin-bottom: 6px; display: flex; gap: 14px; flex-wrap: wrap;">
          <span><strong>Contact :</strong> ${escapeHTML(item.phone || 'Non renseigné')}</span>
          ${item.discord_id ? `<span><strong>Discord :</strong> <a href="https://discord.com/users/${escapeHTML(item.discord_id)}" target="_blank" rel="noopener noreferrer" style="color: #818cf8; text-decoration: none;"><i class="fa-brands fa-discord"></i> ${escapeHTML(item.discord_id)}</a></span>` : ''}
        </div>
        <p style="margin: 0; font-size: 13px; color: #ffffff; white-space: pre-wrap;">${escapeHTML(item.message || 'Aucun détail.')}</p>
      </div>

      <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center; margin-top: 4px;">
        ${item.ticket_channel_id ? `
          <a href="https://discord.com/channels/1537171063715401870/${escapeHTML(item.ticket_channel_id)}" target="_blank" rel="noopener noreferrer" class="admin-btn-secondary" style="height: 30px; padding: 0 10px; font-size: 11.5px; text-decoration: none;">
            <i class="fa-brands fa-discord"></i> Ticket Discord
          </a>
        ` : ''}
        ${item.status !== 'confirmed' ? `<button class="admin-btn-primary" onclick="window.updateContactMessageStatus('${escapeHTML(item.id)}', 'confirmed')" style="height: 30px; padding: 0 10px; font-size: 11.5px;"><i class="fa-solid fa-check"></i> Marquer Traité</button>` : ''}
        ${item.status !== 'cancelled' ? `<button class="admin-btn-secondary" onclick="window.updateContactMessageStatus('${escapeHTML(item.id)}', 'cancelled')" style="height: 30px; padding: 0 10px; font-size: 11.5px;"><i class="fa-solid fa-xmark"></i> Annuler</button>` : ''}
        <button class="user-act-btn-clean danger" onclick="window.deleteContactMessage('${escapeHTML(item.id)}')" title="Supprimer"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;
    container.appendChild(card);
  });
}

export async function loadBookings() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient.from("bookings").select("*").order("created_at", { ascending: false });
  if (error) return console.error("Error loading bookings:", error.message);
  state.allBookingsList = data || [];
  if (document.getElementById("fleet-admin-list") && state.allVehicles.length > 0) {
    applyFleetFilters();
  }

  // Populate dedicated analytics dashboards for locations & suites
  renderAnalyticsDashboards(data || []);

  const overviewContainer = document.getElementById("overview-bookings-tbody");
  if (overviewContainer) {
    overviewContainer.innerHTML = "";
    if (data.length === 0) {
      overviewContainer.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #71717a; padding: 24px; font-size: 12.5px;">Aucune activité récente.</td></tr>`;
    } else {
      data.slice(0, 4).forEach(item => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong style="color: #ffffff; font-size: 13px;">${escapeHTML(item.client_name)}</strong></td>
          <td><span class="type-tag ${item.type === 'vehicule' ? 'car' : 'suite'}">${item.type === 'vehicule' ? 'Véhicule' : 'Suite'}</span></td>
          <td style="color: #ffffff; font-size: 13px;">${escapeHTML(item.item_name)}</td>
          <td style="font-weight: 600; color: #ffffff; font-size: 13px;">${escapeHTML(item.amount)}</td>
          <td><span class="status-pill ${escapeHTML(item.status)}">${item.status === 'confirmed' ? 'Validé' : item.status === 'cancelled' ? 'Annulé' : 'En attente'}</span></td>
        `;
        overviewContainer.appendChild(tr);
      });
    }
  }

  updateKPIs();
}

let currentStatsPeriod: Record<string, string> = { cars: 'all', suites: 'all' };
let currentStatsMetric: Record<string, string> = { cars: 'revenue', suites: 'revenue' };

(window as any).setStatsPeriod = function(type: string, period: string) {
  currentStatsPeriod[type] = period;
  const container = document.getElementById(`${type}-period-filter`);
  if (container) {
    container.querySelectorAll('.saas-pill-btn').forEach(btn => {
      if ((btn as HTMLElement).dataset.period === period) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }
  renderAnalyticsDashboards(state.allBookingsList || []);
};

(window as any).toggleStatsMetric = function(type: string, metric: string) {
  currentStatsMetric[type] = metric;
  const container = document.getElementById(`${type}-chart-metric-toggle`);
  if (container) {
    container.querySelectorAll('.saas-pill-btn').forEach(btn => {
      if ((btn as HTMLElement).dataset.metric === metric) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }
  renderAnalyticsDashboards(state.allBookingsList || []);
};

// Global Vercel Chart Tooltip Helper
function showChartTooltip(e: MouseEvent, date: string, valStr: string, subStr: string) {
  let tip = document.getElementById("vercel-chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "vercel-chart-tooltip";
    tip.className = "vercel-chart-tooltip";
    document.body.appendChild(tip);
  }

  tip.innerHTML = `
    <div class="vtt-date">${escapeHTML(date)}</div>
    <div class="vtt-val">${escapeHTML(valStr)}</div>
    ${subStr ? `<div class="vtt-sub">${escapeHTML(subStr)}</div>` : ''}
  `;

  tip.style.display = "block";
  tip.style.left = `${e.pageX}px`;
  tip.style.top = `${e.pageY}px`;
}

function hideChartTooltip() {
  const tip = document.getElementById("vercel-chart-tooltip");
  if (tip) tip.style.display = "none";
}

// SVG Cubic Bezier Smoothing Helper
function getSvgPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

// Draw SaaS Area / Line Timeline Curve
function drawTimelineAreaChart(
  containerEl: HTMLElement,
  dataPoints: { date: string; label: string; revenue: number; count: number }[],
  metric: 'revenue' | 'count'
) {
  containerEl.innerHTML = "";
  const isRevenue = metric === 'revenue';
  const fmt = (v: number) => isRevenue
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
    : `${v} dossier(s)`;

  if (dataPoints.length === 0) {
    containerEl.innerHTML = `<div style="text-align: center; color: #71717a; padding: 40px; font-size: 12.5px;">Aucune donnée chronologique disponible.</div>`;
    return;
  }

  const w = 600;
  const h = 210;
  const padL = 60;
  const padR = 25;
  const padT = 25;
  const padB = 35;

  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const values = dataPoints.map(d => isRevenue ? d.revenue : d.count);
  const maxVal = Math.max(...values, isRevenue ? 1000 : 5);
  const minVal = 0;

  const points = dataPoints.map((d, i) => {
    const x = padL + (i / Math.max(dataPoints.length - 1, 1)) * innerW;
    const yVal = isRevenue ? d.revenue : d.count;
    const y = padT + innerH - (yVal / maxVal) * innerH;
    return { x, y, data: d, val: yVal };
  });

  const linePath = getSvgPath(points);
  const lastX = points[points.length - 1].x;
  const firstX = points[0].x;
  const bottomY = padT + innerH;
  const areaPath = `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;

  const gradId = `saas-grad-${Math.random().toString(36).substring(2, 8)}`;

  // Generate 4 Y ticks
  let yGridHtml = '';
  for (let step = 0; step <= 3; step++) {
    const yRatio = step / 3;
    const yPos = padT + innerH - (yRatio * innerH);
    const tickVal = Math.round(minVal + yRatio * maxVal);
    const label = isRevenue
      ? (tickVal >= 1000 ? `${Math.round(tickVal / 1000)}k €` : `${tickVal} €`)
      : String(tickVal);

    yGridHtml += `
      <line x1="${padL}" y1="${yPos}" x2="${w - padR}" y2="${yPos}" stroke="#27272a" stroke-dasharray="3 3" stroke-width="1" />
      <text x="${padL - 10}" y="${yPos + 3.5}" fill="#71717a" font-size="10" font-family="monospace" text-anchor="end">${label}</text>
    `;
  }

  // Generate X labels (pick at most 6 evenly spaced)
  let xLabelsHtml = '';
  const labelStep = Math.max(1, Math.floor(dataPoints.length / 6));
  dataPoints.forEach((d, i) => {
    if (i % labelStep === 0 || i === dataPoints.length - 1) {
      const pt = points[i];
      xLabelsHtml += `
        <text x="${pt.x}" y="${h - 10}" fill="#71717a" font-size="10.5" font-family="monospace" text-anchor="middle">${escapeHTML(d.label)}</text>
      `;
    }
  });

  // Generate interactive circles & vertical trigger bars
  let dotsHtml = '';
  points.forEach((pt) => {
    dotsHtml += `
      <g class="chart-point-group" style="cursor: pointer;">
        <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#000000" stroke="#ffffff" stroke-width="2" />
        <rect x="${pt.x - 15}" y="${padT}" width="30" height="${innerH}" fill="transparent"
          data-date="${escapeHTML(pt.data.date)}"
          data-val="${escapeHTML(fmt(pt.val))}"
          data-sub="${escapeHTML(isRevenue ? `${pt.data.count} location(s)` : `${fmt(pt.data.revenue)}`)}"
        />
      </g>
    `;
  });

  const svgHtml = `
    <svg class="saas-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22" />
          <stop offset="60%" stop-color="#ffffff" stop-opacity="0.04" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      ${yGridHtml}
      <path d="${areaPath}" fill="url(#${gradId})" />
      <path d="${linePath}" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${xLabelsHtml}
      ${dotsHtml}
    </svg>
  `;

  containerEl.innerHTML = svgHtml;

  // Bind tooltip hover events
  containerEl.querySelectorAll('.chart-point-group rect').forEach(r => {
    r.addEventListener('mouseenter', (e: any) => {
      const target = e.target as HTMLElement;
      showChartTooltip(e, target.dataset.date || '', target.dataset.val || '', target.dataset.sub || '');
    });
    r.addEventListener('mousemove', (e: any) => {
      const target = e.target as HTMLElement;
      showChartTooltip(e, target.dataset.date || '', target.dataset.val || '', target.dataset.sub || '');
    });
    r.addEventListener('mouseleave', () => {
      hideChartTooltip();
    });
  });
}

// Draw SaaS Donut Status Chart
function drawDonutChart(containerEl: HTMLElement, confirmed: number, pending: number, cancelled: number) {
  containerEl.innerHTML = "";
  const total = confirmed + pending + cancelled;
  const successRate = total > 0 ? Math.round((confirmed / total) * 100) : 0;
  const pendingRate = total > 0 ? Math.round((pending / total) * 100) : 0;
  const cancelledRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

  const r = 44;
  const circum = 2 * Math.PI * r;

  const confLen = (confirmed / (total || 1)) * circum;
  const pendLen = (pending / (total || 1)) * circum;
  const cancLen = (cancelled / (total || 1)) * circum;

  const confOffset = 0;
  const pendOffset = -confLen;
  const cancOffset = -(confLen + pendLen);

  const svgHtml = `
    <div style="position: relative; width: 110px; height: 110px; flex-shrink: 0;">
      <svg width="110" height="110" viewBox="0 0 110 110" style="transform: rotate(-90deg);">
        <!-- Background track -->
        <circle cx="55" cy="55" r="${r}" fill="none" stroke="#18181b" stroke-width="12" />
        <!-- Confirmed (White) -->
        <circle cx="55" cy="55" r="${r}" fill="none" stroke="#ffffff" stroke-width="12"
          stroke-dasharray="${confLen} ${circum - confLen}" stroke-dashoffset="${confOffset}" stroke-linecap="round" />
        <!-- Pending (Zinc 500) -->
        <circle cx="55" cy="55" r="${r}" fill="none" stroke="#71717a" stroke-width="12"
          stroke-dasharray="${pendLen} ${circum - pendLen}" stroke-dashoffset="${pendOffset}" />
        <!-- Cancelled (Zinc 800) -->
        <circle cx="55" cy="55" r="${r}" fill="none" stroke="#27272a" stroke-width="12"
          stroke-dasharray="${cancLen} ${circum - cancLen}" stroke-dashoffset="${cancOffset}" />
      </svg>
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <span style="font-size: 16px; font-weight: 800; color: #ffffff; font-family: monospace; line-height: 1;">${successRate}%</span>
        <span style="font-size: 9.5px; color: #71717a; text-transform: uppercase; margin-top: 2px; letter-spacing: 0.05em;">Succès</span>
      </div>
    </div>

    <!-- Legend -->
    <div class="saas-donut-legend">
      <div class="saas-donut-legend-item">
        <span><span class="saas-donut-dot" style="background: #ffffff;"></span>Validés</span>
        <strong style="color: #ffffff; font-family: monospace;">${confirmed} (${successRate}%)</strong>
      </div>
      <div class="saas-donut-legend-item">
        <span><span class="saas-donut-dot" style="background: #71717a;"></span>En attente</span>
        <strong style="color: #a1a1aa; font-family: monospace;">${pending} (${pendingRate}%)</strong>
      </div>
      <div class="saas-donut-legend-item">
        <span><span class="saas-donut-dot" style="background: #27272a;"></span>Annulés</span>
        <strong style="color: #52525b; font-family: monospace;">${cancelled} (${cancelledRate}%)</strong>
      </div>
    </div>
  `;

  containerEl.innerHTML = svgHtml;
}

// Draw SaaS Demand Histogram (Bar Chart)
function drawDemandBarChart(containerEl: HTMLElement, topItems: { name: string; count: number; revenue: number }[]) {
  containerEl.innerHTML = "";
  if (topItems.length === 0) {
    containerEl.innerHTML = `<div style="text-align: center; color: #71717a; padding: 24px; font-size: 12px;">Aucune donnée de comparaison.</div>`;
    return;
  }

  const items = topItems.slice(0, 5);
  const maxCount = Math.max(...items.map(i => i.count), 1);
  const w = 380;
  const h = 135;
  const padT = 20;
  const padB = 30;
  const barW = 32;

  const spacing = (w - 40) / items.length;
  let barsHtml = '';

  items.forEach((item, idx) => {
    const x = 20 + idx * spacing + (spacing - barW) / 2;
    const maxBarH = h - padT - padB;
    const barH = Math.max(6, (item.count / maxCount) * maxBarH);
    const y = padT + maxBarH - barH;

    const shortName = item.name.length > 8 ? item.name.slice(0, 7) + '..' : item.name;

    barsHtml += `
      <g class="barchart-group" style="cursor: pointer;">
        <!-- Track -->
        <rect x="${x}" y="${padT}" width="${barW}" height="${maxBarH}" fill="#18181b" rx="4" ry="4" />
        <!-- Value Bar -->
        <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="#ffffff" rx="4" ry="4"
          data-date="${escapeHTML(item.name)}"
          data-val="${item.count} réservation(s)"
          data-sub="${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(item.revenue)}"
        />
        <!-- Count badge above bar -->
        <text x="${x + barW / 2}" y="${y - 5}" fill="#ffffff" font-size="10" font-weight="700" font-family="monospace" text-anchor="middle">${item.count}</text>
        <!-- Label below -->
        <text x="${x + barW / 2}" y="${h - 10}" fill="#71717a" font-size="10" font-family="monospace" text-anchor="middle">${escapeHTML(shortName)}</text>
      </g>
    `;
  });

  const svgHtml = `
    <svg class="saas-chart-svg" viewBox="0 0 ${w} ${h}">
      ${barsHtml}
    </svg>
  `;

  containerEl.innerHTML = svgHtml;

  containerEl.querySelectorAll('.barchart-group rect[data-date]').forEach(r => {
    r.addEventListener('mouseenter', (e: any) => {
      const target = e.target as HTMLElement;
      showChartTooltip(e, target.dataset.date || '', target.dataset.val || '', target.dataset.sub || '');
    });
    r.addEventListener('mousemove', (e: any) => {
      const target = e.target as HTMLElement;
      showChartTooltip(e, target.dataset.date || '', target.dataset.val || '', target.dataset.sub || '');
    });
    r.addEventListener('mouseleave', () => {
      hideChartTooltip();
    });
  });
}

export function renderAnalyticsDashboards(allBookings: any[]) {
  const fmtEur = (val: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);

  // Helper to filter by period
  const filterByPeriod = (bookings: any[], period: string) => {
    if (period === 'all') return bookings;
    const now = new Date();
    const days = period === '7d' ? 7 : 30;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return bookings.filter(b => {
      if (!b.created_at) return true;
      return new Date(b.created_at) >= cutoff;
    });
  };

  // 1. CARS STATS
  const rawCarBookings = (allBookings || []).filter(b => b.type === 'vehicule' || !b.type);
  const carBookings = filterByPeriod(rawCarBookings, currentStatsPeriod.cars || 'all');
  const carConfirmed = carBookings.filter(b => b.status === 'confirmed');
  const carPending = carBookings.filter(b => b.status === 'pending');
  const carCancelled = carBookings.filter(b => b.status === 'cancelled');

  let carRevenue = 0;
  carConfirmed.forEach(b => {
    const num = parseInt(String(b.amount || '').replace(/[^0-9]/g, ''), 10);
    if (!isNaN(num)) carRevenue += num;
  });

  const carTotal = carBookings.length;
  const carConversionRate = carTotal > 0 ? Math.round((carConfirmed.length / carTotal) * 100) : 0;
  const carAvgPrice = carConfirmed.length > 0 ? Math.round(carRevenue / carConfirmed.length) : 0;

  // Update Cars KPI DOM
  const cRevEl = document.getElementById("stats-cars-total-revenue");
  const cRevSub = document.getElementById("stats-cars-revenue-sub");
  const cTotEl = document.getElementById("stats-cars-total-bookings");
  const cTotSub = document.getElementById("stats-cars-bookings-sub");
  const cConvEl = document.getElementById("stats-cars-conversion-rate");
  const cAvgEl = document.getElementById("stats-cars-avg-price");

  if (cRevEl) cRevEl.textContent = fmtEur(carRevenue);
  if (cRevSub) cRevSub.textContent = `${carConfirmed.length} validée(s)`;
  if (cTotEl) cTotEl.textContent = String(carTotal);
  if (cTotSub) cTotSub.textContent = `${carPending.length} en cours • ${carCancelled.length} annulée(s)`;
  if (cConvEl) cConvEl.textContent = `${carConversionRate}%`;
  if (cAvgEl) cAvgEl.textContent = fmtEur(carAvgPrice);

  // Group Car Bookings by Day for Timeline Chart
  const carDailyMap: Record<string, { label: string; date: string; revenue: number; count: number }> = {};
  // Prepare last 7 or 14 slots
  const daysCount = currentStatsPeriod.cars === '7d' ? 7 : (currentStatsPeriod.cars === '30d' ? 14 : 10);
  const now = new Date();
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    carDailyMap[key] = { label, date: key, revenue: 0, count: 0 };
  }

  carBookings.forEach(b => {
    const dStr = (b.created_at || new Date().toISOString()).split('T')[0];
    if (!carDailyMap[dStr]) {
      const dObj = new Date(dStr);
      carDailyMap[dStr] = {
        label: !isNaN(dObj.getTime()) ? dObj.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : dStr,
        date: dStr,
        revenue: 0,
        count: 0
      };
    }
    carDailyMap[dStr].count++;
    if (b.status === 'confirmed') {
      const num = parseInt(String(b.amount || '').replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) carDailyMap[dStr].revenue += num;
    }
  });

  const carTimelineData = Object.values(carDailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // Render Cars Timeline Area Chart
  const carTimelineContainer = document.getElementById("stats-cars-timeline-chart");
  if (carTimelineContainer) {
    drawTimelineAreaChart(carTimelineContainer, carTimelineData, (currentStatsMetric.cars as any) || 'revenue');
  }

  // Render Cars Donut Chart
  const carDonutContainer = document.getElementById("stats-cars-donut-chart");
  if (carDonutContainer) {
    drawDonutChart(carDonutContainer, carConfirmed.length, carPending.length, carCancelled.length);
  }

  // Top Cars calculation
  const carCounts: Record<string, { count: number; revenue: number; name: string }> = {};
  carBookings.forEach(b => {
    const name = (b.item_name || 'Supercar').trim();
    if (!carCounts[name]) carCounts[name] = { count: 0, revenue: 0, name };
    carCounts[name].count++;
    if (b.status === 'confirmed') {
      const num = parseInt(String(b.amount || '').replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) carCounts[name].revenue += num;
    }
  });

  const sortedCars = Object.values(carCounts).sort((a, b) => b.count - a.count || b.revenue - a.revenue);

  // Render Cars Demand Bar Chart
  const carBarChartContainer = document.getElementById("stats-cars-barchart");
  if (carBarChartContainer) {
    drawDemandBarChart(carBarChartContainer, sortedCars);
  }

  const topCarsContainer = document.getElementById("stats-cars-top-vehicles-list");
  const carsUniqueCount = document.getElementById("stats-cars-unique-count");
  if (carsUniqueCount) carsUniqueCount.textContent = `${sortedCars.length} modèle(s)`;

  if (topCarsContainer) {
    topCarsContainer.innerHTML = "";
    if (sortedCars.length === 0) {
      topCarsContainer.innerHTML = `<div style="text-align: center; color: #71717a; padding: 24px; font-size: 12.5px;">Aucune donnée de location enregistrée.</div>`;
    } else {
      const maxCount = sortedCars[0]?.count || 1;
      sortedCars.slice(0, 6).forEach((car, index) => {
        const rank = index + 1;
        const rankClass = rank === 1 ? 'rank-1' : (rank === 2 ? 'rank-2' : (rank === 3 ? 'rank-3' : ''));
        const pct = Math.max(10, Math.round((car.count / maxCount) * 100));

        const matchedVehicle = state.allVehicles.find(v => v.name && v.name.toLowerCase() === car.name.toLowerCase());
        const imgUrl = matchedVehicle ? (matchedVehicle.photo_main || (matchedVehicle.photos && matchedVehicle.photos[0]) || 'assets/logo.webp') : 'assets/logo.webp';

        const itemEl = document.createElement("div");
        itemEl.className = "stats-ranking-item";
        itemEl.innerHTML = `
          <span class="stats-rank-num ${rankClass}">${rank < 10 ? '0' + rank : rank}</span>
          <img src="${escapeHTML(imgUrl)}" alt="" class="stats-item-thumb" onerror="this.onerror=null; this.src='assets/logo.webp';" />
          <div class="stats-item-details">
            <div class="stats-item-name-row">
              <span class="stats-item-title">${escapeHTML(car.name)}</span>
              <span class="stats-item-amount">${fmtEur(car.revenue)}</span>
            </div>
            <div class="stats-progress-track">
              <div class="stats-progress-fill" style="width: ${pct}%;"></div>
            </div>
            <div class="stats-item-meta">
              <span><strong>${car.count}</strong> location(s)</span>
              <span>&bull;</span>
              <span>${carTotal > 0 ? Math.round((car.count / carTotal) * 100) : 0}% de la demande</span>
            </div>
          </div>
        `;
        topCarsContainer.appendChild(itemEl);
      });
    }
  }

  // Top Clients Cars
  const carClients: Record<string, { name: string; discordId: string; count: number; spent: number }> = {};
  carBookings.forEach(b => {
    const cName = (b.client_name || 'Client Inconnu').trim();
    if (!carClients[cName]) carClients[cName] = { name: cName, discordId: b.discord_id || '', count: 0, spent: 0 };
    carClients[cName].count++;
    if (b.status === 'confirmed') {
      const num = parseInt(String(b.amount || '').replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) carClients[cName].spent += num;
    }
  });

  const sortedCarClients = Object.values(carClients).sort((a, b) => b.spent - a.spent || b.count - a.count);
  const topCarClientsContainer = document.getElementById("stats-cars-top-clients-list");
  const carClientsCountEl = document.getElementById("stats-cars-clients-count");
  if (carClientsCountEl) carClientsCountEl.textContent = `${sortedCarClients.length} loueur(s)`;

  if (topCarClientsContainer) {
    topCarClientsContainer.innerHTML = "";
    if (sortedCarClients.length === 0) {
      topCarClientsContainer.innerHTML = `<div style="text-align: center; color: #71717a; padding: 20px; font-size: 12px;">Aucun client enregistré.</div>`;
    } else {
      sortedCarClients.slice(0, 4).forEach((client, idx) => {
        const itemEl = document.createElement("div");
        itemEl.className = "stats-ranking-item";
        itemEl.innerHTML = `
          <div class="stats-rank-num ${idx === 0 ? 'rank-1' : ''}">${idx + 1}</div>
          <div class="stats-item-details">
            <div class="stats-item-name-row">
              <span class="stats-item-title">${escapeHTML(client.name)}</span>
              <span class="stats-item-amount">${fmtEur(client.spent)}</span>
            </div>
            <div class="stats-item-meta">
              <span><strong>${client.count}</strong> location(s)</span>
              ${client.discordId ? `<span>&bull; <i class="fa-brands fa-discord"></i> ${escapeHTML(client.discordId)}</span>` : ''}
            </div>
          </div>
        `;
        topCarClientsContainer.appendChild(itemEl);
      });
    }
  }

  // 2. SUITES STATS
  const rawSuiteBookings = (allBookings || []).filter(b => b.type === 'suite');
  const suiteBookings = filterByPeriod(rawSuiteBookings, currentStatsPeriod.suites || 'all');
  const suiteConfirmed = suiteBookings.filter(b => b.status === 'confirmed');
  const suitePending = suiteBookings.filter(b => b.status === 'pending');
  const suiteCancelled = suiteBookings.filter(b => b.status === 'cancelled');

  let suiteRevenue = 0;
  suiteConfirmed.forEach(b => {
    const num = parseInt(String(b.amount || '').replace(/[^0-9]/g, ''), 10);
    if (!isNaN(num)) suiteRevenue += num;
  });

  const suiteTotal = suiteBookings.length;
  const suiteConversionRate = suiteTotal > 0 ? Math.round((suiteConfirmed.length / suiteTotal) * 100) : 0;
  const suiteAvgPrice = suiteConfirmed.length > 0 ? Math.round(suiteRevenue / suiteConfirmed.length) : 0;

  // Update Suites KPI DOM
  const sRevEl = document.getElementById("stats-suites-total-revenue");
  const sRevSub = document.getElementById("stats-suites-revenue-sub");
  const sTotEl = document.getElementById("stats-suites-total-bookings");
  const sTotSub = document.getElementById("stats-suites-bookings-sub");
  const sConvEl = document.getElementById("stats-suites-conversion-rate");
  const sAvgEl = document.getElementById("stats-suites-avg-price");

  if (sRevEl) sRevEl.textContent = fmtEur(suiteRevenue);
  if (sRevSub) sRevSub.textContent = `${suiteConfirmed.length} séjour(s) validé(s)`;
  if (sTotEl) sTotEl.textContent = String(suiteTotal);
  if (sTotSub) sTotSub.textContent = `${suitePending.length} en cours • ${suiteCancelled.length} annulé(s)`;
  if (sConvEl) sConvEl.textContent = `${suiteConversionRate}%`;
  if (sAvgEl) sAvgEl.textContent = fmtEur(suiteAvgPrice);

  // Group Suite Bookings by Day for Timeline Chart
  const suiteDailyMap: Record<string, { label: string; date: string; revenue: number; count: number }> = {};
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    suiteDailyMap[key] = { label, date: key, revenue: 0, count: 0 };
  }

  suiteBookings.forEach(b => {
    const dStr = (b.created_at || new Date().toISOString()).split('T')[0];
    if (!suiteDailyMap[dStr]) {
      const dObj = new Date(dStr);
      suiteDailyMap[dStr] = {
        label: !isNaN(dObj.getTime()) ? dObj.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : dStr,
        date: dStr,
        revenue: 0,
        count: 0
      };
    }
    suiteDailyMap[dStr].count++;
    if (b.status === 'confirmed') {
      const num = parseInt(String(b.amount || '').replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) suiteDailyMap[dStr].revenue += num;
    }
  });

  const suiteTimelineData = Object.values(suiteDailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // Render Suites Timeline Area Chart
  const suiteTimelineContainer = document.getElementById("stats-suites-timeline-chart");
  if (suiteTimelineContainer) {
    drawTimelineAreaChart(suiteTimelineContainer, suiteTimelineData, (currentStatsMetric.suites as any) || 'revenue');
  }

  // Render Suites Donut Chart
  const suiteDonutContainer = document.getElementById("stats-suites-donut-chart");
  if (suiteDonutContainer) {
    drawDonutChart(suiteDonutContainer, suiteConfirmed.length, suitePending.length, suiteCancelled.length);
  }

  // Top Suites calculation
  const suiteCounts: Record<string, { count: number; revenue: number; name: string }> = {};
  suiteBookings.forEach(b => {
    const name = (b.item_name || 'Suite Prestige').trim();
    if (!suiteCounts[name]) suiteCounts[name] = { count: 0, revenue: 0, name };
    suiteCounts[name].count++;
    if (b.status === 'confirmed') {
      const num = parseInt(String(b.amount || '').replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) suiteCounts[name].revenue += num;
    }
  });

  const sortedSuites = Object.values(suiteCounts).sort((a, b) => b.count - a.count || b.revenue - a.revenue);

  // Render Suites Demand Bar Chart
  const suiteBarChartContainer = document.getElementById("stats-suites-barchart");
  if (suiteBarChartContainer) {
    drawDemandBarChart(suiteBarChartContainer, sortedSuites);
  }

  const topSuitesContainer = document.getElementById("stats-suites-top-suites-list");
  const suitesUniqueCount = document.getElementById("stats-suites-unique-count");
  if (suitesUniqueCount) suitesUniqueCount.textContent = `${sortedSuites.length} suite(s)`;

  if (topSuitesContainer) {
    topSuitesContainer.innerHTML = "";
    if (sortedSuites.length === 0) {
      topSuitesContainer.innerHTML = `<div style="text-align: center; color: #71717a; padding: 24px; font-size: 12.5px;">Aucune donnée de réservation hôtelière disponible.</div>`;
    } else {
      const maxCount = sortedSuites[0]?.count || 1;
      sortedSuites.slice(0, 6).forEach((suite, index) => {
        const rank = index + 1;
        const rankClass = rank === 1 ? 'rank-1' : (rank === 2 ? 'rank-2' : (rank === 3 ? 'rank-3' : ''));
        const pct = Math.max(10, Math.round((suite.count / maxCount) * 100));

        const matchedSuite = state.allSuites.find(s => s.name && s.name.toLowerCase() === suite.name.toLowerCase());
        const imgUrl = matchedSuite ? (matchedSuite.photo_main || (matchedSuite.photos && matchedSuite.photos[0]) || 'assets/logo.webp') : 'assets/logo.webp';

        const itemEl = document.createElement("div");
        itemEl.className = "stats-ranking-item";
        itemEl.innerHTML = `
          <span class="stats-rank-num ${rankClass}">${rank < 10 ? '0' + rank : rank}</span>
          <img src="${escapeHTML(imgUrl)}" alt="" class="stats-item-thumb" onerror="this.onerror=null; this.src='assets/logo.webp';" />
          <div class="stats-item-details">
            <div class="stats-item-name-row">
              <span class="stats-item-title">${escapeHTML(suite.name)}</span>
              <span class="stats-item-amount">${fmtEur(suite.revenue)}</span>
            </div>
            <div class="stats-progress-track">
              <div class="stats-progress-fill" style="width: ${pct}%;"></div>
            </div>
            <div class="stats-item-meta">
              <span><strong>${suite.count}</strong> séjour(s)</span>
              <span>&bull;</span>
              <span>${suiteTotal > 0 ? Math.round((suite.count / suiteTotal) * 100) : 0}% des séjours</span>
            </div>
          </div>
        `;
        topSuitesContainer.appendChild(itemEl);
      });
    }
  }

  // Top Clients Suites
  const suiteClients: Record<string, { name: string; discordId: string; count: number; spent: number }> = {};
  suiteBookings.forEach(b => {
    const cName = (b.client_name || 'Résident Inconnu').trim();
    if (!suiteClients[cName]) suiteClients[cName] = { name: cName, discordId: b.discord_id || '', count: 0, spent: 0 };
    suiteClients[cName].count++;
    if (b.status === 'confirmed') {
      const num = parseInt(String(b.amount || '').replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) suiteClients[cName].spent += num;
    }
  });

  const sortedSuiteClients = Object.values(suiteClients).sort((a, b) => b.spent - a.spent || b.count - a.count);
  const topSuiteClientsContainer = document.getElementById("stats-suites-top-clients-list");
  const suiteClientsCountEl = document.getElementById("stats-suites-clients-count");
  if (suiteClientsCountEl) suiteClientsCountEl.textContent = `${sortedSuiteClients.length} résident(s)`;

  if (topSuiteClientsContainer) {
    topSuiteClientsContainer.innerHTML = "";
    if (sortedSuiteClients.length === 0) {
      topSuiteClientsContainer.innerHTML = `<div style="text-align: center; color: #71717a; padding: 20px; font-size: 12px;">Aucun résident enregistré.</div>`;
    } else {
      sortedSuiteClients.slice(0, 4).forEach((client, idx) => {
        const itemEl = document.createElement("div");
        itemEl.className = "stats-ranking-item";
        itemEl.innerHTML = `
          <div class="stats-rank-num ${idx === 0 ? 'rank-1' : ''}">${idx + 1}</div>
          <div class="stats-item-details">
            <div class="stats-item-name-row">
              <span class="stats-item-title">${escapeHTML(client.name)}</span>
              <span class="stats-item-amount">${fmtEur(client.spent)}</span>
            </div>
            <div class="stats-item-meta">
              <span><strong>${client.count}</strong> séjour(s)</span>
              ${client.discordId ? `<span>&bull; <i class="fa-brands fa-discord"></i> ${escapeHTML(client.discordId)}</span>` : ''}
            </div>
          </div>
        `;
        topSuiteClientsContainer.appendChild(itemEl);
      });
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
// ==========================================================================
// Admin Dashboard Tab Switcher & Modal CRUD & Live Search
// ==========================================================================
function switchAdminTab(tabName: string) {
  if (tabName === 'stats-cars') tabName = 'bookings-cars';
  if (tabName === 'stats-suites') tabName = 'bookings-suites';

  const navItems = document.querySelectorAll('.admin-nav-item');
  const tabContents = document.querySelectorAll('.admin-tab-content');

  navItems.forEach((btn) => {
    if ((btn as HTMLElement).dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  tabContents.forEach((tab) => {
    if (tab.id === `tab-${tabName}`) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  if (tabName === 'ctg-database') {
    loadCTGDatabase(1);
  }
  if (tabName === 'users') {
    loadUsers();
  }
  if (tabName === 'concierge') {
    loadConciergeMessages();
  }
  if (tabName === 'tickets-cars') {
    (window as any).loadAdminTickets('vehicule');
  }
  if (tabName === 'tickets-suites') {
    (window as any).loadAdminTickets('suite');
  }
  if (tabName === 'bookings-cars' || tabName === 'bookings-suites' || tabName === 'overview') {
    loadBookings();
    (window as any).loadAdminTickets();
  }
}
(window as any).switchAdminTab = switchAdminTab;

document.querySelectorAll('.admin-nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = (btn as HTMLElement).dataset.tab;
    if (tab) {
      switchAdminTab(tab);
      if (window.location.hash !== '#' + tab) {
        history.pushState(null, '', '#' + tab);
      }
    }
  });
});

// Check initial tab from hash on load
let currentHash = window.location.hash.replace('#', '').split('?')[0];
if (currentHash === 'stats-cars') currentHash = 'bookings-cars';
if (currentHash === 'stats-suites') currentHash = 'bookings-suites';
if (currentHash === 'user-detail') {
  switchAdminTab('users');
} else if (currentHash && document.getElementById(`tab-${currentHash}`)) {
  switchAdminTab(currentHash);
}

modalOverlay = document.getElementById('admin-modal-overlay');
const btnAddVehicleTab = document.getElementById('btn-add-vehicle-tab');
const btnAddSuiteTab = document.getElementById('btn-add-suite-tab');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
adminModalForm = document.getElementById('admin-modal-form');

if (btnAddVehicleTab) {
  btnAddVehicleTab.addEventListener('click', () => {
    openModal();
  });
}

const btnSyncDiscordFleet = document.getElementById('btn-sync-discord-fleet') as HTMLButtonElement | null;
if (btnSyncDiscordFleet) {
  btnSyncDiscordFleet.addEventListener('click', async () => {
    const originalText = btnSyncDiscordFleet.innerHTML;
    btnSyncDiscordFleet.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Synchronisation...`;
    btnSyncDiscordFleet.disabled = true;

    try {
      const resp = await botFetch('/api/sync-fleet-channel', {
        method: 'POST',
        body: JSON.stringify({})
      });
      const data = await resp.json();
      if (data.success) {
        showToast(`Flotte synchronisée (${data.count} véhicules) dans le Forum Discord #flotte-disponible !`, 'success');
      } else {
        showToast(`Erreur Discord : ${data.error || 'Erreur'}`, 'danger');
      }
    } catch (err) {
      console.error('Erreur sync Discord:', err);
    } finally {
      btnSyncDiscordFleet.innerHTML = originalText;
      btnSyncDiscordFleet.disabled = false;
    }
  });
}

const btnSyncDiscordSuites = document.getElementById('btn-sync-discord-suites') as HTMLButtonElement | null;
if (btnSyncDiscordSuites) {
  btnSyncDiscordSuites.addEventListener('click', async () => {
    const originalText = btnSyncDiscordSuites.innerHTML;
    btnSyncDiscordSuites.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Synchronisation...`;
    btnSyncDiscordSuites.disabled = true;

    try {
      const resp = await botFetch('/api/sync-discord-suites', {
        method: 'POST',
        body: JSON.stringify({})
      });
      const data = await resp.json();
      if (data.success) {
        showToast(`Catalogue hôtel synchronisé (${data.count} suites) dans le Forum Discord #reservations-hotel !`, 'success');
      } else {
        showToast(`Erreur Discord : ${data.error || 'Erreur'}`, 'danger');
      }
    } catch (err) {
      console.error('Erreur sync Discord suites:', err);
      showToast('Impossible de joindre le bot Discord.', 'danger');
    } finally {
      btnSyncDiscordSuites.innerHTML = originalText;
      btnSyncDiscordSuites.disabled = false;
    }
  });
}

if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeModal);
if (modalOverlay) {
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
}

// Dedicated Suite / Accommodation Modal Setup
suiteModalOverlay = document.getElementById('suite-modal-overlay');
suiteModalForm = document.getElementById('suite-modal-form');
const suiteModalCloseBtn = document.getElementById('suite-modal-close-btn');
const suiteModalCancelBtn = document.getElementById('suite-modal-cancel-btn');
const suiteUploadFileInput = document.getElementById('suite-image-file') as HTMLInputElement | null;
const suiteUploadTriggerBtn = document.getElementById('suite-upload-trigger-btn') as HTMLButtonElement | null;
suiteUploadPreviewContainer = document.getElementById('suite-upload-preview-container');
suiteUploadPreviewGrid = document.getElementById('suite-upload-preview-grid');
suiteUploadFileCount = document.getElementById('suite-upload-file-count');
const suiteUploadClearBtn = document.getElementById('suite-upload-clear-btn');

if (suiteUploadTriggerBtn && suiteUploadFileInput) {
  suiteUploadTriggerBtn.onclick = () => suiteUploadFileInput.click();
  suiteUploadFileInput.onchange = async (e) => {
    const files = Array.from((e.target as HTMLInputElement).files!);
    if (files.length === 0) return;
    suiteUploadTriggerBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Compression (${files.length} photos)...`;
    suiteUploadTriggerBtn.disabled = true;
    for (const file of files) {
      try {
        const compressedBase64 = await compressImage(file, 1000, 1000, 0.7);
        state.uploadedSuiteImagesArray.push(compressedBase64);
      } catch (err) {
        console.error("Compression error:", err);
      }
    }
    renderSuiteUploadPreviews();
    suiteUploadTriggerBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Choisir une ou plusieurs photos`;
    suiteUploadTriggerBtn.disabled = false;
    suiteUploadFileInput.value = "";
  };
}

if (suiteUploadClearBtn) {
  suiteUploadClearBtn.onclick = () => {
    state.uploadedSuiteImagesArray = [];
    renderSuiteUploadPreviews();
  };
}

function openSuiteModal(editData = null) {
  if (suiteModalOverlay) {
    if (editData) {
      (document.getElementById('suite-modal-title') as HTMLElement).innerHTML = '<i class="fa-solid fa-pen-to-square" style="color: #c5a880; margin-right: 8px;"></i> Modifier l\'Hébergement';
      (suiteModalForm as HTMLElement).dataset.editId = editData.id;
      (document.getElementById('suite-category') as HTMLInputElement).value = editData.category || 'suite';
      (document.getElementById('suite-name') as HTMLInputElement).value = editData.name || '';
      (document.getElementById('suite-room-number') as HTMLInputElement).value = editData.room_number || '';
      (document.getElementById('suite-access-code') as HTMLInputElement).value = editData.access_code || '';
      (document.getElementById('suite-floor') as HTMLInputElement).value = editData.floor || '';
      (document.getElementById('suite-status') as HTMLInputElement).value = editData.status || 'confirmed';
      (document.getElementById('suite-price') as HTMLInputElement).value = editData.price || '';
      (document.getElementById('suite-specs') as HTMLInputElement).value = editData.specs || '';
      (document.getElementById('suite-media-url') as HTMLInputElement).value = editData.media_urls || '';

      state.uploadedSuiteImagesArray = [];
      if (editData.media_urls) {
        if (editData.media_urls.startsWith("[")) {
          try {
            const parsed = JSON.parse(editData.media_urls);
            if (Array.isArray(parsed)) state.uploadedSuiteImagesArray = parsed.filter(Boolean);
          } catch (e) {
            state.uploadedSuiteImagesArray = [editData.media_urls];
          }
        } else if (editData.media_urls.includes(",")) {
          state.uploadedSuiteImagesArray = editData.media_urls.split(",").map(s => s.trim()).filter(Boolean);
        } else if (editData.media_urls.trim()) {
          state.uploadedSuiteImagesArray = [editData.media_urls.trim()];
        }
      }
      renderSuiteUploadPreviews();
    } else {
      (document.getElementById('suite-modal-title') as HTMLElement).innerHTML = '<i class="fa-solid fa-hotel" style="color: #c5a880; margin-right: 8px;"></i> Nouvel Hébergement / Résidence';
      if (suiteModalForm) {
        delete suiteModalForm.dataset.editId;
        (suiteModalForm as HTMLFormElement).reset();
      }
      state.uploadedSuiteImagesArray = [];
      renderSuiteUploadPreviews();
    }
    suiteModalOverlay.classList.add('active');
    suiteModalOverlay.removeAttribute('aria-hidden');
  }
}

if (suiteModalCloseBtn) suiteModalCloseBtn.onclick = closeSuiteModal;
if (suiteModalCancelBtn) suiteModalCancelBtn.onclick = closeSuiteModal;
if (suiteModalOverlay) {
  suiteModalOverlay.onclick = (e) => {
    if (e.target === suiteModalOverlay) closeSuiteModal();
  };
}

if (btnAddSuiteTab) {
  btnAddSuiteTab.onclick = () => openSuiteModal();
}

// User Profile Modal Handlers
userModalOverlay = document.getElementById('user-modal-overlay');
const userModalCloseBtn = document.getElementById('user-modal-close-btn');
const userModalCloseBottomBtn = document.getElementById('user-modal-close-bottom-btn');

if (userModalCloseBtn) userModalCloseBtn.addEventListener('click', () => closeUserModal(true));
if (userModalCloseBottomBtn) userModalCloseBottomBtn.addEventListener('click', () => closeUserModal(true));
if (userModalOverlay) {
  userModalOverlay.addEventListener('click', (e) => {
    if (e.target === userModalOverlay) closeUserModal(true);
  });
}

// Global Escape listener for modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modalOverlay && modalOverlay.classList.contains('active')) closeModal();
    if (suiteModalOverlay && suiteModalOverlay.classList.contains('active')) closeSuiteModal();
    const ctgModal = document.getElementById('ctg-modal-overlay');
    if (ctgModal && ctgModal.classList.contains('active')) {
      ctgModal.classList.remove('active');
      ctgModal.setAttribute('aria-hidden', 'true');
    }
    if (userModalOverlay && userModalOverlay.classList.contains('active')) {
      closeUserModal();
    }
    const confirmModal = document.getElementById('confirm-modal-overlay');
    if (confirmModal && confirmModal.classList.contains('active')) {
      const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
      if (cancelBtn) cancelBtn.click();
    }
  }
});

const modalPriceAutoFields = document.getElementById("price-auto-fields");
const modalPriceModeRadios = document.querySelectorAll("input[name='price-mode']") as NodeListOf<HTMLInputElement>;
const modalPriceInput = document.getElementById("item-price") as HTMLInputElement | null;

modalPriceModeRadios.forEach(radio => {
  radio.addEventListener("change", () => {
    if (radio.value === "auto") {
      if (modalPriceAutoFields) modalPriceAutoFields.style.display = "flex";
      if (modalPriceInput) {
        modalPriceInput.disabled = true;
        modalPriceInput.placeholder = "Calculé automatiquement";
      }
      updateCalculatedPrice();
    } else {
      if (modalPriceAutoFields) modalPriceAutoFields.style.display = "none";
      if (modalPriceInput) {
        modalPriceInput.disabled = false;
        modalPriceInput.placeholder = "ex: 3,500 € / j";
      }
    }
  });
});

const modalDealerPriceInput = document.getElementById("item-dealer-price");
const modalRentalPercentInput = document.getElementById("item-rental-percent");
if (modalDealerPriceInput) modalDealerPriceInput.addEventListener("input", updateCalculatedPrice);
if (modalRentalPercentInput) modalRentalPercentInput.addEventListener("input", updateCalculatedPrice);

// Client-side Image Compression Utility
function compressImage(file, maxWidth, maxHeight, quality) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = (event.target as FileReader).result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0, width, height);

        // Export as compressed JPEG base64
        const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
        resolve(compressedBase64);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// File Upload Bindings & Events
const fileInput = document.getElementById("item-image-file") as HTMLInputElement | null;
const triggerBtn = document.getElementById("upload-trigger-btn") as HTMLButtonElement | null;
previewContainer = document.getElementById("upload-preview-container");
previewGrid = document.getElementById("upload-preview-grid");
fileCountSpan = document.getElementById("upload-file-count");
const clearBtn = document.getElementById("upload-clear-btn");
mediaUrlInput = document.getElementById("item-media-url") as HTMLInputElement | null;

if (triggerBtn && fileInput) {
  triggerBtn.addEventListener("click", () => fileInput.click());
}

if (fileInput) {
  fileInput.addEventListener("change", async (e) => {
    const files = Array.from((e.target as HTMLInputElement).files!);
    if (files.length === 0) return;

    (triggerBtn as HTMLButtonElement).innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Compression (${files.length} fichiers)...`;
    (triggerBtn as HTMLButtonElement).disabled = true;

    for (const file of files) {
      try {
        const compressedBase64 = await compressImage(file, 1000, 1000, 0.7);
        state.uploadedImagesArray.push(compressedBase64);
      } catch (err) {
        console.error("Compression error:", err);
      }
    }

    renderUploadPreviews();

    (triggerBtn as HTMLButtonElement).innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Choisir un ou plusieurs fichiers images`;
    (triggerBtn as HTMLButtonElement).disabled = false;
    fileInput.value = "";
  });
}

if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    state.uploadedImagesArray = [];
    renderUploadPreviews();
  });
}

// URL Add bindings
const toggleUrlBtn = document.getElementById("upload-toggle-url-btn");
const urlContainer = document.getElementById("upload-url-input-container");
const urlInput = document.getElementById("item-media-url-input") as HTMLInputElement | null;
const confirmAddUrlBtn = document.getElementById("btn-confirm-add-url");

if (toggleUrlBtn && urlContainer) {
  toggleUrlBtn.addEventListener("click", () => {
    const isHidden = urlContainer.style.display === "none" || !urlContainer.style.display;
    urlContainer.style.display = isHidden ? "flex" : "none";
    if (isHidden && urlInput) urlInput.focus();
  });
}

function handleAddUrl() {
  if (!urlInput) return;
  const val = urlInput.value.trim();
  if (!val) return;

  if (val.includes(",")) {
    const splitUrls = val.split(",").map(u => u.trim()).filter(Boolean);
    state.uploadedImagesArray.push(...splitUrls);
  } else {
    state.uploadedImagesArray.push(val);
  }

  urlInput.value = "";
  if (urlContainer) urlContainer.style.display = "none";
  renderUploadPreviews();
}

if (confirmAddUrlBtn) confirmAddUrlBtn.addEventListener("click", handleAddUrl);
if (urlInput) {
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddUrl();
    }
  });
}

// Glissement fluide carrousel cartes véhicules
(window as any).slideVehicleCardCarousel = function (itemId: string, direction: number) {
  const container = document.getElementById(`vehicle-slideshow-${itemId}`);
  if (!container) return;
  const slideWidth = container.clientWidth || container.offsetWidth || 260;
  const maxScroll = container.scrollWidth - slideWidth;
  let newScroll = container.scrollLeft + direction * slideWidth;

  if (direction > 0 && container.scrollLeft >= maxScroll - 5) {
    newScroll = 0;
  } else if (direction < 0 && container.scrollLeft <= 5) {
    newScroll = maxScroll;
  }

  container.scrollTo({ left: newScroll, behavior: 'smooth' });

  const dotsContainer = document.getElementById(`vehicle-dots-${itemId}`);
  if (dotsContainer) {
    const dots = dotsContainer.querySelectorAll('.vehicle-carousel-dot');
    const activeIndex = Math.round(newScroll / (slideWidth || 1)) % dots.length;
    dots.forEach((dot, idx) => {
      (dot as HTMLElement).style.background = idx === activeIndex ? '#ffffff' : 'rgba(255,255,255,0.4)';
    });
  }
};

// Glissement fluide carrousel cartes suites
(window as any).slideSuiteCardCarousel = function (itemId: string, direction: number) {
  const container = document.getElementById(`suite-slideshow-${itemId}`);
  if (!container) return;
  const slideWidth = container.clientWidth || container.offsetWidth || 260;
  const maxScroll = container.scrollWidth - slideWidth;
  let newScroll = container.scrollLeft + direction * slideWidth;

  if (direction > 0 && container.scrollLeft >= maxScroll - 5) {
    newScroll = 0;
  } else if (direction < 0 && container.scrollLeft <= 5) {
    newScroll = maxScroll;
  }

  container.scrollTo({ left: newScroll, behavior: 'smooth' });

  const dotsContainer = document.getElementById(`suite-dots-${itemId}`);
  if (dotsContainer) {
    const dots = dotsContainer.querySelectorAll('.suite-carousel-dot');
    const activeIndex = Math.round(newScroll / (slideWidth || 1)) % dots.length;
    dots.forEach((dot, idx) => {
      (dot as HTMLElement).style.background = idx === activeIndex ? '#ffffff' : 'rgba(255,255,255,0.4)';
    });
  }
};

(window as any).openEditSuiteModal = function(suiteDataOrId) {
  let target = suiteDataOrId;
  if (typeof suiteDataOrId === 'string') {
    target = state.allSuites.find(s => s.id === suiteDataOrId);
  }
  if (target) openSuiteModal(target);
};

(window as any).updateContactMessageStatus = async function(id, status) {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("contact_messages").update({ status }).eq("id", id);
  if (error) {
    showToast("Erreur : " + error.message, 'danger');
    return;
  }
  showToast(`Demande de conciergerie marquée : ${status === 'confirmed' ? 'Traitée' : 'Annulée'}`, 'success');
  loadConciergeMessages();
};

(window as any).deleteContactMessage = async function(id) {
  const confirmed = await (window as any).showConfirmDialog({
    title: "Supprimer la Demande",
    message: "Voulez-vous vraiment supprimer définitivement ce message de conciergerie ?",
    confirmText: "Supprimer",
    cancelText: "Annuler",
    icon: "fa-solid fa-trash",
    isDanger: true
  });
  if (!confirmed) return;

  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("contact_messages").delete().eq("id", id);
  if (error) {
    showToast("Erreur : " + error.message, 'danger');
    return;
  }
  showToast("Demande supprimée avec succès.", 'success');
  loadConciergeMessages();
};

  // ---- Affectations window (compat handlers HTML onclick="window.xxx(...)") ----
  (window as any).showToast = showToast;
  (window as any).openModal = openModal;
  (window as any).closeModal = closeModal;
  (window as any).closeSuiteModal = closeSuiteModal;
  (window as any).closeUserModal = closeUserModal;
  (window as any).updateCalculatedPrice = updateCalculatedPrice;
  (window as any).applyFleetFilters = applyFleetFilters;
  (window as any).applySuitesFilters = applySuitesFilters;
  (window as any).writeLog = writeLog;
  (window as any).loadVehicles = loadVehicles;
  (window as any).loadSuites = loadSuites;
  (window as any).loadBookings = loadBookings;
  (window as any).loadLogs = loadLogs;
  (window as any).loadConciergeMessages = loadConciergeMessages;
});
