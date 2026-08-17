/* ==========================================================================
   Richman Estate — 08-media-carousel.ts
   Carrousels média & visionneuse plein écran (lightbox)
   Porté de main.js (08-media-carousel.js) — ES module + TypeScript.
   ========================================================================== */

import { escapeHTML } from "../core/sanitize";
import { state } from "../core/state";
import { formatLuxuryCarName } from "../core/vehicles";

// ==========================================================================
// LUXURY MEDIA HELPER, CARD CAROUSEL & FULLSCREEN LIGHTBOX ENGINE
// ==========================================================================

export function extractItemMediaArray(item: any, type = 'suite') {
  const list: any[] = [];
  if (!item) return list;

  let raw: any = "";
  if (type === 'suite' || item.category) {
    raw = item.media_urls || "";
  } else {
    // Vehicule
    try {
      if (item.specs && item.specs.startsWith("{")) {
        const meta = JSON.parse(item.specs);
        raw = meta.media_url || "";
      }
    } catch (e) { console.warn('[Richman]', e); }
  }

  if (raw) {
    if (typeof raw === 'string' && raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((p: any) => {
            if (p && typeof p === 'string' && p.trim()) list.push(p.trim());
          });
        }
      } catch (e) { console.warn('[Richman]', e); }
    } else if (typeof raw === 'string' && (raw.startsWith('data:image') || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/9j/'))) {
      list.push(raw.trim());
    } else if (typeof raw === 'string' && raw.includes(",")) {
      raw.split(",").forEach((p: string) => {
        if (p && p.trim()) list.push(p.trim());
      });
    } else if (typeof raw === 'string' && raw.trim()) {
      list.push(raw.trim());
    } else if (Array.isArray(raw)) {
      raw.forEach((p: any) => {
        if (p && typeof p === 'string' && p.trim()) list.push(p.trim());
      });
    }
  }

  if (list.length === 0) {
    if (type === 'vehicule' || (!item.category && item.name)) {
      list.push(`https://api.staff.gta.ctgaming.fr:2096/uploads/vehicle-screenshots/${encodeURIComponent((item.name || '').toLowerCase().trim())}.webp`);
    } else {
      list.push('https://ghbeopdnfdxuqfjzmmeb.supabase.co/storage/v1/object/public/public_assets/logo.webp');
    }
  }

  return list;
}

