/* ==========================================================================
   Richman Estate — 13-client-portal.ts
   Espace client VIP, gestion des tickets/réservations & fenêtre de dialogue centrée
   Porté de main.js (13-client-portal.js) — ES module + TypeScript.
   ========================================================================== */

import { escapeHTML } from "../core/sanitize";
import { supabaseClient } from "../core/supabase";
import { botFetch } from "../core/api";
import { formatLuxuryCarName, resolveVehiclePhotoUrl } from "../core/vehicles";
import { showToast } from "./02-admin-crud";

// ==========================================================================
// VIP Client Portal & Centered Dialog Window (client.html)
// ==========================================================================
let clientCurrentFilter = "all";
let clientSearchQuery = "";
let clientSortOrder = "recent";
let clientChatRealtimeChannel: any = null;

export async function initClientPortal() {
  const portalMain = document.getElementById("client-portal-main");
  if (!portalMain) return;

  const authGate = document.getElementById("client-auth-gate");
  const dashHero = document.getElementById("client-dashboard-hero");
  const dashWrap = document.getElementById("client-dashboard-wrap");

  const rawUser = localStorage.getItem("richman_user");
  const activeUser = rawUser ? JSON.parse(rawUser) : null;

  if (!activeUser || !activeUser.name) {
    if (authGate) authGate.style.display = "flex";
    if (dashHero) dashHero.style.display = "none";
    if (dashWrap) dashWrap.style.display = "none";
    return;
  }

  if (authGate) authGate.style.display = "none";
  if (dashHero) dashHero.style.display = "flex";
  if (dashWrap) dashWrap.style.display = "block";

  // Populate user profile
  const nameEl = document.getElementById("client-user-name");
  const roleBadgeEl = document.getElementById("client-role-badge");
  if (nameEl) nameEl.textContent = activeUser.name || "Citoyen VIP";

  if (roleBadgeEl) {
    const isMasterOwner = activeUser.discord_id === "985083967642423366" || activeUser.discord_id === "1015310406169923665" || activeUser.role === 'owner';
    const isOwner = isMasterOwner || localStorage.getItem("richman_is_owner") === "true";
    if (isOwner) {
      localStorage.setItem("richman_is_owner", "true");
      roleBadgeEl.innerHTML = `<span><i class="fa-solid fa-crown" style="color: #ffffff; margin-right: 6px;"></i> Propriétaire Fondateur</span>`;
    } else if (activeUser.is_admin || (activeUser.role && activeUser.role !== 'client')) {
      roleBadgeEl.innerHTML = `<span><i class="fa-solid fa-shield-halved" style="color: #ffffff; margin-right: 6px;"></i> Staff Conciergerie</span>`;
    } else {
      roleBadgeEl.innerHTML = `<span><i class="fa-solid fa-gem" style="color: #ffffff; margin-right: 6px;"></i> Membre Citoyen VIP</span>`;
    }
  }

  // Keyboard ESC to close modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (window as any).activeChatBookingId) {
      (window as any).closeBookingDialog();
    }
  });

  await preloadCatalogMedia();
  await loadClientBookings(activeUser);
  setupClientRealtime(activeUser);

  // If URL has ?booking=<id>, open dialog directly
  const urlParams = new URLSearchParams(window.location.search);
  const targetBooking = urlParams.get("booking");
  if (targetBooking) {
    setTimeout(() => (window as any).openBookingDialog(targetBooking), 250);
  }
}

// Preload vehicles & suites photos for high-end visual cards
async function preloadCatalogMedia() {
  if (!supabaseClient) return;
  try {
    const [vRes, sRes] = await Promise.all([
      supabaseClient.from("vehicules").select("id, name, specs"),
      supabaseClient.from("suites").select("id, name, media_urls")
    ]);

    if (vRes.data) {
      vRes.data.forEach((v: any) => {
        let photo = "";
        try {
          if (v.specs && v.specs.startsWith("{")) {
            const meta = JSON.parse(v.specs);
            if (meta.media_url) {
              photo = meta.media_url.startsWith("[") ? JSON.parse(meta.media_url)[0] : meta.media_url;
            }
          }
        } catch(e) {}
        if (!photo) {
          photo = resolveVehiclePhotoUrl(v.name);
        }
        if (!photo) {
          photo = `https://api.staff.gta.ctgaming.fr:2096/uploads/vehicle-screenshots/${encodeURIComponent(v.name.toLowerCase().trim())}.webp`;
        }
        const rawLower = v.name.toLowerCase().trim();
        (window as any).clientMediaCache.vehicles[rawLower] = photo;
        (window as any).clientMediaCache.vehicles[v.id] = photo;

        const formatted = formatLuxuryCarName(v.name).toLowerCase().trim();
        (window as any).clientMediaCache.vehicles[formatted] = photo;
      });
    }

    if (sRes.data) {
      sRes.data.forEach((s: any) => {
        let photo = "";
        try {
          if (s.media_urls && s.media_urls.startsWith("[")) {
            photo = JSON.parse(s.media_urls)[0] || "";
          } else if (s.media_urls) {
            photo = s.media_urls;
          }
        } catch(e) {}
        if (!photo) photo = "assets/hotel/01_facade_nuit.jpg";
        const rawLower = s.name.toLowerCase().trim();
        (window as any).clientMediaCache.suites[rawLower] = photo;
        (window as any).clientMediaCache.suites[s.id] = photo;
      });
    }
  } catch(e) {
    console.warn("Preload catalog media error:", e);
  }
}

