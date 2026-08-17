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

function renderUploadPreviews() {
  if (!previewGrid || !previewContainer) return;
  previewGrid.innerHTML = "";

  if (state.uploadedImagesArray.length === 0) {
    previewContainer.style.display = "none";
    if (mediaUrlInput) {
      mediaUrlInput.disabled = false;
      mediaUrlInput.placeholder = "ex: Lien youtube, image, .mp4";
    }
    return;
  }

  previewContainer.style.display = "flex";
  if (mediaUrlInput) {
    mediaUrlInput.value = "";
    mediaUrlInput.placeholder = "Image(s) chargée(s) depuis des fichiers";
    mediaUrlInput.disabled = true;
  }

  if (fileCountSpan) {
    fileCountSpan.textContent = `${state.uploadedImagesArray.length} image(s) sélectionnée(s)`;
  }

  state.uploadedImagesArray.forEach((base64, index) => {
    const thumb = document.createElement("div");
    thumb.style.position = "relative";
    thumb.style.width = "52px";
    thumb.style.height = "52px";

    const img = document.createElement("img");
    img.src = base64;
    img.title = "Cliquez pour agrandir";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.borderRadius = "8px";
    img.style.border = "1px solid rgba(255,255,255,0.15)";
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () => openAdminImagePreview(base64));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.innerHTML = "&times;";
    removeBtn.style.position = "absolute";
    removeBtn.style.top = "-5px";
    removeBtn.style.right = "-5px";
    removeBtn.style.width = "18px";
    removeBtn.style.height = "18px";
    removeBtn.style.borderRadius = "50%";
    removeBtn.style.background = "#ef4444";
    removeBtn.style.color = "#ffffff";
    removeBtn.style.border = "none";
    removeBtn.style.fontSize = "12px";
    removeBtn.style.fontWeight = "bold";
    removeBtn.style.cursor = "pointer";
    removeBtn.style.display = "flex";
    removeBtn.style.alignItems = "center";
    removeBtn.style.justifyContent = "center";
    removeBtn.style.boxShadow = "0 2px 4px rgba(0,0,0,0.5)";

    removeBtn.addEventListener("click", () => {
      state.uploadedImagesArray.splice(index, 1);
      renderUploadPreviews();
    });

    thumb.appendChild(img);
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
                    <div class="vehicle-slideshow" style="display: flex; overflow-x: auto; scroll-snap-type: x mandatory; width: 100%; height: 100%; scrollbar-width: none;">
                      ${slidesHtml}
                    </div>
                    <div style="position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; background: rgba(0,0,0,0.55); padding: 4px 8px; border-radius: 99px; z-index: 2; pointer-events: none; backdrop-filter: blur(4px);">
                      ${mediaArray.map((_, i) => `<span style="width: 5px; height: 5px; border-radius: 50%; background: ${i === 0 ? '#ffffff' : 'rgba(255,255,255,0.4)'};"></span>`).join('')}
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
            <span class="type-tag" style="background: ${classStyle.bg}; border: ${classStyle.border}; color: ${classStyle.color}; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 10px; border-radius: 20px; box-shadow: ${classStyle.shadow};">${displayClass}</span>
          </div>
          <span class="card-price">${escapeHTML(item.price)}</span>
        </div>
        <h3 style="margin-top: 6px; margin-bottom: 4px; font-size: 16px; font-weight: 700; color: #ffffff;">${escapeHTML(item.name)}</h3>
        <div style="display: flex; align-items: center; margin-bottom: 10px;">
          <span style="font-size: 12px; color: #a1a1aa;">Plaque : <strong style="font-size: 12.5px; font-family: monospace; font-weight: 700; color: #ffffff; background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14); letter-spacing: 0.04em;">${displayPlate}</strong></span>
        </div>
        <p class="card-sub" style="margin-bottom: 12px; min-height: 18px;">${displaySpecs}</p>
        ${renterInfoHtml}
        <div class="admin-card-actions">
          ${toggleButton}
          <button class="admin-btn-secondary" onclick="window.editFleetItem('${item.id}')"><i class="fa-solid fa-pen"></i> Modifier</button>
          <button class="admin-btn-danger" onclick="window.deleteItem('${item.id}', 'fleet')"><i class="fa-solid fa-ban"></i> Supprimer</button>
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
          <span class="fleet-name">${item.name}</span>
          <span class="fleet-plate">${displayPlate}</span>
        </div>
        <span class="status-badge ${statusClass}">${statusText}</span>
      `;
      overviewFleetList.appendChild(div);
    });
  }

  updateKPIs();
}

export async function loadSuites() {
  const container = document.getElementById("suites-admin-list");
  if (!container || !supabaseClient) return;
  // access_code n'est plus lisible en SELECT direct (grant SQL par colonne) : RPC staff dédiée
  const { data, error } = await supabaseClient.from("suites")
    .select("id,name,price,specs,status,created_at,room_number,category,floor,media_urls")
    .order("created_at", { ascending: false });
  if (error) return console.error("Error loading suites:", error.message);

  state.allSuites = data || [];

  // Digicodes : réservés au staff (get_suite_access_codes renvoie vide pour les non-admins)
  const { data: accessCodes, error: codesError } = await supabaseClient.rpc("get_suite_access_codes");
  if (codesError) console.warn("Chargement des digicodes impossible :", codesError.message);
  if (Array.isArray(accessCodes)) {
    const codeMap = new Map(accessCodes.map(c => [c.suite_id, c.access_code]));
    state.allSuites.forEach(s => { s.access_code = codeMap.get(s.id) || null; });
  }
  container.innerHTML = "";
  if (state.allSuites.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #8e8e8e; padding: 40px 0; font-family: var(--font-sans);">Aucun hébergement enregistré pour le moment.</div>`;
    return;
  }

  state.allSuites.forEach(item => {
    const card = document.createElement("div");
    card.className = "admin-card-item";

    const toggleButton = item.status === 'confirmed'
      ? `<button class="admin-btn-secondary" onclick="window.updateItemStatus('${item.id}', 'suites', 'rented')"><i class="fa-solid fa-bed"></i> Occuper</button>`
      : `<button class="admin-btn-primary" onclick="window.updateItemStatus('${item.id}', 'suites', 'confirmed')"><i class="fa-solid fa-check"></i> Libérer</button>`;

    const catLabels = {
      suite: { label: '🏨 Suite', style: 'background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);' },
      appartement: { label: '🏢 Appartement', style: 'background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);' },
      chambre: { label: '🛏️ Chambre', style: 'background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);' },
      penthouse: { label: '🌆 Penthouse', style: 'background: rgba(197, 168, 128, 0.15); color: #c5a880; border: 1px solid rgba(197, 168, 128, 0.3);' },
      villa: { label: '🏡 Villa Privée', style: 'background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);' },
      loft: { label: '🛖 Loft Prestige', style: 'background: rgba(236, 72, 153, 0.15); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.3);' }
    };
    const catInfo = catLabels[item.category] || catLabels.suite;

    const roomBadge = item.room_number ? `<span style="font-family: monospace; font-size: 11.5px; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); color: #fff; font-weight: 600;">🚪 ${escapeHTML(item.room_number)}</span>` : '';
    const codeBadge = item.access_code ? `<span style="font-family: monospace; font-size: 11.5px; background: rgba(56, 189, 248, 0.12); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; font-weight: 600;" title="Code d'accès / Digicode">🔑 ${escapeHTML(item.access_code)}</span>` : '';
    const floorInfo = item.floor ? `<div style="font-size: 11.5px; color: #a1a1aa; margin-top: 2px;"><i class="fa-solid fa-layer-group" style="margin-right: 4px; color: #c5a880;"></i> ${escapeHTML(item.floor)}</div>` : '';

    let mediaHtml = '';
    if (item.media_urls) {
      let firstImg = item.media_urls;
      if (item.media_urls.startsWith("[")) {
        try { firstImg = JSON.parse(item.media_urls)[0] || ''; } catch (e) { console.warn('[Richman] JSON parse:', e.message); }
      }
      if (firstImg) {
        const safeImgUrl = escapeHTML(sanitizeUrl(firstImg, 'assets/hotel/01_facade_jour.jpg'));
        mediaHtml = `<div style="width: 100%; height: 130px; border-radius: 12px; overflow: hidden; margin-bottom: 12px; background: #000; border: 1px solid rgba(255,255,255,0.08);"><img src="${safeImgUrl}" alt="" style="width: 100%; height: 100%; object-fit: cover;" /></div>`;
      }
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
          <div class="active-rental-card-info" style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 12px; padding: 10px 12px; margin: 8px 0; display: flex; flex-direction: column; gap: 4px;">
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
      <div class="admin-card-header" style="flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <span class="type-tag" style="${catInfo.style}">${catInfo.label}</span>
          ${roomBadge}
          ${codeBadge}
        </div>
        <span class="card-price">${escapeHTML(item.price)}</span>
      </div>
      <h3 style="margin-top: 8px;">${escapeHTML(item.name)}</h3>
      ${floorInfo}
      <p class="card-sub" style="margin-top: 6px;">${escapeHTML(item.specs || "")}</p>
      <div style="margin: 8px 0;">
        <span class="status-pill ${item.status}">${item.status === 'confirmed' ? 'Disponible' : item.status === 'rented' ? 'Occupé / En location' : 'En attente'}</span>
      </div>
      ${renterInfoHtml}
      <div class="admin-card-actions">
        ${toggleButton}
        <button class="admin-btn-secondary" style="flex: none; width: 38px; padding: 0;" onclick="window.openEditSuiteModal('${item.id}')" title="Modifier cet hébergement"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="admin-btn-danger" style="flex: none; width: 38px; padding: 0;" onclick="window.deleteItem('${item.id}', 'suites')" title="Supprimer"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;
    container.appendChild(card);
  });

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
  const carsContainer = document.getElementById("bookings-cars-table-body");
  const suitesContainer = document.getElementById("bookings-suites-table-body");
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient.from("bookings").select("*").order("created_at", { ascending: false });
  if (error) return console.error("Error loading bookings:", error.message);
  state.allBookingsList = data || [];
  if (document.getElementById("fleet-admin-list") && state.allVehicles.length > 0) {
    applyFleetFilters();
  }

  if (carsContainer) {
    carsContainer.innerHTML = "";
    const carBookings = data.filter(item => item.type === 'vehicule');
    if (carBookings.length === 0) {
      carsContainer.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #71717a; padding: 24px; font-size: 12.5px;">Aucune réservation de véhicule enregistrée.</td></tr>`;
    } else {
      carBookings.forEach(item => {
        const tr = document.createElement("tr");
        const discordId = item.discord_id || '';
        const encId = safeJsArg(item.id);
        const encClient = safeJsArg(item.client_name);
        const encItem = safeJsArg(item.item_name);
        const encDiscord = safeJsArg(discordId);

        const dmBtn = discordId ? `
          <button class="user-act-btn-clean" onclick="window.openBookingDMModal(decodeURIComponent('${encDiscord}'), decodeURIComponent('${encClient}'), decodeURIComponent('${encItem}'))" title="MP Discord">
            <i class="fa-brands fa-discord"></i>
          </button>
        ` : '';
        const chatBtn = `
          <button class="user-act-btn-clean" onclick="window.openAdminChatModal(decodeURIComponent('${encId}'), decodeURIComponent('${encClient}'), decodeURIComponent('${encItem}'), decodeURIComponent('${encDiscord}'))" title="Discussion">
            <i class="fa-solid fa-comments"></i>
          </button>
        `;
        tr.innerHTML = `
          <td style="font-family: monospace; font-size: 11.5px; color: #a1a1aa;">#RES-${escapeHTML((item.id || '').slice(0,4).toUpperCase())}</td>
          <td>
            <strong style="color: #ffffff; font-size: 13px;">${escapeHTML(item.client_name)}</strong>
            ${discordId ? `<span style="display: block; font-size: 11px; color: #71717a; margin-top: 1px;"><i class="fa-brands fa-discord"></i> ${escapeHTML(discordId)}</span>` : ''}
          </td>
          <td style="color: #ffffff; font-size: 13px;">${escapeHTML(item.item_name)}</td>
          <td style="font-weight: 600; color: #ffffff; font-size: 13px;">${escapeHTML(item.amount)}</td>
          <td><span class="status-pill ${escapeHTML(item.status)}">${item.status === 'confirmed' ? 'Validé' : item.status === 'cancelled' ? 'Annulé' : 'En attente'}</span></td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 4px; justify-content: flex-end; align-items: center;">
              <button class="user-act-btn-clean" onclick="window.updateBookingStatus(decodeURIComponent('${encId}'), 'confirmed')" title="Valider"><i class="fa-solid fa-check" style="color: #34d399;"></i></button>
              <button class="user-act-btn-clean danger" onclick="window.updateBookingStatus(decodeURIComponent('${encId}'), 'cancelled')" title="Refuser"><i class="fa-solid fa-xmark"></i></button>
              ${chatBtn}
              ${dmBtn}
            </div>
          </td>
        `;
        carsContainer.appendChild(tr);
      });
    }
  }

  if (suitesContainer) {
    suitesContainer.innerHTML = "";
    const suiteBookings = data.filter(item => item.type !== 'vehicule');
    if (suiteBookings.length === 0) {
      suitesContainer.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #71717a; padding: 24px; font-size: 12.5px;">Aucune réservation de suite enregistrée.</td></tr>`;
    } else {
      suiteBookings.forEach(item => {
        const tr = document.createElement("tr");
        const discordId = item.discord_id || '';
        const encId = safeJsArg(item.id);
        const encClient = safeJsArg(item.client_name);
        const encItem = safeJsArg(item.item_name);
        const encDiscord = safeJsArg(discordId);

        const dmBtn = discordId ? `
          <button class="user-act-btn-clean" onclick="window.openBookingDMModal(decodeURIComponent('${encDiscord}'), decodeURIComponent('${encClient}'), decodeURIComponent('${encItem}'))" title="MP Discord">
            <i class="fa-brands fa-discord"></i>
          </button>
        ` : '';
        const chatBtn = `
          <button class="user-act-btn-clean" onclick="window.openAdminChatModal(decodeURIComponent('${encId}'), decodeURIComponent('${encClient}'), decodeURIComponent('${encItem}'), decodeURIComponent('${encDiscord}'))" title="Discussion">
            <i class="fa-solid fa-comments"></i>
          </button>
        `;
        tr.innerHTML = `
          <td style="font-family: monospace; font-size: 11.5px; color: #a1a1aa;">#RES-${escapeHTML((item.id || '').slice(0,4).toUpperCase())}</td>
          <td>
            <strong style="color: #ffffff; font-size: 13px;">${escapeHTML(item.client_name)}</strong>
            ${discordId ? `<span style="display: block; font-size: 11px; color: #71717a; margin-top: 1px;"><i class="fa-brands fa-discord"></i> ${escapeHTML(discordId)}</span>` : ''}
          </td>
          <td style="color: #ffffff; font-size: 13px;">${escapeHTML(item.item_name)}</td>
          <td style="font-weight: 600; color: #ffffff; font-size: 13px;">${escapeHTML(item.amount)}</td>
          <td><span class="status-pill ${escapeHTML(item.status)}">${item.status === 'confirmed' ? 'Validé' : item.status === 'cancelled' ? 'Annulé' : 'En attente'}</span></td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 4px; justify-content: flex-end; align-items: center;">
              <button class="user-act-btn-clean" onclick="window.updateBookingStatus(decodeURIComponent('${encId}'), 'confirmed')" title="Valider"><i class="fa-solid fa-check" style="color: #34d399;"></i></button>
              <button class="user-act-btn-clean danger" onclick="window.updateBookingStatus(decodeURIComponent('${encId}'), 'cancelled')" title="Refuser"><i class="fa-solid fa-xmark"></i></button>
              ${chatBtn}
              ${dmBtn}
            </div>
          </td>
        `;
        suitesContainer.appendChild(tr);
      });
    }
  }

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

document.addEventListener("DOMContentLoaded", () => {
// ==========================================================================
// Admin Dashboard Tab Switcher & Modal CRUD & Live Search
// ==========================================================================
function switchAdminTab(tabName) {
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
const currentHash = window.location.hash.replace('#', '').split('?')[0];
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
  (window as any).writeLog = writeLog;
  (window as any).loadVehicles = loadVehicles;
  (window as any).loadSuites = loadSuites;
  (window as any).loadBookings = loadBookings;
  (window as any).loadLogs = loadLogs;
  (window as any).loadConciergeMessages = loadConciergeMessages;
});