document.addEventListener("DOMContentLoaded", () => {
  // Active slide tracker per card { [itemId]: activeIndex } → state.cardActiveSlideMap

  (window as any).slideCardCarousel = function (itemId: any, direction: any) {
    const slider = document.getElementById(`carousel-${itemId}`);
    if (!slider) return;
    const slides = slider.querySelectorAll('.card-slide-img');
    if (slides.length <= 1) return;

    let curIndex = state.cardActiveSlideMap.get(itemId) || 0;
    slides[curIndex].classList.remove('active');

    curIndex = (curIndex + direction + slides.length) % slides.length;
    state.cardActiveSlideMap.set(itemId, curIndex);
    slides[curIndex].classList.add('active');

    // Update dots
    const dotsContainer = document.getElementById(`dots-${itemId}`);
    if (dotsContainer) {
      const dots = dotsContainer.querySelectorAll('.carousel-dot');
      dots.forEach((d, i) => d.classList.toggle('active', i === curIndex));
    }

    // Update counter
    const counterEl = document.getElementById(`counter-${itemId}`);
    if (counterEl) {
      counterEl.textContent = `${curIndex + 1} / ${slides.length}`;
    }
  };

  (window as any).goToCardSlide = function (itemId: any, index: any) {
    const slider = document.getElementById(`carousel-${itemId}`);
    if (!slider) return;
    const slides = slider.querySelectorAll('.card-slide-img');
    if (slides.length <= 1 || index < 0 || index >= slides.length) return;

    const curIndex = state.cardActiveSlideMap.get(itemId) || 0;
    slides[curIndex].classList.remove('active');

    state.cardActiveSlideMap.set(itemId, index);
    slides[index].classList.add('active');

    // Update dots
    const dotsContainer = document.getElementById(`dots-${itemId}`);
    if (dotsContainer) {
      const dots = dotsContainer.querySelectorAll('.carousel-dot');
      dots.forEach((d, i) => d.classList.toggle('active', i === index));
    }

    // Update counter
    const counterEl = document.getElementById(`counter-${itemId}`);
    if (counterEl) {
      counterEl.textContent = `${index + 1} / ${slides.length}`;
    }
  };

  // --------------------------------------------------------------------------
  // FULLSCREEN LIGHTBOX GALLERY MODAL
  // --------------------------------------------------------------------------
  let currentLightboxData: any = null;

  function ensureLightboxModalDOM(): HTMLElement {
    let lb = document.getElementById("richman-lightbox-modal");
    if (lb) return lb;

    lb = document.createElement("div");
    lb.id = "richman-lightbox-modal";
    lb.className = "richman-lightbox";
    lb.setAttribute("aria-hidden", "true");
    lb.innerHTML = `
      <div class="lightbox-backdrop" onclick="window.closeRichmanLightbox()"></div>
      <div class="lightbox-container" role="dialog" aria-modal="true">
        <div class="lightbox-header">
          <div class="lightbox-title-wrap">
            <span class="lightbox-category-chip" id="lb-cat-badge">SUITE</span>
            <h3 class="lightbox-title" id="lb-item-title">Aperçu Haute Définition</h3>
          </div>
          <div class="lightbox-controls">
            <span class="lightbox-counter-pill" id="lb-counter-pill">1 / 1</span>
            <button type="button" class="lightbox-close-btn" onclick="window.closeRichmanLightbox()" title="Fermer (Échap)">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        <div class="lightbox-main-stage" id="lb-stage">
          <button type="button" class="lightbox-nav-btn prev" id="lb-btn-prev" onclick="window.navigateLightbox(-1)" title="Précédent (Flèche gauche)">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <div class="lightbox-image-viewport">
            <img id="lb-main-image" class="lightbox-main-image" src="" alt="Photo agrandie" />
          </div>
          <button type="button" class="lightbox-nav-btn next" id="lb-btn-next" onclick="window.navigateLightbox(1)" title="Suivant (Flèche droite)">
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>

        <div class="lightbox-thumbnails-bar" id="lb-thumbs-bar"></div>
      </div>
    `;
    document.body.appendChild(lb);

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
      if (!currentLightboxData) return;
      if (e.key === "Escape") {
        (window as any).closeRichmanLightbox();
      } else if (e.key === "ArrowLeft") {
        (window as any).navigateLightbox(-1);
      } else if (e.key === "ArrowRight") {
        (window as any).navigateLightbox(1);
      }
    });

    // Touch swipe support
    let touchStartX = 0;
    const stage = lb.querySelector("#lb-stage");
    if (stage) {
      stage.addEventListener("touchstart", (e) => {
        touchStartX = (e as TouchEvent).changedTouches[0].screenX;
      }, { passive: true });
      stage.addEventListener("touchend", (e) => {
        const touchEndX = (e as TouchEvent).changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 40) {
          if (diff > 0) (window as any).navigateLightbox(1);
          else (window as any).navigateLightbox(-1);
        }
      }, { passive: true });
    }

    return lb;
  }

  (window as any).openRichmanLightbox = function (itemId: any, type = 'suite', startIndex = null) {
    const modal = ensureLightboxModalDOM();
    let item: any = null;

    if (type === 'suite') {
      item = state.publicSuitesList.find((s: any) => s.id === itemId);
    } else {
      item = state.publicVehiclesList.find((v: any) => v.id === itemId);
    }

    if (!item) return;

    const photos = extractItemMediaArray(item, type);
    const initialIndex = startIndex !== null ? startIndex : (state.cardActiveSlideMap.get(itemId) || 0);

    currentLightboxData = {
      item,
      type,
      photos,
      currentIndex: initialIndex >= 0 && initialIndex < photos.length ? initialIndex : 0
    };

    const titleEl = document.getElementById("lb-item-title");
    const catBadge = document.getElementById("lb-cat-badge");
    const itemName = type === 'vehicule' ? formatLuxuryCarName(item.name) : (item.name || 'Hébergement de Prestige');
    const categoryName = type === 'vehicule' ? 'SUPERCAR' : (item.category || 'SUITE').toUpperCase();

    if (titleEl) titleEl.textContent = itemName;
    if (catBadge) catBadge.textContent = categoryName;

    renderLightboxSlide();

    modal.classList.add("active");
    modal.removeAttribute("aria-hidden");
  };

  (window as any).closeRichmanLightbox = function () {
    const modal = document.getElementById("richman-lightbox-modal");
    if (modal) {
      modal.classList.remove("active");
      modal.setAttribute("aria-hidden", "true");
    }
    currentLightboxData = null;
  };

  (window as any).navigateLightbox = function (direction: any) {
    if (!currentLightboxData || currentLightboxData.photos.length <= 1) return;
    const len = currentLightboxData.photos.length;
    currentLightboxData.currentIndex = (currentLightboxData.currentIndex + direction + len) % len;
    renderLightboxSlide();
  };

  (window as any).goToLightboxSlide = function (index: any) {
    if (!currentLightboxData || index < 0 || index >= currentLightboxData.photos.length) return;
    currentLightboxData.currentIndex = index;
    renderLightboxSlide();
  };

  function renderLightboxSlide() {
    if (!currentLightboxData) return;
    const { photos, currentIndex } = currentLightboxData;

    const mainImg = document.getElementById("lb-main-image") as HTMLImageElement | null;
    const counterPill = document.getElementById("lb-counter-pill");
    const prevBtn = document.getElementById("lb-btn-prev");
    const nextBtn = document.getElementById("lb-btn-next");
    const thumbsBar = document.getElementById("lb-thumbs-bar");

    if (mainImg) {
      mainImg.style.opacity = "0.4";
      mainImg.style.transform = "scale(0.98)";
      mainImg.src = photos[currentIndex];
      mainImg.onload = () => {
        mainImg.style.opacity = "1";
        mainImg.style.transform = "scale(1)";
      };
      mainImg.onerror = () => {
        mainImg.src = 'assets/logo.webp';
        mainImg.style.opacity = "1";
        mainImg.style.transform = "scale(1)";
      };
    }

    if (counterPill) {
      counterPill.textContent = `${currentIndex + 1} / ${photos.length}`;
    }

    if (prevBtn && nextBtn) {
      const showArrows = photos.length > 1;
      prevBtn.style.display = showArrows ? "grid" : "none";
      nextBtn.style.display = showArrows ? "grid" : "none";
    }

    if (thumbsBar) {
      if (photos.length <= 1) {
        thumbsBar.style.display = "none";
      } else {
        thumbsBar.style.display = "flex";
        thumbsBar.innerHTML = photos.map((src: any, idx: number) => `
          <div class="lightbox-thumb-item ${idx === currentIndex ? 'active' : ''}" onclick="window.goToLightboxSlide(${idx})">
            <img src="${escapeHTML(src)}" alt="Miniature ${idx + 1}" onerror="this.onerror=null; this.src='assets/logo.webp';" />
          </div>
        `).join('');
      }
    }
  }

  // ---- Compat HTML : handlers globaux (affectations window d'origine conservées) ----
  (window as any).extractItemMediaArray = extractItemMediaArray;
});