function getBookingThumbnail(b: any) {
  if (!b) return "assets/logo.webp";
  const isCar = (b.type || 'vehicule') === 'vehicule';
  const isSuite = b.type === 'suite';
  const cleanName = String(b.item_name || '').toLowerCase().trim();

  if (isCar) {
    if ((window as any).clientMediaCache.vehicles[cleanName]) return (window as any).clientMediaCache.vehicles[cleanName];
    for (const [k, url] of Object.entries((window as any).clientMediaCache.vehicles)) {
      if (cleanName === k || cleanName.includes(k) || k.includes(cleanName)) return url;
    }
    return resolveVehiclePhotoUrl(b.item_name);
  }

  if (isSuite) {
    if ((window as any).clientMediaCache.suites[cleanName]) return (window as any).clientMediaCache.suites[cleanName];
    for (const [k, url] of Object.entries((window as any).clientMediaCache.suites)) {
      if (cleanName === k || cleanName.includes(k) || k.includes(cleanName)) return url;
    }
    return "assets/hotel/01_facade_nuit.jpg";
  }

  return "assets/hotel/09_garages_nuit.jpg";
}

async function loadClientBookings(activeUser: any) {
  const listEl = document.getElementById("client-bookings-list");
  if (!listEl || !supabaseClient) return;

  try {
    let query = supabaseClient.from("bookings").select("*").order("created_at", { ascending: false });

    if (activeUser.discord_id) {
      query = query.or(`discord_id.eq.${activeUser.discord_id},client_name.eq.${activeUser.name}`);
    } else {
      query = query.eq("client_name", activeUser.name);
    }

    const { data, error } = await query;
    if (error) throw error;

    (window as any).allClientBookings = data || [];

    updateClientCounters();
    applyClientFiltersAndRender();
  } catch (err) {
    console.error("Erreur loadClientBookings:", err);
    listEl.innerHTML = `<div style="text-align: center; color: #fca5a5; padding: 24px; font-size: 13px;"><i class="fa-solid fa-triangle-exclamation" style="margin-right: 6px;"></i> Erreur lors du chargement de vos réservations.</div>`;
  }
}

function updateClientCounters() {
  const all = (window as any).allClientBookings || [];
  const totalCount = all.length;
  const vehiculesCount = all.filter((b: any) => (b.type || 'vehicule') === 'vehicule').length;
  const suitesCount = all.filter((b: any) => b.type === 'suite').length;
  const pendingCount = all.filter((b: any) => b.status === 'pending').length;
  const confirmedCount = all.filter((b: any) => b.status === 'confirmed').length;
  const cancelledCount = all.filter((b: any) => b.status === 'cancelled').length;

  const kpiHeroTotal = document.getElementById("kpi-hero-total");
  const countBadge = document.getElementById("client-bookings-badge");

  if (kpiHeroTotal) kpiHeroTotal.textContent = String(totalCount);
  if (countBadge) countBadge.textContent = `${totalCount} dossier${totalCount > 1 ? 's' : ''}`;

  const fAll = document.getElementById("filter-count-all");
  const fVeh = document.getElementById("filter-count-vehicule");
  const fSui = document.getElementById("filter-count-suite");
  const fPen = document.getElementById("filter-count-pending");
  const fCon = document.getElementById("filter-count-confirmed");
  const fCan = document.getElementById("filter-count-cancelled");

  if (fAll) fAll.textContent = String(totalCount);
  if (fVeh) fVeh.textContent = String(vehiculesCount);
  if (fSui) fSui.textContent = String(suitesCount);
  if (fPen) fPen.textContent = String(pendingCount);
  if (fCon) fCon.textContent = String(confirmedCount);
  if (fCan) fCan.textContent = String(cancelledCount);
}

