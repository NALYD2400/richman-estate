/* ==========================================================================
   Richman Estate — 14-admin-chat.ts
   Admin : chat dossiers & hub tickets conciergerie
   Porté de main.js (14-admin-chat.js) — ES module + TypeScript.
   ========================================================================== */

import { escapeHTML } from "../core/sanitize";
import { supabaseClient } from "../core/supabase";
import { botFetch } from "../core/api";
import { showToast } from "./02-admin-crud";
import { appendMessageBubble, initClientPortal } from "./13-client-portal";
import { renderHeaderNavUserPill, bindAdminUserCardDetails } from "./06-auth-oauth";
import { initRichmanMatrixBackground } from "./15-atmosphere";

// ==========================================================================
// Admin Booking Chat Modal (admin.html)
// ==========================================================================
let adminChatRealtimeChannel: any = null;

async function loadAdminBookingMessages(bookingId: any, containerEl: any) {
  if (!containerEl || !supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from("booking_messages")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      containerEl.innerHTML = `<div style="text-align: center; color: #71717a; padding: 30px; font-size: 13px;">Aucun message échangé pour ce dossier pour l'instant.</div>`;
      return;
    }

    containerEl.innerHTML = "";
    data.forEach((msg: any) => appendMessageBubble(containerEl, msg));
    containerEl.scrollTop = containerEl.scrollHeight;
  } catch (e) {
    console.error(e);
    containerEl.innerHTML = `<div style="color: #fca5a5; text-align: center; padding: 20px;">Erreur de chargement des messages.</div>`;
  }
}

// ==========================================================================
// Admin VIP Tickets & Concierge Live Chat Hub Controller
// ==========================================================================
let adminAllTickets: any[] = [];
let adminActiveTicket: any = null;
let adminTicketRealtime: any = null;

