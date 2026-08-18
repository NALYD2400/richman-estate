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

export async function loadAdminTickets(typeCategory: any = null) {
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

    if (typeof (window as any).filterAdminTicketsList === 'function') {
      (window as any).filterAdminTicketsList('vehicule');
      (window as any).filterAdminTicketsList('suite');
    }

    // If active ticket is selected, re-sync it
    if (adminActiveTicket) {
      const refreshed = adminAllTickets.find(t => t.id === adminActiveTicket.id);
      if (refreshed && typeof (window as any).selectAdminTicket === 'function') {
        const category = (refreshed.type === 'suite') ? 'suite' : 'vehicule';
        (window as any).selectAdminTicket(refreshed.id, category);
      }
    }
  } catch (e) {
    console.error("Error loading admin tickets:", e);
    if (carsListContainer) carsListContainer.innerHTML = `<div style="color: #fca5a5; text-align: center; padding: 20px;">Erreur de chargement.</div>`;
    if (suitesListContainer) suitesListContainer.innerHTML = `<div style="color: #fca5a5; text-align: center; padding: 20px;">Erreur de chargement.</div>`;
  }
}

(window as any).loadAdminTickets = loadAdminTickets;

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
    const activeUser = rawUser ? JSON.parse(rawUser) : { name: "Staff Richman" };
    const pendingKey = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    input.value = "";
    input.disabled = true;

    // Instant optimistic bubble append
    if (container) {
      appendMessageBubble(container, {
        temp_key: pendingKey,
        sender_name: activeUser.name || "Staff Richman",
        sender_role: "staff",
        content: content,
        created_at: new Date().toISOString()
      });
    }

    try {
      let insertedMsg: any = null;
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from("booking_messages")
          .insert([{
            booking_id: bId,
            sender_name: activeUser.name || "Staff Richman",
            sender_id: activeUser.discord_id || null,
            sender_role: "staff",
            content: content
          }])
          .select()
          .single();

        if (error) throw error;
        insertedMsg = data;
      }

      if (insertedMsg && insertedMsg.id && container) {
        const pendingRow = container.querySelector(`[data-pending-key="${pendingKey}"]`);
        if (pendingRow) {
          pendingRow.setAttribute("data-msg-id", String(insertedMsg.id));
          pendingRow.removeAttribute("data-pending-key");
        }
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

      showToast("Message envoyé au client (Site & Discord) !", "success");
    } catch (err: any) {
      console.error(err);
      if (container) {
        const pendingRow = container.querySelector(`[data-pending-key="${pendingKey}"]`);
        if (pendingRow) pendingRow.remove();
      }
      showToast("Erreur envoi message : " + err.message, "danger");
    } finally {
      input.disabled = false;
      input.focus();
    }
  };

  // ==========================================================================
  // Admin VIP Tickets & Concierge Live Chat Hub Controller
  // ==========================================================================


  function isRentalOverdue(ticket: any): boolean {
    if (!ticket || ticket.status !== 'confirmed') return false;
    const createdDate = ticket.created_at ? new Date(ticket.created_at).getTime() : Date.now();
    const durationDays = parseInt(String(ticket.duration || '1'), 10) || 1;
    const durationMs = durationDays * 24 * 60 * 60 * 1000;
    return Date.now() >= (createdDate + durationMs);
  }

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

    if (statusVal === "overdue") {
      filtered = filtered.filter(t => isRentalOverdue(t));
    } else if (statusVal !== "all") {
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
      const isOverdue = isRentalOverdue(ticket);
      
      let statusLabel = ticket.status === 'confirmed'
        ? (isSuite ? 'Séjour en cours' : 'En circulation')
        : (ticket.status === 'completed'
            ? (isSuite ? 'Check-out' : 'Restitué')
            : (ticket.status === 'closed'
                ? 'Archivé'
                : (ticket.status === 'cancelled' ? 'Refusé' : 'En attente')));
      let pillClass = ticket.status || 'pending';
      if (isOverdue) {
        statusLabel = isSuite ? '⏰ À Libérer' : '⏰ À Récupérer';
        pillClass = 'cancelled';
      }

      card.innerHTML = `
        <div class="admin-ticket-card-header">
          <span class="admin-ticket-client-name">${escapeHTML(ticket.client_name || 'Citoyen')}</span>
          <span class="status-pill ${pillClass}" style="font-size: 10px; padding: 2px 7px; ${isOverdue ? 'background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; font-weight: 700;' : ''}">${statusLabel}</span>
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

    // Auto-select first ticket if none active or active not in current list
    if ((!adminActiveTicket || !filtered.some(t => t.id === adminActiveTicket.id)) && filtered.length > 0) {
      setTimeout(() => {
        if (!adminActiveTicket || !filtered.some(t => t.id === adminActiveTicket.id)) {
          (window as any).selectAdminTicket(filtered[0].id, isSuite ? 'suite' : 'vehicule');
        }
      }, 50);
    }
  };

  (window as any).selectAdminTicket = async function (ticketId: any, category: any = null) {
    const ticket = adminAllTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    adminActiveTicket = ticket;
    (window as any).adminActiveTicket = ticket;
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

    const isOverdue = isRentalOverdue(ticket);
    const statusLabel = isOverdue
      ? (isSuite ? '⏰ Échéance dépassée (À libérer)' : '⏰ Échéance dépassée (À récupérer)')
      : (ticket.status === 'confirmed'
          ? (isSuite ? 'Séjour en cours' : 'En circulation')
          : (ticket.status === 'completed'
              ? (isSuite ? 'Check-out effectué' : 'Restitué')
              : (ticket.status === 'closed'
                  ? 'Archivé'
                  : (ticket.status === 'cancelled' ? 'Refusé' : 'En attente'))));

    if (badgeEl) {
      badgeEl.className = `status-pill ${isOverdue ? 'cancelled' : (ticket.status || 'pending')}`;
      badgeEl.textContent = statusLabel;
    }

    const returnBtn = document.getElementById(`btn-admin-return-ticket-${pfx}`);
    const acceptBtn = document.getElementById(`btn-admin-accept-ticket-${pfx}`);
    const refuseBtn = document.getElementById(`btn-admin-refuse-ticket-${pfx}`);
    const closeBtn = document.getElementById(`btn-admin-close-ticket-${pfx}`);
    const hardDeleteBtn = document.getElementById(`btn-admin-hard-delete-ticket-${pfx}`);

    const isOwner = localStorage.getItem("richman_is_owner") === "true" ||
                    localStorage.getItem("richman_role") === "owner" ||
                    localStorage.getItem("richman_role") === "founder" ||
                    localStorage.getItem("richman_role") === "fondateur";

    if (returnBtn) returnBtn.style.display = (ticket.status === 'confirmed') ? 'inline-flex' : 'none';
    if (acceptBtn) acceptBtn.style.display = (ticket.status === 'pending') ? 'inline-flex' : 'none';
    if (refuseBtn) refuseBtn.style.display = (ticket.status === 'pending') ? 'inline-flex' : 'none';
    if (closeBtn) closeBtn.style.display = (ticket.status !== 'closed') ? 'inline-flex' : 'none';
    if (hardDeleteBtn) {
      hardDeleteBtn.style.display = (isOwner && (ticket.status === 'closed' || ticket.status === 'completed' || ticket.status === 'cancelled'))
        ? 'inline-flex'
        : 'none';
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
    const activeUser = rawUser ? JSON.parse(rawUser) : { name: "Staff Richman" };
    const pendingKey = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    input.value = "";
    input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    // Instant optimistic bubble append
    if (stream) {
      appendMessageBubble(stream, {
        temp_key: pendingKey,
        sender_name: activeUser.name || "Staff Richman",
        sender_role: "staff",
        content: content,
        created_at: new Date().toISOString()
      });
    }

    try {
      let insertedMsg: any = null;
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from("booking_messages")
          .insert([{
            booking_id: adminActiveTicket.id,
            sender_name: activeUser.name || "Staff Richman",
            sender_id: activeUser.discord_id || null,
            sender_role: "staff",
            content: content
          }])
          .select()
          .single();

        if (error) throw error;
        insertedMsg = data;
      }

      if (insertedMsg && insertedMsg.id && stream) {
        const pendingRow = stream.querySelector(`[data-pending-key="${pendingKey}"]`);
        if (pendingRow) {
          pendingRow.setAttribute("data-msg-id", String(insertedMsg.id));
          pendingRow.removeAttribute("data-pending-key");
        }
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

      showToast("Réponse transmise au client (Web & Ticket Discord) !", "success");
    } catch (err: any) {
      console.error(err);
      if (stream) {
        const pendingRow = stream.querySelector(`[data-pending-key="${pendingKey}"]`);
        if (pendingRow) pendingRow.remove();
      }
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
      (window as any).selectAdminTicket(adminActiveTicket.id, isSuite ? 'suite' : 'vehicule');
      (window as any).loadAdminTickets(isSuite ? 'suite' : 'vehicule');
      if (typeof (window as any).loadBookings === 'function') (window as any).loadBookings();
      showToast(`Dossier #${adminActiveTicket.id.slice(0,6).toUpperCase()} ${newStatus === 'confirmed' ? 'validé (en circulation)' : 'refusé'}.`, "success");
    } catch (e) {
      console.error(e);
      showToast("Erreur lors de la mise à jour du statut.", "danger");
    }
  };

  (window as any).handleAdminValidateReturn = async function (category: any = 'vehicule') {
    if (!adminActiveTicket) return;

    const isSuite = (category === 'suite') || (adminActiveTicket.type === 'suite');
    const itemName = adminActiveTicket.item_name || (isSuite ? 'Hébergement' : 'Véhicule');
    const clientName = adminActiveTicket.client_name || 'Citoyen';

    const confirmed = await (window as any).showConfirmDialog({
      title: isSuite ? "Valider le Check-out de la Suite" : "Valider le Retour du Véhicule",
      message: `Confirmer la restitution de <strong>${escapeHTML(itemName)}</strong> loué par <strong>${escapeHTML(clientName)}</strong> ?<div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px; padding: 10px 14px; margin-top: 14px; text-align: left; display: flex; align-items: flex-start; gap: 10px; font-size: 12.5px; color: #6ee7b7; line-height: 1.45;"><i class="fa-solid fa-circle-check" style="margin-top: 2px; font-size: 14px; flex-shrink: 0; color: #34d399;"></i><div>L'élément sera immédiatement remis en disponibilité dans le showroom, la caution sera libérée et le dossier passera en statut Restitué.</div></div>`,
      confirmText: isSuite ? "Valider le Check-out" : "Valider le Retour",
      cancelText: "Annuler",
      icon: isSuite ? "fa-solid fa-key" : "fa-solid fa-rotate-left",
      isDanger: false
    });

    if (!confirmed) return;

    try {
      await (window as any).updateBookingStatus(adminActiveTicket.id, 'completed');
      adminActiveTicket.status = 'completed';

      // Insert return confirmation message into chat stream & sync to Discord
      const rawUser = localStorage.getItem("richman_user");
      const activeUser = rawUser ? JSON.parse(rawUser) : { name: "Staff Richman" };
      const returnMsgContent = isSuite
        ? `🔑 **Check-out validé** : L'hébergement ${itemName} a été libéré et inspecté par le staff. Le séjour est clôturé avec succès.`
        : `🔄 **Retour validé** : Le véhicule ${itemName} a été inspecté et restitué à la flotte Richman Estate. La caution est débloquée et la location est clôturée.`;

      if (supabaseClient) {
        await supabaseClient.from("booking_messages").insert([{
          booking_id: adminActiveTicket.id,
          sender_name: activeUser.name || "Staff Richman",
          sender_id: activeUser.discord_id || null,
          sender_role: "staff",
          content: returnMsgContent
        }]);
      }

      botFetch('/api/sync-booking-message', {
        method: "POST",
        body: JSON.stringify({
          booking_id: adminActiveTicket.id,
          discord_id: adminActiveTicket.discord_id || null,
          sender_name: activeUser.name || "Staff Richman",
          sender_role: "staff",
          content: returnMsgContent,
          skip_db_insert: true
        })
      }).catch(() => {});

      // Refresh views
      (window as any).selectAdminTicket(adminActiveTicket.id, isSuite ? 'suite' : 'vehicule');
      (window as any).loadAdminTickets(isSuite ? 'suite' : 'vehicule');
      if (typeof (window as any).loadBookings === 'function') (window as any).loadBookings();

      showToast(`Restitution de ${itemName} validée avec succès !`, "success");
    } catch (e: any) {
      console.error(e);
      showToast("Erreur lors de la validation du retour : " + e.message, "danger");
    }
  };

  (window as any).handleAdminCloseTicket = async function (category: any = 'vehicule') {
    if (!adminActiveTicket) return;

    const isSuite = (category === 'suite') || (adminActiveTicket.type === 'suite');
    const ticketId = adminActiveTicket.id;
    const discordId = adminActiveTicket.discord_id;
    const itemName = adminActiveTicket.item_name || 'Prestation';

    const confirmed = await (window as any).showConfirmDialog({
      title: "Clôturer & Archiver le Dossier",
      message: `Êtes-vous certain de vouloir clôturer le dossier <strong>#${ticketId.slice(0, 6).toUpperCase()}</strong> (${escapeHTML(itemName)}) ?<div style="background: rgba(96, 165, 250, 0.08); border: 1px solid rgba(96, 165, 250, 0.25); border-radius: 10px; padding: 10px 14px; margin-top: 14px; text-align: left; display: flex; align-items: flex-start; gap: 10px; font-size: 12.5px; color: #93c5fd; line-height: 1.45;"><i class="fa-solid fa-box-archive" style="margin-top: 2px; font-size: 14px; flex-shrink: 0; color: #60a5fa;"></i><div>Le salon Discord sera supprimé, mais le dossier restera <strong>archivé en base</strong> avec sa facture accessible dans l'Espace Client.</div></div>`,
      confirmText: "Clôturer & Archiver",
      cancelText: "Annuler",
      icon: "fa-solid fa-box-archive",
      isDanger: false
    });

    if (!confirmed) return;

    try {
      // 1. Mark as closed in Supabase (NO DATA LOSS: preserve booking & messages for client invoice & admin analytics)
      await (window as any).updateBookingStatus(ticketId, 'closed');
      adminActiveTicket.status = 'closed';

      // 2. Call Bot API to delete temporary Discord channel
      botFetch('/api/close-ticket', {
        method: "POST",
        body: JSON.stringify({
          booking_id: ticketId,
          discord_id: discordId || null
        })
      }).catch(err => console.warn("Close ticket API error:", err));

      // 3. Update view
      (window as any).selectAdminTicket(ticketId, isSuite ? 'suite' : 'vehicule');
      (window as any).loadAdminTickets(isSuite ? 'suite' : 'vehicule');
      if (typeof (window as any).loadBookings === 'function') (window as any).loadBookings();

      showToast(`Dossier #${ticketId.slice(0, 6).toUpperCase()} archivé avec succès !`, "success");
    } catch (e: any) {
      console.error(e);
      showToast("Erreur lors de la clôture du dossier : " + e.message, "danger");
    }
  };

  (window as any).handleAdminHardDeleteTicket = async function (category: any = 'vehicule') {
    if (!adminActiveTicket) return;

    const isOwner = localStorage.getItem("richman_is_owner") === "true" ||
                    localStorage.getItem("richman_role") === "owner" ||
                    localStorage.getItem("richman_role") === "founder" ||
                    localStorage.getItem("richman_role") === "fondateur";

    if (!isOwner) {
      showToast("Action réservée exclusivement aux Fondateurs.", "warning");
      return;
    }

    const isSuite = (category === 'suite') || (adminActiveTicket.type === 'suite');
    const pfx = isSuite ? 'suites' : 'cars';
    const ticketId = adminActiveTicket.id;
    const discordId = adminActiveTicket.discord_id;
    const itemName = adminActiveTicket.item_name || 'Dossier';

    const confirmed = await (window as any).showConfirmDialog({
      title: "⚠️ Suppression Définitive (Fondateur)",
      message: `Êtes-vous certain de vouloir <strong>supprimer définitivement</strong> le dossier <strong>#${ticketId.slice(0, 6).toUpperCase()}</strong> (${escapeHTML(itemName)}) ?<div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 10px; padding: 10px 14px; margin-top: 14px; text-align: left; display: flex; align-items: flex-start; gap: 10px; font-size: 12.5px; color: #fca5a5; line-height: 1.45;"><i class="fa-solid fa-triangle-exclamation" style="margin-top: 2px; font-size: 14px; flex-shrink: 0; color: #ef4444;"></i><div><strong>Action irréversible :</strong> Le dossier, tous les messages de discussion et la facture seront définitivement supprimés de la base de données.</div></div>`,
      confirmText: "Supprimer Définitivement",
      cancelText: "Annuler",
      icon: "fa-solid fa-trash-can",
      isDanger: true
    });

    if (!confirmed) return;

    try {
      // 1. Delete messages & booking in Supabase
      if (supabaseClient) {
        await supabaseClient.from("booking_messages").delete().eq("booking_id", ticketId);
        await supabaseClient.from("bookings").delete().eq("id", ticketId);
      }

      // 2. Call Bot API to delete temporary Discord channel if it still exists
      botFetch('/api/close-ticket', {
        method: "POST",
        body: JSON.stringify({
          booking_id: ticketId,
          discord_id: discordId || null
        })
      }).catch(() => {});

      // 3. Reset Active Ticket View
      adminActiveTicket = null;
      (window as any).adminActiveTicket = null;
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

      showToast(`Dossier #${ticketId.slice(0, 6).toUpperCase()} définitivement supprimé de la base.`, "success");
    } catch (e: any) {
      console.error(e);
      showToast("Erreur lors de la suppression définitive : " + e.message, "danger");
    }
  };

  (window as any).handleAdminOpenInvoice = function(category: string = 'vehicule') {
    let ticket = adminActiveTicket || (window as any).adminActiveTicket;
    if (!ticket || !ticket.id) {
      const isSuite = category === 'suite';
      ticket = adminAllTickets.find(t => isSuite ? t.type === 'suite' : (t.type === 'vehicule' || !t.type));
      if (ticket) {
        adminActiveTicket = ticket;
        (window as any).adminActiveTicket = ticket;
      }
    }
    if (!ticket || !ticket.id) {
      showToast("Veuillez sélectionner un dossier de location dans la liste.", "warning");
      return;
    }
    if (typeof (window as any).openInvoiceModal === 'function') {
      (window as any).openInvoiceModal(ticket);
    } else {
      showToast("Génération de la facture en cours...", "info");
      import('./16-invoice-system').then(m => m.openInvoiceModal(ticket));
    }
  };

  (window as any).openDiscordTicketChannel = async function(category: string = 'vehicule') {
    let ticket = adminActiveTicket || (window as any).adminActiveTicket;
    if (!ticket || !ticket.id) {
      const isSuite = category === 'suite';
      ticket = adminAllTickets.find(t => isSuite ? t.type === 'suite' : (t.type === 'vehicule' || !t.type));
      if (ticket) {
        adminActiveTicket = ticket;
        (window as any).adminActiveTicket = ticket;
      }
    }

    if (!ticket || !ticket.id) {
      showToast("Veuillez sélectionner un ticket d'abord", "warning");
      return;
    }

    const bookingId = ticket.id;
    const discordId = ticket.discord_id || '';
    const clientName = ticket.client_name || '';
    const directChannelId = ticket.ticket_channel_id;

    // Open target window synchronously on user click to avoid modern browser popup blockers
    const win = window.open('about:blank', '_blank');

    if (directChannelId) {
      const targetUrl = `https://discord.com/channels/1537171063715401870/${directChannelId}`;
      if (win) {
        win.location.href = targetUrl;
      } else {
        window.open(targetUrl, '_blank');
      }
      showToast("Ouverture du salon Discord...", "success");
      return;
    }

    if (win) {
      try {
        win.document.title = "Ouverture du salon Discord...";
        win.document.body.innerHTML = `
          <div style="background:#09090b;color:#a1a1aa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="font-size:16px;color:#fff;font-weight:600;margin-bottom:8px;">Redirection vers Discord...</div>
            <div style="font-size:13px;">Recherche du salon #${bookingId.slice(0,6).toUpperCase()} en cours...</div>
          </div>
        `;
      } catch (e) {}
    }

    showToast("Recherche du salon Discord en cours...", "info");

    try {
      const q = new URLSearchParams({
        booking_id: bookingId,
        discord_id: discordId,
        client_name: clientName
      });
      const res = await botFetch(`/api/get-ticket-channel?${q.toString()}`);
      const data = await res.json();
      const targetUrl = (res.ok && data.success && data.url)
        ? data.url
        : (data.fallbackUrl || 'https://discord.com/channels/1537171063715401870');

      if (res.ok && data.success && data.channelId) {
        ticket.ticket_channel_id = data.channelId;
        if (adminActiveTicket) adminActiveTicket.ticket_channel_id = data.channelId;
      }

      if (win) {
        win.location.href = targetUrl;
      } else {
        window.open(targetUrl, '_blank');
      }
    } catch (err: any) {
      const fallback = 'https://discord.com/channels/1537171063715401870';
      if (win) win.location.href = fallback;
      else window.open(fallback, '_blank');
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

  // Realtime Live Sync: update tickets and bookings across admin whenever updated from Discord
  if (supabaseClient) {
    supabaseClient
      .channel('admin_global_bookings_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        loadAdminTickets();
        if (typeof (window as any).loadBookings === 'function') {
          (window as any).loadBookings();
        }
      })
      .subscribe();
  }
});