function applyClientFiltersAndRender() {
  let filtered = [...((window as any).allClientBookings || [])];

  if (clientCurrentFilter === 'vehicule') {
    filtered = filtered.filter((b: any) => (b.type || 'vehicule') === 'vehicule');
  } else if (clientCurrentFilter === 'suite') {
    filtered = filtered.filter((b: any) => b.type === 'suite');
  } else if (clientCurrentFilter === 'pending') {
    filtered = filtered.filter((b: any) => b.status === 'pending');
  } else if (clientCurrentFilter === 'confirmed') {
    filtered = filtered.filter((b: any) => b.status === 'confirmed');
  } else if (clientCurrentFilter === 'cancelled') {
    filtered = filtered.filter((b: any) => b.status === 'cancelled');
  }

  if (clientSearchQuery) {
    const q = clientSearchQuery.toLowerCase();
    filtered = filtered.filter((b: any) =>
      String(b.item_name || '').toLowerCase().includes(q) ||
      String(b.id || '').toLowerCase().includes(q) ||
      String(b.dates || '').toLowerCase().includes(q) ||
      String(b.notes || '').toLowerCase().includes(q)
    );
  }

  if (clientSortOrder === 'recent') {
    filtered.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  } else if (clientSortOrder === 'oldest') {
    filtered.sort((a: any, b: any) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  } else if (clientSortOrder === 'status') {
    const rank: any = { pending: 0, confirmed: 1, cancelled: 2 };
    filtered.sort((a: any, b: any) => (rank[a.status] || 9) - (rank[b.status] || 9));
  } else if (clientSortOrder === 'name') {
    filtered.sort((a: any, b: any) => String(a.item_name || '').localeCompare(String(b.item_name || '')));
  }

  renderClientBookingsList(filtered);
}

function renderClientBookingsList(bookings: any) {
  const listEl = document.getElementById("client-bookings-list");
  if (!listEl) return;

  if (!bookings || bookings.length === 0) {
    if (clientSearchQuery || clientCurrentFilter !== "all") {
      listEl.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; background: #111216; border: 1px dashed rgba(255,255,255,0.1); border-radius: 20px;">
          <i class="fa-solid fa-folder-open" style="font-size: 32px; color: #71717a; margin-bottom: 12px; display: block;"></i>
          <h4 style="font-size: 16px; color: #fff; margin: 0 0 6px 0;">Aucun dossier ne correspond à votre filtre</h4>
          <p style="font-size: 13px; color: #a1a1aa; margin: 0 0 16px 0;">Modifiez votre recherche ou réinitialisez les filtres.</p>
          <button type="button" class="btn-new-ticket-action" onclick="window.clearClientSearch(); window.filterClientBookings('all', document.querySelector('[data-filter=all]'));">
            <i class="fa-solid fa-rotate-left"></i> Réinitialiser les filtres
          </button>
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div class="vip-empty-state-grid">
        <div class="vip-empty-card">
          <img src="assets/hotel/09_garages_nuit.jpg" alt="Véhicules" class="vip-empty-card-img" />
          <div class="vip-empty-card-body">
            <h4>Flotte Automobile de Prestige</h4>
            <p>Mise à disposition rapide de supercars, sportives et berlines avec remise des clés en direct au Domaine.</p>
            <a href="vehicules.html" class="vip-empty-card-btn">
              <i class="fa-solid fa-car"></i> Choisir un Véhicule
            </a>
          </div>
        </div>

        <div class="vip-empty-card">
          <img src="assets/hotel/01_facade_nuit.jpg" alt="Hôtel & Suites" class="vip-empty-card-img" />
          <div class="vip-empty-card-body">
            <h4>Hôtel, Suites &amp; Résidences</h4>
            <p>Suites haut de gamme, hébergements privés et service sur-mesure pour vos séjours à Los Santos.</p>
            <a href="suites.html" class="vip-empty-card-btn">
              <i class="fa-solid fa-hotel"></i> Découvrir les Suites
            </a>
          </div>
        </div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = "";
  bookings.forEach((b: any) => {
    const isCar = (b.type || 'vehicule') === 'vehicule';
    const isSuite = b.type === 'suite';
    const statusLabel = b.status === 'confirmed' ? 'Validée' : (b.status === 'cancelled' ? 'Refusée' : 'En Attente');
    const statusClass = b.status === 'confirmed' ? 'confirmed' : (b.status === 'cancelled' ? 'cancelled' : 'pending');
    const statusIcon = b.status === 'confirmed' ? 'fa-circle-check' : (b.status === 'cancelled' ? 'fa-circle-xmark' : 'fa-hourglass-half');
    const photoThumb = getBookingThumbnail(b);
    const shortRef = `BKG-${String(b.id || '').slice(0, 6).toUpperCase()}`;

    const card = document.createElement("div");
    card.className = "client-booking-card";
    card.setAttribute("data-booking-id", b.id);
    card.onclick = () => (window as any).openBookingDialog(b.id);

    let activeRentalBanner = '';
    if (b.status === 'confirmed') {
      let start = new Date();
      const duration = parseInt(b.duration) || 1;
      if (b.dates && !isNaN(Date.parse(b.dates))) {
        start = new Date(b.dates);
      } else if (b.created_at) {
        start = new Date(b.created_at);
      }
      const returnDate = new Date(start.getTime() + duration * 24 * 60 * 60 * 1000);
      const now = new Date();
      const diffMs = returnDate.getTime() - now.getTime();
      const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      const returnFormatted = returnDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

      activeRentalBanner = `
        <div class="active-rental-strip">
          <span style="display: inline-flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-key"></i> <strong>Location en cours</strong> (fin le ${returnFormatted})
          </span>
          <span class="badge-remaining">
            ${daysLeft > 0 ? `${daysLeft} j restant${daysLeft > 1 ? 's' : ''}` : "Dernier jour"}
          </span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="booking-card-media-banner">
        <img src="${escapeHTML(photoThumb)}" alt="${escapeHTML(b.item_name)}" class="booking-card-img" onerror="this.onerror=null; this.src='assets/hotel/09_garages_nuit.jpg';" />
        <div class="booking-card-overlay-gradient"></div>
        <span class="booking-card-type-chip">
          <i class="fa-solid ${isCar ? 'fa-car' : (isSuite ? 'fa-hotel' : 'fa-wand-magic-sparkles')}"></i>
          ${isCar ? 'Véhicule' : (isSuite ? 'Suite' : 'Concierge')}
        </span>
        <button type="button" class="booking-ref-tag" onclick="window.copyBookingRef(event, '${escapeHTML(b.id)}')" title="Cliquer pour copier la référence">
          <i class="fa-regular fa-copy"></i> #${shortRef}
        </button>
      </div>

      <div class="booking-card-content">
        <div class="booking-card-top">
          <div class="booking-card-item-title">
            <strong>${escapeHTML(b.item_name)}</strong>
            <span class="booking-card-category-hint">${isCar ? 'Supercar &amp; GT' : (isSuite ? 'Hôtel &amp; Résidence' : 'Service sur-mesure')}</span>
          </div>
          <span class="booking-status-tag ${statusClass}">
            <i class="fa-solid ${statusIcon}"></i> ${statusLabel}
          </span>
        </div>

        <div class="booking-card-details-grid">
          <div class="detail-cell">
            <span class="label">${isCar ? 'Période' : 'Date'}</span>
            <span class="val" title="${escapeHTML(b.dates || 'Immédiat')}">${escapeHTML(b.dates || 'Immédiat')}</span>
          </div>
          <div class="detail-cell">
            <span class="label">${isCar ? 'Durée' : 'Séjour'}</span>
            <span class="val">${escapeHTML(b.duration || '1')} ${isCar ? 'jour(s)' : 'nuit(s)'}</span>
          </div>
          <div class="detail-cell">
            <span class="label">Montant</span>
            <span class="val" style="color: var(--accent-gold, #c5a880);">${escapeHTML(b.amount || 'Sur devis')}</span>
          </div>
        </div>

        ${activeRentalBanner}

        <div class="booking-card-footer">
          <span class="booking-created-time">
            <i class="fa-regular fa-clock"></i> ${new Date(b.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
          <div class="card-actions-btn-group">
            <button type="button" class="btn-open-chat-card" onclick="event.stopPropagation(); window.openBookingDialog('${escapeHTML(b.id)}');">
              <i class="fa-solid fa-comments"></i> Discussion
            </button>
          </div>
        </div>
      </div>
    `;

    listEl.appendChild(card);
  });
}

// ==========================================================================
// CENTERED VIP CHAT DIALOG MODAL (HAUTE COUTURE)
// ==========================================================================

function renderDialogDossiersBar() {
  const bar = document.getElementById("dialog-dossiers-bar");
  if (!bar) return;

  if (!(window as any).allClientBookings || (window as any).allClientBookings.length <= 1) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }

  bar.style.display = "flex";
  bar.innerHTML = "";
  (window as any).allClientBookings.forEach((b: any) => {
    const isCar = (b.type || 'vehicule') === 'vehicule';
    const isCurrent = (window as any).activeChatBookingId === b.id;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `dialog-dossier-pill ${isCurrent ? 'active' : ''}`;
    pill.innerHTML = `
      <i class="fa-solid ${isCar ? 'fa-car' : 'fa-hotel'}"></i>
      <span>${escapeHTML(b.item_name)}</span>
    `;
    pill.onclick = () => (window as any).openBookingDialog(b.id);
    bar.appendChild(pill);
  });
}

async function loadBookingMessages(bookingId: any, containerEl: any, currentBooking: any = null) {
  if (!containerEl || !supabaseClient) return;
  try {
    const booking = currentBooking || (window as any).allClientBookings.find((b: any) => b.id === bookingId);
    const { data, error } = await supabaseClient
      .from("booking_messages")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    containerEl.innerHTML = "";

    // Context Status Recap Banner at Top of Chat
    if (booking) {
      let statusBannerHtml = "";
      if (booking.status === 'confirmed') {
        statusBannerHtml = `
          <div class="chat-status-recap-banner confirmed">
            <div class="banner-icon-wrap"><i class="fa-solid fa-circle-check"></i></div>
            <div class="banner-content">
              <h4>Réservation Confirmée &bull; Clés Disponibles</h4>
              <p>Votre réservation a été validée par la direction. Présentez-vous à l'accueil du Domaine avec votre identifiant citoyen pour la remise des clés.</p>
            </div>
          </div>
        `;
      } else if (booking.status === 'pending') {
        statusBannerHtml = `
          <div class="chat-status-recap-banner pending">
            <div class="banner-icon-wrap"><i class="fa-solid fa-hourglass-half"></i></div>
            <div class="banner-content">
              <h4>Demande en Cours de Traitement</h4>
              <p>Notre conciergerie vérifie la disponibilité et vous répondra sous peu directement ici et sur Discord.</p>
            </div>
          </div>
        `;
      } else if (booking.status === 'cancelled') {
        statusBannerHtml = `
          <div class="chat-status-recap-banner cancelled">
            <div class="banner-icon-wrap"><i class="fa-solid fa-circle-xmark"></i></div>
            <div class="banner-content">
              <h4>Demande Non Retenue / Clôturée</h4>
              <p>Ce dossier n'est plus actif. Vous pouvez échanger ci-dessous avec le majordome ou formuler une nouvelle demande.</p>
            </div>
          </div>
        `;
      }
      if (statusBannerHtml) {
        const bannerEl = document.createElement("div");
        bannerEl.innerHTML = statusBannerHtml;
        if (bannerEl.firstElementChild) containerEl.appendChild(bannerEl.firstElementChild);
      }
    }

    if (!data || data.length === 0) {
      const welcomeHint = document.createElement("div");
      welcomeHint.style.cssText = "text-align: center; padding: 24px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.08); border-radius: 14px; margin-top: 6px;";
      welcomeHint.innerHTML = `
        <i class="fa-solid fa-comments" style="font-size: 26px; color: var(--accent-gold, #c5a880); margin-bottom: 10px; display: block;"></i>
        <h4 style="font-size: 14px; color: #ffffff; margin: 0 0 4px 0;">Salon Privé Ouvert</h4>
        <p style="font-size: 12px; color: #a1a1aa; line-height: 1.45; margin: 0;">
          Posez votre question ou utilisez une suggestion ci-dessous. Vos messages alertent immédiatement notre équipe en service.
        </p>
      `;
      containerEl.appendChild(welcomeHint);
      return;
    }

    let lastDateStr = "";
    data.forEach((msg: any) => {
      const msgDate = new Date(msg.created_at || Date.now()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      if (msgDate !== lastDateStr) {
        lastDateStr = msgDate;
        const sep = document.createElement("div");
        sep.className = "chat-date-separator";
        sep.innerHTML = `<span>${msgDate}</span>`;
        containerEl.appendChild(sep);
      }
      appendMessageBubble(containerEl, msg);
    });
    containerEl.scrollTop = containerEl.scrollHeight;
  } catch (e) {
    console.error("Erreur loadBookingMessages:", e);
    containerEl.innerHTML = `<div style="color: #fca5a5; text-align: center; padding: 20px; font-size: 12.5px;">Erreur lors du chargement des messages.</div>`;
  }
}

export function appendMessageBubble(containerEl: any, msg: any) {
  if (!containerEl || !msg) return;

  const cleanContent = String(msg.content || '').trim();
  if (!cleanContent) return;

  // Bulletproof Deduplication
  const existingRows = containerEl.querySelectorAll(".chat-msg-row");
  for (const row of existingRows) {
    const rowId = row.getAttribute("data-msg-id");
    const rowPending = row.getAttribute("data-pending-key");

    if (msg.id && rowId === String(msg.id)) return;
    if (msg.id && rowPending === `${msg.sender_role}_${cleanContent}`) {
      row.setAttribute("data-msg-id", String(msg.id));
      row.removeAttribute("data-pending-key");
      return;
    }
    if (!msg.id && rowPending === `${msg.sender_role}_${cleanContent}`) return;
  }

  const isStaff = msg.sender_role === 'staff' ||
    msg.sender_id === '985083967642423366' ||
    msg.sender_id === '1015310406169923665' ||
    String(msg.sender_name || '').toLowerCase().includes('staff') ||
    String(msg.sender_name || '').toLowerCase() === 'nalyd';

  const timeStr = new Date(msg.created_at || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const row = document.createElement("div");
  row.className = `chat-msg-row ${isStaff ? 'staff' : 'client'}`;
  if (msg.id) {
    row.setAttribute("data-msg-id", String(msg.id));
  } else {
    row.setAttribute("data-pending-key", `${msg.sender_role}_${cleanContent}`);
  }

  row.innerHTML = `
    <div class="chat-msg-meta">
      <span class="chat-msg-sender">${escapeHTML(msg.sender_name || (isStaff ? 'Staff Richman' : 'Client'))}</span>
      ${isStaff ? '<span class="chat-msg-role-chip staff"><i class="fa-solid fa-shield-halved"></i> Staff</span>' : ''}
      <span class="chat-msg-time">&bull; ${timeStr}</span>
    </div>
    <div class="chat-msg-bubble">
      ${escapeHTML(cleanContent)}
    </div>
  `;

  containerEl.appendChild(row);
  containerEl.scrollTop = containerEl.scrollHeight;
}

// ==========================================================================
// CONCIERGE CUSTOM REQUEST MODAL (DEMANDE SPÉCIALE)
// ==========================================================================

// ==========================================================================
// REALTIME & AUTO-POLLING SYNCHRONIZATION
// ==========================================================================

function setupClientRealtime(activeUser: any) {
  if (!supabaseClient) return;

  try {
    if (clientChatRealtimeChannel) supabaseClient.removeChannel(clientChatRealtimeChannel);

    clientChatRealtimeChannel = supabaseClient
      .channel('client_sync_feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'booking_messages' }, (payload: any) => {
        const newMsg = payload.new;
        if (newMsg && newMsg.booking_id === (window as any).activeChatBookingId) {
          const msgContainer = document.getElementById("dialog-messages-container");
          if (msgContainer) {
            appendMessageBubble(msgContainer, newMsg);
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, (payload: any) => {
        const updated = payload.new;
        if (updated) {
          const idx = (window as any).allClientBookings.findIndex((b: any) => b.id === updated.id);
          if (idx !== -1) {
            (window as any).allClientBookings[idx] = updated;
            updateClientCounters();
            applyClientFiltersAndRender();
            if ((window as any).activeChatBookingId === updated.id) {
              const chipEl = document.getElementById("dialog-status-chip");
              const statusLabel = updated.status === 'confirmed' ? 'Validée' : (updated.status === 'cancelled' ? 'Refusée' : 'En Attente');
              const statusClass = updated.status === 'confirmed' ? 'confirmed' : (updated.status === 'cancelled' ? 'cancelled' : 'pending');
              if (chipEl) {
                chipEl.textContent = statusLabel;
                chipEl.className = `dialog-status-chip ${statusClass}`;
              }
            }
          }
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, (payload: any) => {
        const created = payload.new;
        if (created && (created.discord_id === activeUser.discord_id || created.client_name === activeUser.name)) {
          if (!(window as any).allClientBookings.some((b: any) => b.id === created.id)) {
            (window as any).allClientBookings.unshift(created);
            updateClientCounters();
            applyClientFiltersAndRender();
          }
        }
      })
      .subscribe();
  } catch (err) {
    console.warn("Realtime setup warning:", err);
  }

  // Auto-polling fallback every 2.5s for seamless chat & booking status synchronization
  if ((window as any).clientChatPollingInterval) clearInterval((window as any).clientChatPollingInterval);
  (window as any).clientChatPollingInterval = setInterval(async () => {
    // 1. Live Chat Sync
    if ((window as any).activeChatBookingId && document.getElementById("dialog-messages-container")) {
      const { data } = await supabaseClient
        .from("booking_messages")
        .select("*")
        .eq("booking_id", (window as any).activeChatBookingId)
        .order("created_at", { ascending: true });
      if (data && data.length > 0) {
        const container = document.getElementById("dialog-messages-container");
        data.forEach((m: any) => appendMessageBubble(container, m));
      }
    }

    // 2. Live Booking Status Sync
    if (activeUser && (activeUser.discord_id || activeUser.name) && supabaseClient) {
      try {
        let query = supabaseClient.from("bookings").select("id, status, amount, dates, duration");
        if (activeUser.discord_id) {
          query = query.or(`discord_id.eq.${activeUser.discord_id},client_name.eq.${activeUser.name}`);
        } else {
          query = query.eq("client_name", activeUser.name);
        }
        const { data: bList } = await query;
        if (bList && bList.length > 0 && (window as any).allClientBookings) {
          let hasChange = false;
          bList.forEach((fresh: any) => {
            const local = (window as any).allClientBookings.find((x: any) => x.id === fresh.id);
            if (local && local.status !== fresh.status) {
              local.status = fresh.status;
              hasChange = true;
            }
          });
          if (hasChange) {
            updateClientCounters();
            applyClientFiltersAndRender();
            if ((window as any).activeChatBookingId) {
              const currentB = (window as any).allClientBookings.find((x: any) => x.id === (window as any).activeChatBookingId);
              if (currentB) {
                const chipEl = document.getElementById("dialog-status-chip");
                const statusLabel = currentB.status === 'confirmed' ? 'Validée' : (currentB.status === 'cancelled' ? 'Refusée' : 'En Attente');
                const statusClass = currentB.status === 'confirmed' ? 'confirmed' : (currentB.status === 'cancelled' ? 'cancelled' : 'pending');
                if (chipEl) {
                  chipEl.textContent = statusLabel;
                  chipEl.className = `dialog-status-chip ${statusClass}`;
                }
              }
            }
          }
        }
      } catch (e) {}
    }
  }, 2500);
}

document.addEventListener("DOMContentLoaded", () => {
  (window as any).allClientBookings = [];
  (window as any).activeChatBookingId = null;
  (window as any).clientMediaCache = {
    vehicles: {},
    suites: {}
  };

  (window as any).scrollToBookings = function () {
    const el = document.getElementById("reservations-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  (window as any).filterClientBookings = function (filterType: any, btnEl: any) {
    clientCurrentFilter = filterType;
    document.querySelectorAll(".vip-filter-tab").forEach(p => p.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");
    applyClientFiltersAndRender();
  };

  (window as any).handleClientSearch = function (val: any) {
    clientSearchQuery = (val || "").trim();
    const clearBtn = document.getElementById("client-search-clear");
    if (clearBtn) clearBtn.style.display = clientSearchQuery ? "flex" : "none";
    applyClientFiltersAndRender();
  };

  (window as any).clearClientSearch = function () {
    clientSearchQuery = "";
    const searchInput = document.getElementById("client-bookings-search") as HTMLInputElement | null;
    const clearBtn = document.getElementById("client-search-clear");
    if (searchInput) searchInput.value = "";
    if (clearBtn) clearBtn.style.display = "none";
    applyClientFiltersAndRender();
  };

  (window as any).handleClientSort = function (sortVal: any) {
    clientSortOrder = sortVal || "recent";
    applyClientFiltersAndRender();
  };

  (window as any).copyBookingRef = function (e: any, refId: any) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const shortRef = `BKG-${String(refId).slice(0, 6).toUpperCase()}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(`#${shortRef}`);
      showToast(`Référence #${shortRef} copiée !`, "info");
    }
  };

  (window as any).copyCurrentChatRef = function (e: any) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!(window as any).activeChatBookingId) return;
    const shortRef = `BKG-${String((window as any).activeChatBookingId).slice(0, 6).toUpperCase()}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(`#${shortRef}`);
      showToast(`Référence #${shortRef} copiée !`, "info");
    }
  };

  (window as any).cancelClientBooking = async function (e: any, bookingId: any, itemName: any) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!supabaseClient) return;

    const confirmed = await (window as any).showConfirmDialog({
      title: "Annuler cette demande ?",
      message: `Voulez-vous vraiment annuler votre demande de réservation pour <strong style="color: #fff;">${escapeHTML(itemName)}</strong> ?<br><br><span style="font-size: 12px; color: #a1a1aa;">Le majordome sera immédiatement informé de votre désistement.</span>`,
      confirmText: "Oui, annuler la demande",
      cancelText: "Conserver",
      isDanger: true
    });
    if (!confirmed) return;

    try {
      const { error } = await supabaseClient
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", bookingId);

      if (error) throw error;

      const rawUser = localStorage.getItem("richman_user");
      const activeUser = rawUser ? JSON.parse(rawUser) : { name: "Citoyen" };
      botFetch('/api/sync-booking-status-action', {
        method: 'POST',
        body: JSON.stringify({
          booking_id: bookingId,
          status: 'cancelled',
          client_name: activeUser.name,
          item_name: itemName,
          sender_role: 'client'
        })
      }).catch(err => console.warn("Sync booking cancel action warning:", err));

      showToast("Demande de réservation annulée.", "info");

      const idx = (window as any).allClientBookings.findIndex((b: any) => b.id === bookingId);
      if (idx !== -1) {
        (window as any).allClientBookings[idx].status = "cancelled";
      }
      updateClientCounters();
      applyClientFiltersAndRender();

      if ((window as any).activeChatBookingId === bookingId) {
        (window as any).openBookingDialog(bookingId);
      }
    } catch(err: any) {
      console.error(err);
      showToast("Erreur lors de l'annulation : " + err.message, "danger");
    }
  };

  // ==========================================================================
  // CENTERED VIP CHAT DIALOG MODAL (HAUTE COUTURE)
  // ==========================================================================

  (window as any).openBookingDialog = async function (bookingId: any) {
    const overlay = document.getElementById("vip-dialog-overlay");
    if (!overlay) return;

    (window as any).activeChatBookingId = bookingId;

    const booking = (window as any).allClientBookings.find((b: any) => b.id === bookingId);
    if (!booking) return;

    overlay.style.display = "flex";
    requestAnimationFrame(() => overlay.classList.add("active"));
    document.body.style.overflow = "hidden";

    // Populate Dialog Header
    const photoThumb = getBookingThumbnail(booking);
    const shortRef = `BKG-${String(booking.id || '').slice(0, 6).toUpperCase()}`;
    const statusLabel = booking.status === 'confirmed' ? 'Validée' : (booking.status === 'cancelled' ? 'Refusée' : 'En Attente');
    const statusClass = booking.status === 'confirmed' ? 'confirmed' : (booking.status === 'cancelled' ? 'cancelled' : 'pending');

    const thumbEl = document.getElementById("dialog-item-thumb") as HTMLImageElement | null;
    const titleEl = document.getElementById("dialog-item-title");
    const refText = document.getElementById("dialog-ref-text");
    const chipEl = document.getElementById("dialog-status-chip");
    const priceEl = document.getElementById("dialog-price-tag");
    const datesEl = document.getElementById("dialog-dates-tag");
    const inputEl = document.getElementById("chat-message-input") as HTMLInputElement | null;
    const sendBtn = document.getElementById("chat-send-btn") as HTMLButtonElement | null;
    const msgContainer = document.getElementById("dialog-messages-container");

    if (thumbEl) thumbEl.src = photoThumb;
    if (titleEl) titleEl.textContent = booking.item_name;
    if (refText) refText.textContent = `#${shortRef}`;
    if (chipEl) {
      chipEl.textContent = statusLabel;
      chipEl.className = `dialog-status-chip ${statusClass}`;
    }
    if (priceEl) priceEl.textContent = booking.amount || 'Sur devis';
    if (datesEl) datesEl.textContent = booking.dates ? `• ${booking.dates}` : '';

    if (inputEl) {
      inputEl.disabled = false;
      inputEl.placeholder = `Écrivez à propos de ${booking.item_name}...`;
      setTimeout(() => inputEl.focus(), 150);
    }
    if (sendBtn) sendBtn.disabled = false;

    renderDialogDossiersBar();

    if (msgContainer) {
      msgContainer.innerHTML = `<div style="text-align: center; color: #71717a; padding: 24px; font-size: 13px;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des échanges sécurisés...</div>`;
    }

    await loadBookingMessages(bookingId, msgContainer, booking);
  };

  (window as any).closeBookingDialog = function () {
    const overlay = document.getElementById("vip-dialog-overlay");
    if (!overlay) return;
    overlay.classList.remove("active");
    setTimeout(() => {
      overlay.style.display = "none";
      document.body.style.overflow = "";
      (window as any).activeChatBookingId = null;
    }, 250);
  };

  // Backwards compatibility aliases
  (window as any).openConciergeDrawer = (window as any).openBookingDialog;
  (window as any).closeConciergeDrawer = (window as any).closeBookingDialog;
  (window as any).showBookingDetailView = (window as any).openBookingDialog;
  (window as any).showBookingListView = (window as any).closeBookingDialog;

  (window as any).refreshActiveChatMessages = async function () {
    if (!(window as any).activeChatBookingId) return;
    const msgContainer = document.getElementById("dialog-messages-container");
    const booking = (window as any).allClientBookings.find((b: any) => b.id === (window as any).activeChatBookingId);
    if (msgContainer) {
      await loadBookingMessages((window as any).activeChatBookingId, msgContainer, booking);
      showToast("Discussion rafraîchie", "info");
    }
  };

  (window as any).handleClientSendMessage = async function (e: any) {
    if (e) e.preventDefault();
    const input = document.getElementById("chat-message-input") as HTMLInputElement | null;
    const sendBtn = document.getElementById("chat-send-btn") as HTMLButtonElement | null;
    const msgContainer = document.getElementById("dialog-messages-container");
    if (!input || !(window as any).activeChatBookingId) return;

    const content = input.value.trim();
    if (!content) return;

    const rawUser = localStorage.getItem("richman_user");
    const activeUser = rawUser ? JSON.parse(rawUser) : { name: "Citoyen" };

    input.value = "";
    input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    try {
      if (supabaseClient) {
        await supabaseClient.from("booking_messages").insert([{
          booking_id: (window as any).activeChatBookingId,
          sender_name: activeUser.name || "Citoyen",
          sender_id: activeUser.discord_id || null,
          sender_role: "client",
          content: content
        }]);
      }

      botFetch('/api/sync-booking-message', {
        method: "POST",
        body: JSON.stringify({
          booking_id: (window as any).activeChatBookingId,
          discord_id: activeUser.discord_id || null,
          sender_name: activeUser.name || "Citoyen",
          sender_role: "client",
          content: content,
          skip_db_insert: true
        })
      }).catch(err => console.warn("Sync booking message error:", err));

      if (msgContainer) {
        appendMessageBubble(msgContainer, {
          sender_name: activeUser.name,
          sender_role: "client",
          content: content,
          created_at: new Date().toISOString()
        });
      }
    } catch (err: any) {
      console.error(err);
      showToast("Erreur envoi message : " + err.message, "danger");
    } finally {
      input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
    }
  };

  // ==========================================================================
  // CONCIERGE CUSTOM REQUEST MODAL (DEMANDE SPÉCIALE)
  // ==========================================================================

  (window as any).openConciergeCustomRequestModal = function () {
    const overlay = document.getElementById("concierge-custom-modal-overlay");
    if (!overlay) return;
    const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");
    const phoneInput = document.getElementById("custom-req-phone") as HTMLInputElement | null;
    const dateInput = document.getElementById("custom-req-date") as HTMLInputElement | null;

    if (phoneInput && activeUser.phone) phoneInput.value = activeUser.phone;
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];

    overlay.style.display = "flex";
    overlay.classList.add("active");
    overlay.removeAttribute("aria-hidden");
  };

  (window as any).closeConciergeCustomRequestModal = function () {
    const overlay = document.getElementById("concierge-custom-modal-overlay");
    if (!overlay) return;
    overlay.classList.remove("active");
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
  };

  (window as any).handleConciergeCustomRequestSubmit = async function (e: any) {
    if (e) e.preventDefault();
    if (!supabaseClient) return;

    const submitBtn = document.getElementById("custom-req-submit-btn") as HTMLButtonElement | null;
    const origHtml = submitBtn ? submitBtn.innerHTML : "";
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transmission...';
      submitBtn.disabled = true;
    }

    const type = (document.getElementById("custom-req-type") as HTMLInputElement | null)?.value || "concierge_general";
    const title = (document.getElementById("custom-req-title") as HTMLInputElement | null)?.value || "Demande Spéciale";
    const date = (document.getElementById("custom-req-date") as HTMLInputElement | null)?.value || "";
    const phone = (document.getElementById("custom-req-phone") as HTMLInputElement | null)?.value || "";
    const notes = (document.getElementById("custom-req-notes") as HTMLTextAreaElement | null)?.value || "";

    const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");

    try {
      const payload = {
        item_name: `✨ ${title}`,
        type: type.includes('vehicule') ? 'vehicule' : (type.includes('suite') ? 'suite' : 'concierge'),
        client_name: activeUser.name || "Citoyen VIP",
        discord_id: activeUser.discord_id || null,
        phone: phone,
        dates: date || "Immédiat",
        duration: "1",
        amount: "Sur devis",
        notes: notes,
        status: "pending"
      };

      const { data, error } = await supabaseClient
        .from("bookings")
        .insert([payload])
        .select()
        .single();

      if (error) throw error;

      botFetch('/api/sync-booking-create', {
        method: "POST",
        body: JSON.stringify({
          booking: data,
          client_name: activeUser.name,
          discord_id: activeUser.discord_id
        })
      }).catch(err => console.warn("Sync new custom ticket warning:", err));

      showToast("Demande spéciale transmise à la conciergerie !", "success");
      (window as any).closeConciergeCustomRequestModal();
      (document.getElementById("concierge-custom-request-form") as HTMLFormElement | null)?.reset();

      await loadClientBookings(activeUser);
      if (data && data.id) {
        (window as any).openBookingDialog(data.id);
      }
    } catch(err: any) {
      console.error(err);
      showToast("Erreur création demande : " + err.message, "danger");
    } finally {
      if (submitBtn) {
        submitBtn.innerHTML = origHtml;
        submitBtn.disabled = false;
      }
    }
  };

  // ---- Compat HTML : handlers globaux (affectations window d'origine conservées) ----
  (window as any).appendMessageBubble = appendMessageBubble;
  (window as any).initClientPortal = initClientPortal;
});