document.addEventListener("DOMContentLoaded", () => {
  (window as any).openAdminChatModal = async function (bookingId: any, clientName: any, itemName: any, discordId: any) {
    const overlay = document.getElementById("admin-chat-modal-overlay");
    const titleEl = document.getElementById("admin-chat-modal-title");
    const subEl = document.getElementById("admin-chat-modal-sub");
    const bInput = document.getElementById("admin-chat-booking-id") as HTMLInputElement | null;
    const dInput = document.getElementById("admin-chat-discord-id") as HTMLInputElement | null;
    const msgContainer = document.getElementById("admin-chat-messages-container");

    if (titleEl) titleEl.textContent = `Discussion • ${itemName}`;
    if (subEl) subEl.innerHTML = `Client : <strong>${escapeHTML(clientName)}</strong> ${discordId ? `(<@${escapeHTML(discordId)}>)` : ''} &bull; Dossier #${bookingId.slice(0,6).toUpperCase()}`;
    if (bInput) bInput.value = bookingId;
    if (dInput) dInput.value = discordId || "";

    if (overlay) overlay.classList.add("active");
    if (msgContainer) msgContainer.innerHTML = `<div style="text-align: center; color: #71717a; padding: 20px; font-size: 13px;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des échanges...</div>`;

    await loadAdminBookingMessages(bookingId, msgContainer);

    // Setup realtime for admin chat
    if (supabaseClient) {
      if (adminChatRealtimeChannel) supabaseClient.removeChannel(adminChatRealtimeChannel);
      adminChatRealtimeChannel = supabaseClient
        .channel(`admin_chat_${bookingId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'booking_messages', filter: `booking_id=eq.${bookingId}` }, (payload: any) => {
          if (payload.new && payload.new.sender_role !== 'staff') {
            appendMessageBubble(msgContainer, payload.new);
          }
        })
        .subscribe();
    }
  };

  (window as any).closeAdminChatModal = function () {
    const overlay = document.getElementById("admin-chat-modal-overlay");
    if (overlay) overlay.classList.remove("active");
    if (adminChatRealtimeChannel && supabaseClient) {
      supabaseClient.removeChannel(adminChatRealtimeChannel);
      adminChatRealtimeChannel = null;
    }
  };

  (window as any).handleAdminSendBookingMessage = async function (e: any) {
    if (e) e.preventDefault();
    const bId = (document.getElementById("admin-chat-booking-id") as HTMLInputElement | null)?.value;
    const dId = (document.getElementById("admin-chat-discord-id") as HTMLInputElement | null)?.value;
    const input = document.getElementById("admin-chat-input") as HTMLInputElement | null;
    const container = document.getElementById("admin-chat-messages-container");
    if (!bId || !input) return;

    const content = input.value.trim();
    if (!content) return;

    const rawUser = localStorage.getItem("richman_user");
    const activeUser = rawUser ? JSON.parse(rawUser) : { name: "Staff Conciergerie" };

    input.value = "";
    input.disabled = true;

    try {
      if (supabaseClient) {
        await supabaseClient.from("booking_messages").insert([{
          booking_id: bId,
          sender_name: activeUser.name || "Staff Richman",
          sender_id: activeUser.discord_id || null,
          sender_role: "staff",
          content: content
        }]);
      }

      // Propagate via Bot API (Web -> Discord Ticket)
      botFetch('/api/sync-booking-message', {
        method: "POST",
        body: JSON.stringify({
          booking_id: bId,
          discord_id: dId || null,
          sender_name: activeUser.name || "Staff Richman",
          sender_role: "staff",
          content: content,
          skip_db_insert: true
        })
      }).catch(err => console.warn("Admin sync booking message error:", err));

      appendMessageBubble(container, {
        sender_name: activeUser.name,
        sender_role: "staff",
        content: content,
        created_at: new Date().toISOString()
      });

      showToast("Message envoyé au client (Site & Discord) !", "success");
    } catch (err: any) {
      console.error(err);
      showToast("Erreur envoi message : " + err.message, "danger");
    } finally {
      input.disabled = false;
      input.focus();
    }
  };

  // ==========================================================================
  // Admin VIP Tickets & Concierge Live Chat Hub Controller
  // ==========================================================================

  (window as any).loadAdminTickets = async function (typeCategory: any = null) {
    const carsListContainer = document.getElementById("admin-tickets-cars-list-container");
    const suitesListContainer = document.getElementById("admin-tickets-suites-list-container");
    const carsBadge = document.getElementById("admin-tickets-cars-badge");
    const suitesBadge = document.getElementById("admin-tickets-suites-badge");
    if (!supabaseClient) return;

    if (carsListContainer) {
      carsListContainer.innerHTML = `<div style="text-align: center; color: #71717a; padding: 24px; font-size: 13px;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des tickets véhicules...</div>`;
    }
    if (suitesListContainer) {
      suitesListContainer.innerHTML = `<div style="text-align: center; color: #71717a; padding: 24px; font-size: 13px;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des tickets hébergements...</div>`;
    }

    try {
      const { data, error } = await supabaseClient
        .from("bookings")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      adminAllTickets = data || [];

      // Update badges for both sections
      const carsPending = adminAllTickets.filter(t => (t.type === 'vehicule' || !t.type) && t.status === 'pending').length;
      const suitesPending = adminAllTickets.filter(t => t.type === 'suite' && t.status === 'pending').length;

      if (carsBadge) {
        if (carsPending > 0) {
          carsBadge.textContent = String(carsPending);
          carsBadge.style.display = "inline-block";
        } else {
          carsBadge.style.display = "none";
        }
      }

      if (suitesBadge) {
        if (suitesPending > 0) {
          suitesBadge.textContent = String(suitesPending);
          suitesBadge.style.display = "inline-block";
        } else {
          suitesBadge.style.display = "none";
        }
      }

      (window as any).filterAdminTicketsList('vehicule');
      (window as any).filterAdminTicketsList('suite');

      // If active ticket is selected, re-sync it
      if (adminActiveTicket) {
        const refreshed = adminAllTickets.find(t => t.id === adminActiveTicket.id);
        if (refreshed) {
          const category = (refreshed.type === 'suite') ? 'suite' : 'vehicule';
          (window as any).selectAdminTicket(refreshed.id, category);
        }
      }
    } catch (e) {
      console.error("Error loading admin tickets:", e);
      if (carsListContainer) carsListContainer.innerHTML = `<div style="color: #fca5a5; text-align: center; padding: 20px;">Erreur de chargement.</div>`;
      if (suitesListContainer) suitesListContainer.innerHTML = `<div style="color: #fca5a5; text-align: center; padding: 20px;">Erreur de chargement.</div>`;
    }
  };

  (window as any).filterAdminTicketsList = function (category: any = 'vehicule') {
    const isSuite = category === 'suite';
    const listContainerId = isSuite ? "admin-tickets-suites-list-container" : "admin-tickets-cars-list-container";
    const searchInputId = isSuite ? "admin-tickets-suites-search" : "admin-tickets-cars-search";
    const statusFilterId = isSuite ? "admin-tickets-suites-status-filter" : "admin-tickets-cars-status-filter";

    const listContainer = document.getElementById(listContainerId);
    if (!listContainer) return;

    const searchVal = ((document.getElementById(searchInputId) as HTMLInputElement | null)?.value || "").toLowerCase().trim();
    const statusVal = (document.getElementById(statusFilterId) as HTMLSelectElement | null)?.value || "all";

    let filtered = adminAllTickets.filter(t => isSuite ? t.type === 'suite' : (t.type === 'vehicule' || !t.type));

    if (statusVal !== "all") {
      filtered = filtered.filter(t => t.status === statusVal);
    }

    if (searchVal) {
      filtered = filtered.filter(t =>
        (t.client_name || "").toLowerCase().includes(searchVal) ||
        (t.item_name || "").toLowerCase().includes(searchVal) ||
        (t.id || "").toLowerCase().includes(searchVal) ||
        (t.phone || "").toLowerCase().includes(searchVal)
      );
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div style="text-align: center; color: #71717a; padding: 30px 10px; font-size: 13px;">Aucun dossier ${isSuite ? "d'hébergement" : "de véhicule"} ne correspond aux critères.</div>`;
      return;
    }

    listContainer.innerHTML = "";
    filtered.forEach(ticket => {
      const card = document.createElement("div");
      card.className = `admin-ticket-card ${adminActiveTicket && adminActiveTicket.id === ticket.id ? 'active' : ''}`;
      card.id = `admin-tcard-${isSuite ? 'suites' : 'cars'}-${ticket.id}`;
      card.onclick = () => (window as any).selectAdminTicket(ticket.id, isSuite ? 'suite' : 'vehicule');

      const isCar = ticket.type === 'vehicule' || !ticket.type;
      const icon = isCar ? 'fa-car-side' : 'fa-hotel';
      const statusLabel = ticket.status === 'confirmed' ? 'Validé' : ticket.status === 'cancelled' ? 'Refusé' : 'En attente';

      card.innerHTML = `
        <div class="admin-ticket-card-header">
          <span class="admin-ticket-client-name">${escapeHTML(ticket.client_name || 'Citoyen')}</span>
          <span class="status-pill ${escapeHTML(ticket.status || 'pending')}" style="font-size: 10px; padding: 2px 7px;">${statusLabel}</span>
        </div>
        <div class="admin-ticket-car-name">
          <i class="fa-solid ${icon}"></i>
          <span>${escapeHTML(ticket.item_name || (isCar ? 'Véhicule' : 'Hébergement'))}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #71717a; margin-top: 2px;">
          <span>#${escapeHTML(ticket.id.slice(0,6).toUpperCase())} &bull; ${escapeHTML(ticket.amount || 'Devis')}</span>
          <span>${ticket.created_at ? new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
        </div>
      `;
      listContainer.appendChild(card);
    });
  };

  (window as any).selectAdminTicket = async function (ticketId: any, category: any = null) {
    const ticket = adminAllTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    adminActiveTicket = ticket;
    const isSuite = (category === 'suite') || (ticket.type === 'suite');
    const pfx = isSuite ? 'suites' : 'cars';

    // Update active class on cards
    document.querySelectorAll(".admin-ticket-card").forEach(c => c.classList.remove("active"));
    const activeCard = document.getElementById(`admin-tcard-${pfx}-${ticketId}`);
    if (activeCard) activeCard.classList.add("active");

    const emptyState = document.getElementById(`admin-ticket-${pfx}-empty-state`);
    const activeView = document.getElementById(`admin-ticket-${pfx}-active-view`);
    if (emptyState) emptyState.style.display = "none";
    if (activeView) activeView.style.display = "flex";

    // Bind Header
    const titleEl = document.getElementById(`admin-active-ticket-${pfx}-title`);
    const badgeEl = document.getElementById(`admin-active-ticket-${pfx}-badge`);
    const clientEl = document.getElementById(`admin-active-ticket-${pfx}-client`);
    const idEl = document.getElementById(`admin-active-ticket-${pfx}-id`);
    const avatarEl = document.getElementById(`admin-active-ticket-${pfx}-avatar`);

    if (titleEl) titleEl.textContent = ticket.item_name || (isSuite ? "Hébergement" : "Véhicule");
    if (clientEl) clientEl.textContent = ticket.client_name || "Citoyen";
    if (idEl) idEl.textContent = `#${ticket.id.slice(0,6).toUpperCase()}`;
    if (avatarEl) avatarEl.textContent = (ticket.client_name || "C").slice(0, 2).toUpperCase();

    if (badgeEl) {
      badgeEl.className = `status-pill ${ticket.status || 'pending'}`;
      badgeEl.textContent = ticket.status === 'confirmed' ? 'Validé' : ticket.status === 'cancelled' ? 'Refusé' : 'En attente';
    }

    // Load Messages Stream
    const stream = document.getElementById(`admin-ticket-${pfx}-messages-stream`);
    if (stream) {
      stream.innerHTML = `<div style="text-align: center; color: #71717a; padding: 20px; font-size: 13px;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des échanges...</div>`;
      await loadAdminBookingMessages(ticket.id, stream);
    }

    // Setup Realtime Stream for this Ticket
    if (supabaseClient) {
      if (adminTicketRealtime) supabaseClient.removeChannel(adminTicketRealtime);
      adminTicketRealtime = supabaseClient
        .channel(`admin_ticket_${ticket.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'booking_messages', filter: `booking_id=eq.${ticket.id}` }, (payload: any) => {
          if (payload.new && stream) {
            appendMessageBubble(stream, payload.new);
          }
        })
        .subscribe();
    }

    // Auto-polling fallback for admin ticket stream every 2.5s
    if ((window as any).adminTicketPollingInterval) clearInterval((window as any).adminTicketPollingInterval);
    (window as any).adminTicketPollingInterval = setInterval(async () => {
      if (adminActiveTicket && document.getElementById(`admin-ticket-${pfx}-messages-stream`)) {
        const { data } = await supabaseClient
          .from("booking_messages")
          .select("*")
          .eq("booking_id", adminActiveTicket.id)
          .order("created_at", { ascending: true });
        if (data && data.length > 0) {
          const streamEl = document.getElementById(`admin-ticket-${pfx}-messages-stream`);
          data.forEach((m: any) => appendMessageBubble(streamEl, m));
        }
      }
    }, 2500);
  };

  (window as any).handleAdminTicketReply = async function (e: any, category: any = 'vehicule') {
    if (e) e.preventDefault();
    if (!adminActiveTicket) return;

    const isSuite = (category === 'suite') || (adminActiveTicket.type === 'suite');
    const pfx = isSuite ? 'suites' : 'cars';

    const input = document.getElementById(`admin-ticket-${pfx}-reply-input`) as HTMLInputElement | null;
    const stream = document.getElementById(`admin-ticket-${pfx}-messages-stream`);
    const sendBtn = document.getElementById(`admin-ticket-${pfx}-send-btn`) as HTMLButtonElement | null;
    if (!input) return;

    const content = input.value.trim();
    if (!content) return;

    const rawUser = localStorage.getItem("richman_user");
    const activeUser = rawUser ? JSON.parse(rawUser) : { name: "Staff Conciergerie" };

    input.value = "";
    input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    try {
      if (supabaseClient) {
        await supabaseClient.from("booking_messages").insert([{
          booking_id: adminActiveTicket.id,
          sender_name: activeUser.name || "Staff Richman",
          sender_id: activeUser.discord_id || null,
          sender_role: "staff",
          content: content
        }]);
      }

      // Propagate via Bot API (Web -> Discord Ticket)
      botFetch('/api/sync-booking-message', {
        method: "POST",
        body: JSON.stringify({
          booking_id: adminActiveTicket.id,
          discord_id: adminActiveTicket.discord_id || null,
          sender_name: activeUser.name || "Staff Richman",
          sender_role: "staff",
          content: content,
          skip_db_insert: true
        })
      }).catch(err => console.warn("Admin sync booking message error:", err));

      if (stream) {
        appendMessageBubble(stream, {
          sender_name: activeUser.name,
          sender_role: "staff",
          content: content,
          created_at: new Date().toISOString()
        });
      }

      showToast("Réponse transmise au client (Web & Ticket Discord) !", "success");
    } catch (err: any) {
      console.error(err);
      showToast("Erreur envoi réponse : " + err.message, "danger");
    } finally {
      input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
    }
  };

  (window as any).handleAdminTicketAction = async function (newStatus: any, category: any = 'vehicule') {
    if (!adminActiveTicket) return;
    try {
      await (window as any).updateBookingStatus(adminActiveTicket.id, newStatus);
      adminActiveTicket.status = newStatus;
      const isSuite = (category === 'suite') || (adminActiveTicket.type === 'suite');
      const pfx = isSuite ? 'suites' : 'cars';
      const badgeEl = document.getElementById(`admin-active-ticket-${pfx}-badge`);
      if (badgeEl) {
        badgeEl.className = `status-pill ${newStatus}`;
        badgeEl.textContent = newStatus === 'confirmed' ? 'Validé' : 'Refusé';
      }
      (window as any).loadAdminTickets(isSuite ? 'suite' : 'vehicule');
      showToast(`Dossier #${adminActiveTicket.id.slice(0,6).toUpperCase()} ${newStatus === 'confirmed' ? 'validé avec succès' : 'refusé'}.`, "success");
    } catch (e) {
      console.error(e);
      showToast("Erreur lors de la mise à jour du statut.", "danger");
    }
  };

  (window as any).handleAdminCloseTicket = async function (category: any = 'vehicule') {
    if (!adminActiveTicket) return;

    const isSuite = (category === 'suite') || (adminActiveTicket.type === 'suite');
    const pfx = isSuite ? 'suites' : 'cars';

    const confirmed = await (window as any).showConfirmDialog({
      title: "Fermer & Supprimer le Ticket",
      message: `Êtes-vous certain de vouloir fermer et supprimer le ticket <strong>#${adminActiveTicket.id.slice(0, 6).toUpperCase()}</strong> (${escapeHTML(adminActiveTicket.item_name || 'Réservation')}) ?<br><br><span style="color: #f87171; font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> Le dossier sera supprimé du site et le salon Discord associé sera également détruit.</span>`,
      confirmText: "Fermer & Supprimer",
      cancelText: "Annuler",
      icon: "fa-solid fa-trash-can",
      isDanger: true
    });

    if (!confirmed) return;

    try {
      const ticketId = adminActiveTicket.id;
      const discordId = adminActiveTicket.discord_id;

      // 1. Delete messages & booking in Supabase
      if (supabaseClient) {
        await supabaseClient.from("booking_messages").delete().eq("booking_id", ticketId);
        await supabaseClient.from("bookings").delete().eq("id", ticketId);
      }

      // 2. Call Bot API to delete/close ticket channel on Discord
      botFetch('/api/close-ticket', {
        method: "POST",
        body: JSON.stringify({
          booking_id: ticketId,
          discord_id: discordId || null
        })
      }).catch(err => console.warn("Close ticket API error:", err));

      // 3. Reset Active Ticket View
      adminActiveTicket = null;
      const emptyState = document.getElementById(`admin-ticket-${pfx}-empty-state`);
      const activeView = document.getElementById(`admin-ticket-${pfx}-active-view`);
      if (emptyState) emptyState.style.display = "flex";
      if (activeView) activeView.style.display = "none";

      // 4. Reload admin tickets list and bookings
      if (typeof (window as any).loadAdminTickets === 'function') {
        (window as any).loadAdminTickets(isSuite ? 'suite' : 'vehicule');
      }
      if (typeof (window as any).loadBookings === 'function') {
        (window as any).loadBookings();
      }

      showToast(`Ticket #${ticketId.slice(0, 6).toUpperCase()} supprimé avec succès sur Discord & Web !`, "success");
    } catch (e: any) {
      console.error(e);
      showToast("Erreur lors de la suppression du ticket : " + e.message, "danger");
    }
  };

  // Immediate Local Header Nav Pill Update on DOMContentLoaded
  const savedUser = localStorage.getItem("richman_user");
  if (savedUser) {
    try {
      const u = JSON.parse(savedUser);
      const isOwnerLocal = localStorage.getItem("richman_is_owner") === "true";
      const targetHref = isOwnerLocal ? "admin.html" : "client.html";
      renderHeaderNavUserPill(u.name, u.avatar, targetHref);

      // Restore admin user card details immediately on load (supports /admin and /admin.html)
      if (document.getElementById("admin-user-avatar") || window.location.pathname.includes("admin")) {
        bindAdminUserCardDetails(u.name, u.avatar, isOwnerLocal);
      }
    } catch (e) { console.error(e); }
  }

  // Initialize Client Portal on page load
  if (document.getElementById("client-portal-main") || window.location.pathname.includes("client.html")) {
    initClientPortal();
  }

  // Initialize Interactive Geist Pixel Matrix & Luxury Atmosphere Background
  initRichmanMatrixBackground();
});
