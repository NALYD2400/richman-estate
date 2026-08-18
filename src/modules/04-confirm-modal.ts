/* ==========================================================================
   Richman Estate — 04-confirm-modal.ts
   Modale de confirmation luxe universelle (auto-injectée)
   Porté de 04-confirm-modal.js (découpage historique de main.js).

   Note de portage : usersCache / uploadedImagesArray / uploadedSuiteImagesArray
   passent par `state` (core/state). Les références `adminModalForm` /
   `suiteModalForm` (alias window des captures de 02-admin-crud) sont
   remplacées par des lookups getElementById locaux — mêmes nœuds DOM.
   `loadBookings()` (défini dans 02, hors carte d'exports, sans affectation
   window dans la source) est appelé via (window as any), fidèle à la
   résolution globale d'origine. Les blocs Object.defineProperty(window, ...)
   « Exports inter-parties » sont supprimés conformément au contrat.
   ========================================================================== */

import { escapeHTML, setSafeInnerHTML } from "../core/sanitize";
import { supabaseClient } from "../core/supabase";
import { botFetch } from "../core/api";
import { state } from "../core/state";
import {
  applyFleetFilters,
  applySuitesFilters,
  closeModal,
  closeSuiteModal,
  loadBookings,
  loadConciergeMessages,
  loadLogs,
  loadSuites,
  loadVehicles,
  showToast,
  writeLog
} from "./02-admin-crud";
import { applyUsersFilters, loadUsers } from "./03-admin-users";

document.addEventListener("DOMContentLoaded", () => {
// ==========================================================================
// Custom Luxury Confirm Modal Helper (Universal Self-Injecting)
// ==========================================================================
function showConfirmDialog({
  title = "Confirmer l'action",
  message = "Êtes-vous certain de vouloir continuer ?",
  confirmText = "Confirmer",
  cancelText = "Annuler",
  icon = "fa-solid fa-triangle-exclamation",
  isDanger = true
} = {}) {
  return new Promise((resolve) => {
    let overlay = document.getElementById("confirm-modal-overlay");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "admin-modal-overlay";
      overlay.id = "confirm-modal-overlay";
      overlay.style.zIndex = "10000";
      overlay.setAttribute("aria-hidden", "true");
      overlay.innerHTML = `
        <div class="admin-modal" style="max-width: 440px; text-align: center; padding: 28px 24px 24px; background: #0e0e12; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; box-shadow: 0 25px 60px rgba(0,0,0,0.8);">
          <div id="confirm-modal-icon-wrap" style="width: 58px; height: 58px; margin: 0 auto 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px;">
            <i id="confirm-modal-icon" class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <h3 id="confirm-modal-title" style="margin: 0 0 8px 0; font-size: 18px; color: #ffffff; font-weight: 700;"></h3>
          <p id="confirm-modal-message" style="margin: 0 0 24px 0; font-size: 13.5px; color: #a1a1aa; line-height: 1.5;"></p>
          <div style="display: flex; gap: 12px;">
            <button type="button" id="confirm-modal-cancel-btn" style="flex: 1; height: 44px; border-radius: 12px; font-weight: 600; font-size: 13.5px; background: #1a1a22; border: 1px solid rgba(255,255,255,0.1); color: #e4e4e7; cursor: pointer;">Annuler</button>
            <button type="button" id="confirm-modal-action-btn" style="flex: 1; height: 44px; border-radius: 12px; font-weight: 600; font-size: 13.5px; justify-content: center; color: #ffffff; border: none; cursor: pointer;">Confirmer</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const titleEl = document.getElementById("confirm-modal-title");
    const msgEl = document.getElementById("confirm-modal-message");
    const iconEl = document.getElementById("confirm-modal-icon");
    const iconWrap = document.getElementById("confirm-modal-icon-wrap");
    const cancelBtn = document.getElementById("confirm-modal-cancel-btn");
    const actionBtn = document.getElementById("confirm-modal-action-btn");

    if (titleEl) titleEl.textContent = title;
    if (msgEl) setSafeInnerHTML(msgEl, message);
    if (iconEl) iconEl.className = icon;
    if (cancelBtn) cancelBtn.textContent = cancelText;
    if (actionBtn) {
      actionBtn.textContent = confirmText;
      actionBtn.style.background = isDanger ? "#dc2626" : "var(--accent-gold, #c5a880)";
      actionBtn.style.boxShadow = isDanger ? "0 4px 14px rgba(220, 38, 38, 0.4)" : "0 4px 14px rgba(197, 168, 128, 0.4)";
    }
    if (iconWrap) {
      iconWrap.style.color = isDanger ? "#ef4444" : "#c5a880";
      iconWrap.style.background = isDanger ? "rgba(239, 68, 68, 0.12)" : "rgba(197, 168, 128, 0.12)";
      iconWrap.style.border = isDanger ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(197, 168, 128, 0.3)";
    }

    const cleanup = () => {
      if (document.activeElement && overlay!.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      overlay!.classList.remove("active");
      overlay!.setAttribute("aria-hidden", "true");
      cancelBtn!.onclick = null;
      actionBtn!.onclick = null;
      overlay!.onclick = null;
    };

    cancelBtn!.onclick = () => {
      cleanup();
      resolve(false);
    };

    actionBtn!.onclick = () => {
      cleanup();
      resolve(true);
    };

    overlay!.onclick = (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(false);
      }
    };

    overlay!.classList.add("active");
    overlay!.removeAttribute("aria-hidden");
  });
}
(window as any).showConfirmDialog = showConfirmDialog;

(window as any).deleteUserProfile = async function(userId, userName) {
  const profile = (state.usersCache || []).find(u => u.id === userId);
  const targetName = userName || (profile ? (profile.full_name || 'Citoyen RP') : 'Citoyen RP');

  const confirmed = await showConfirmDialog({
    title: "Supprimer le compte citoyen",
    message: `Voulez-vous vraiment supprimer le compte du citoyen <strong style="color: #ffffff;">${escapeHTML(targetName)}</strong> ?<br><br><span style="color: #f87171; font-size: 12px;"><i class="fa-solid fa-triangle-exclamation" style="margin-right: 4px;"></i> Cette action est irréversible et supprimera l'ensemble de ses accès.</span>`,
    confirmText: "Supprimer définitivement",
    cancelText: "Annuler",
    isDanger: true
  });
  if (!confirmed) return;
  if (!supabaseClient) return;

  const { error } = await supabaseClient.from("profiles").delete().eq("id", userId);
  if (error) {
    showToast("Erreur de suppression : " + error.message, "danger");
  } else {
    showToast(`Compte de "${targetName}" supprimé avec succès !`, "success");
    const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");
    await writeLog(`Suppression du compte citoyen: ${targetName} (ID: ${userId})`, activeUser.name || 'Fondateur', 'danger');
    loadUsers();
  }
};

// Window actions
(window as any).deleteItem = async function(id, type) {
  const isFleet = type === 'fleet';
  const confirmed = await showConfirmDialog({
    title: isFleet ? "Supprimer le véhicule" : "Supprimer la suite",
    message: `Voulez-vous vraiment retirer cet élément de la flotte active ?`,
    confirmText: "Supprimer",
    cancelText: "Annuler",
    isDanger: true
  });
  if (!confirmed) return;
  const tableName = isFleet ? 'vehicules' : 'suites';
  const { error } = await supabaseClient.from(tableName).delete().eq("id", id);
  if (error) {
    showToast("Erreur de suppression : " + error.message, 'danger');
  } else {
    showToast("Élément supprimé avec succès !", 'success');
    const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");
    await writeLog("Suppression élément ID: " + id + " (" + type + ")", activeUser.name || 'Fondateur', 'danger');
    if (isFleet) {
      loadVehicles();
      botFetch('/api/delete-fleet-vehicle-message', {
        method: 'POST',
        body: JSON.stringify({ vehicleId: id })
      }).catch(() => {});
    } else {
      loadSuites();
      botFetch('/api/delete-hotel-suite-message', {
        method: 'POST',
        body: JSON.stringify({ suiteId: id })
      }).catch(() => {});
    }
    loadLogs();
  }
};

(window as any).updateBookingStatus = async function(id, status) {
  if (!supabaseClient) return;

  // Retrieve booking details first
  const { data: bookingData } = await supabaseClient.from("bookings").select("*").eq("id", id).maybeSingle();

  const { error } = await supabaseClient.from("bookings").update({ status }).eq("id", id);
  if (error) {
    showToast("Erreur de mise à jour : " + error.message, 'danger');
    return;
  }

  const isRented = status === 'confirmed';
  const label = status === 'confirmed'
    ? 'Validée (En circulation)'
    : (status === 'completed'
        ? 'Location terminée & Restitution effectuée'
        : (status === 'closed' ? 'Dossier archivé' : 'Demande refusée'));

  showToast(`Réservation mise à jour : ${label}`, 'success');

  // If booking confirmed -> item becomes rented; if cancelled/completed/closed -> item returns to confirmed (disponible)
  if (bookingData) {
    const itemTargetStatus = isRented ? 'rented' : 'confirmed';
    if (bookingData.type === 'vehicule' || !bookingData.type) {
      const { data: vMatch } = await supabaseClient.from("vehicules").select("id").ilike("name", `%${bookingData.item_name}%`).limit(1);
      if (vMatch && vMatch.length > 0) {
        (window as any).updateItemStatus(vMatch[0].id, 'fleet', itemTargetStatus);
      }
    } else if (bookingData.type === 'suite') {
      const { data: sMatch } = await supabaseClient.from("suites").select("id").ilike("name", `%${bookingData.item_name}%`).limit(1);
      if (sMatch && sMatch.length > 0) {
        (window as any).updateItemStatus(sMatch[0].id, 'suites', itemTargetStatus);
      }
    }

    // Sync status action to Discord Ticket Channel, Send DM & Sync Supabase Chat
    const rawUser = localStorage.getItem("richman_user");
    const activeUser = rawUser ? JSON.parse(rawUser) : null;
    const staffName = (activeUser && activeUser.name) ? activeUser.name : 'Staff Richman';

    botFetch('/api/sync-booking-status-action', {
      method: 'POST',
      body: JSON.stringify({
        booking_id: bookingData.id,
        status: status,
        client_name: bookingData.client_name,
        item_name: bookingData.item_name,
        type: bookingData.type || 'vehicule',
        discord_id: bookingData.discord_id || '',
        staff_name: staffName
      })
    }).catch(err => console.warn("Discord sync booking status error:", err));
  }

  loadBookings();
  loadConciergeMessages();
  loadLogs();
};

(window as any).updateItemStatus = async function(id, type, status) {
  const cleanStatus = (status === 'rented') ? 'rented' : 'confirmed';

  // Call Security Definer RPC first for guaranteed update
  const { data: rpcRes, error: rpcErr } = await supabaseClient.rpc('sync_item_status', {
    p_type: type,
    p_id: id,
    p_status: cleanStatus
  });

  if (rpcErr) {
    const tableName = type === 'fleet' ? 'vehicules' : 'suites';
    const { error } = await supabaseClient.from(tableName).update({ status: cleanStatus }).eq("id", id);
    if (error) {
      showToast("Erreur de mise à jour : " + error.message, 'danger');
      return;
    }
  }

  showToast("Statut mis à jour avec succès !", 'success');
  const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");
  await writeLog(`Maj statut ${type} ID: ${id} -> ${cleanStatus}`, activeUser.name || 'Staff Richman', 'success');
  if (type === 'fleet') {
    loadVehicles();
    // Real-time in-place edit on Discord (#flotte-disponible)
    botFetch('/api/update-fleet-vehicle-status', {
      method: 'POST',
      body: JSON.stringify({ vehicleId: id, status: cleanStatus })
    }).catch(() => {});
  } else {
    loadSuites();
    // Real-time in-place edit on Discord (#reservations-hotel)
    botFetch('/api/update-hotel-suite-status', {
      method: 'POST',
      body: JSON.stringify({ suiteId: id, status: cleanStatus })
    }).catch(() => {});
  }
  loadLogs();
};

// Modal Submission (Insert to DB)
const adminModalForm = document.getElementById("admin-modal-form") as HTMLFormElement | null;
if (adminModalForm) {
  adminModalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = 'fleet'; // Hardcoded since modal is only for vehicles now
    const name = (document.getElementById('item-name') as HTMLInputElement).value;
    const price = (document.getElementById('item-price') as HTMLInputElement).value;
    const specs = (document.getElementById('item-specs') as HTMLInputElement).value;
    const status = (document.getElementById('item-status') as HTMLSelectElement).value;

    let mediaVal = "";
    if (state.uploadedImagesArray && state.uploadedImagesArray.length > 0) {
      mediaVal = state.uploadedImagesArray.length === 1 ? state.uploadedImagesArray[0] : JSON.stringify(state.uploadedImagesArray);
    } else {
      const rawUrl = ((document.getElementById('item-media-url-input') as HTMLInputElement | null)?.value || (document.getElementById('item-media-url') as HTMLInputElement | null)?.value || '').trim();
      if (rawUrl) {
        if (rawUrl.includes(',')) {
          const urls = rawUrl.split(',').map(u => u.trim()).filter(Boolean);
          mediaVal = JSON.stringify(urls);
        } else {
          mediaVal = rawUrl;
        }
      }
    }

    const meta = {
      class: (document.getElementById('item-class') as HTMLInputElement | null)?.value || 'SUPER',
      plate: ((document.getElementById('item-plate') as HTMLInputElement | null)?.value || '').toUpperCase().trim(),
      specs_text: specs,
      dealer_price: parseFloat((document.getElementById('item-dealer-price') as HTMLInputElement | null)?.value as any) || 0,
      rental_pct: parseFloat((document.getElementById('item-rental-percent') as HTMLInputElement | null)?.value as any) || 0.5,
      use_auto_price: (document.querySelector("input[name='price-mode']:checked") as HTMLInputElement | null)?.value === 'auto',
      media_url: mediaVal
    };
    const finalSpecs = JSON.stringify(meta);

    const editId = adminModalForm.dataset.editId;
    let resError;
    let savedId = editId;

    if (editId) {
      const { error } = await supabaseClient.from('vehicules').update({
        name,
        price,
        specs: finalSpecs,
        status
      }).eq('id', editId);
      resError = error;
    } else {
      const { data: insertData, error } = await supabaseClient.from('vehicules').insert([{
        name,
        price,
        specs: finalSpecs,
        status
      }]).select('id');
      resError = error;
      if (insertData && insertData[0]) {
        savedId = insertData[0].id;
      }
    }

    if (resError) {
      showToast("Erreur lors de l'enregistrement : " + resError.message, 'danger');
    } else {
      showToast(editId ? `Élément "${name}" modifié avec succès !` : `Élément "${name}" enregistré avec succès !`, 'success');
      const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");
      await writeLog(editId ? `Modification élément: ${name} (${type})` : `Ajout élément: ${name} (${type})`, activeUser.name || 'Fondateur', 'success');

      closeModal();
      loadVehicles();
      loadLogs();

      // Trigger live Discord embed creation / update in Forum (ID 1537811600822636584)
      if (savedId) {
        botFetch('/api/update-fleet-vehicle-status', {
          method: 'POST',
          body: JSON.stringify({ vehicleId: savedId, status })
        }).catch((err) => console.warn('[Richman Discord Sync]', err));
      }
    }
  });
}

// Suite Form Submission
const suiteModalForm = document.getElementById("suite-modal-form") as HTMLFormElement | null;
if (suiteModalForm) {
  suiteModalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const category = (document.getElementById('suite-category') as HTMLSelectElement).value;
    const name = (document.getElementById('suite-name') as HTMLInputElement).value;
    const room_number = ((document.getElementById('suite-room-number') as HTMLInputElement).value || '').trim();
    const access_code = ((document.getElementById('suite-access-code') as HTMLInputElement).value || '').trim();
    const floor = ((document.getElementById('suite-floor') as HTMLInputElement).value || '').trim();
    const status = (document.getElementById('suite-status') as HTMLSelectElement).value;
    const price = (document.getElementById('suite-price') as HTMLInputElement).value;
    const specs = (document.getElementById('suite-specs') as HTMLInputElement).value;

    let media_urls = "";
    if (state.uploadedSuiteImagesArray.length > 0) {
      media_urls = state.uploadedSuiteImagesArray.length === 1 ? state.uploadedSuiteImagesArray[0] : JSON.stringify(state.uploadedSuiteImagesArray);
    } else {
      media_urls = ((document.getElementById('suite-media-url') as HTMLInputElement | null)?.value || '').trim();
    }

    const editId = suiteModalForm.dataset.editId;
    let savedSuiteId: string | undefined = editId;
    let resError;
    const payload = {
      name,
      category,
      room_number,
      access_code,
      floor,
      status,
      price,
      specs,
      media_urls
    };

    if (editId) {
      const { error } = await supabaseClient.from('suites').update(payload).eq('id', editId);
      resError = error;
    } else {
      const { data: insertRes, error } = await supabaseClient.from('suites').insert([payload]).select();
      resError = error;
      if (insertRes && insertRes[0]) savedSuiteId = insertRes[0].id;
    }

    if (resError) {
      console.error("Error saving accommodation:", resError.message);
      showToast("Erreur lors de l'enregistrement : " + resError.message, "danger");
      return;
    }

    showToast(editId ? `Hébergement "${name}" mis à jour avec succès !` : `Hébergement "${name}" ajouté avec succès !`, "success");
    closeSuiteModal();
    loadSuites();
    loadLogs();
    const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");
    writeLog(editId ? `Modification hébergement: ${name} (${category})` : `Ajout hébergement: ${name} (${category})`, activeUser.name || 'Gérant Hôtel', 'success');

    // Trigger live Discord sync for the suite
    if (savedSuiteId) {
      botFetch('/api/update-hotel-suite-status', {
        method: 'POST',
        body: JSON.stringify({ suiteId: savedSuiteId, status })
      }).catch((err) => console.warn('[Richman Discord Sync Suites]', err));
    }
  });
}

// Initial Loading on Admin Page Load
if (window.location.pathname.includes("admin") || document.getElementById("admin-search")) {
  setTimeout(() => {
    loadVehicles();
    loadSuites();
    loadBookings();
    loadLogs();
    loadConciergeMessages();
    loadUsers();
  }, 500);
}

// Users Search & Filters listeners
const usersSearchInput = document.getElementById("users-search-input") as HTMLInputElement | null;
const usersFilterRole = document.getElementById("users-filter-role") as HTMLSelectElement | null;

if (usersSearchInput) {
  usersSearchInput.addEventListener("input", applyUsersFilters);
}
if (usersFilterRole) {
  usersFilterRole.addEventListener("change", applyUsersFilters);
}

// Live Search Filter
const adminSearch = document.getElementById('admin-search') as HTMLInputElement | null;
if (adminSearch) {
  adminSearch.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
    const rows = document.querySelectorAll('.admin-table tbody tr');
    const cards = document.querySelectorAll('.admin-card-item');

    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      (row as HTMLElement).style.display = text.includes(query) ? '' : 'none';
    });

    cards.forEach((card) => {
      const text = card.textContent.toLowerCase();
      (card as HTMLElement).style.display = text.includes(query) ? '' : 'none';
    });
  });
}

// Fleet specific search & filters listeners
const fleetSearchInput = document.getElementById('fleet-search-input') as HTMLInputElement | null;
const fleetFilterStatus = document.getElementById('fleet-filter-status') as HTMLSelectElement | null;
const fleetSortBy = document.getElementById('fleet-sort-by') as HTMLSelectElement | null;
const btnRefreshFleet = document.getElementById('btn-refresh-fleet') as HTMLButtonElement | null;

if (fleetSearchInput) {
  fleetSearchInput.addEventListener('input', applyFleetFilters);
}
if (fleetFilterStatus) {
  fleetFilterStatus.addEventListener('change', applyFleetFilters);
}
if (fleetSortBy) {
  fleetSortBy.addEventListener('change', applyFleetFilters);
}
if (btnRefreshFleet) {
  btnRefreshFleet.addEventListener('click', () => {
    const icon = btnRefreshFleet.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    loadVehicles();
    setTimeout(() => {
      if (icon) icon.classList.remove('fa-spin');
    }, 600);
  });
}

// Suites specific search & filters listeners
const suitesSearchInput = document.getElementById('suites-search-input') as HTMLInputElement | null;
const suitesFilterCategory = document.getElementById('suites-filter-category') as HTMLSelectElement | null;
const suitesFilterStatus = document.getElementById('suites-filter-status') as HTMLSelectElement | null;
const suitesSortBy = document.getElementById('suites-sort-by') as HTMLSelectElement | null;
const btnRefreshSuites = document.getElementById('btn-refresh-suites') as HTMLButtonElement | null;

if (suitesSearchInput) {
  suitesSearchInput.addEventListener('input', applySuitesFilters);
}
if (suitesFilterCategory) {
  suitesFilterCategory.addEventListener('change', applySuitesFilters);
}
if (suitesFilterStatus) {
  suitesFilterStatus.addEventListener('change', applySuitesFilters);
}
if (suitesSortBy) {
  suitesSortBy.addEventListener('change', applySuitesFilters);
}
if (btnRefreshSuites) {
  btnRefreshSuites.addEventListener('click', () => {
    const icon = btnRefreshSuites.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    loadSuites();
    setTimeout(() => {
      if (icon) icon.classList.remove('fa-spin');
    }, 600);
  });
}

  // ---- Affectation window (compat handlers HTML onclick="window.xxx(...)") ----
  (window as any).updateKPIs = updateKPIs;
});

// ==========================================================================
// KPIs (export inter-modules — carte PORTING_RULES)
// ==========================================================================
export async function updateKPIs() {
  if (!supabaseClient) return;

  // 1. Active Rentals
  const { data: vehicles, error: vError } = await supabaseClient.from("vehicules").select("status");
  if (!vError && vehicles) {
    const total = vehicles.length;
    const active = vehicles.filter(v => v.status === 'rented').length;
    const el = document.getElementById("kpi-active-rentals");
    if (el) el.textContent = `${active} / ${total}`;
  }

  // 2. Booked Suites
  const { data: suites, error: sError } = await supabaseClient.from("suites").select("status");
  if (!sError && suites) {
    const total = suites.length;
    const active = suites.filter(s => s.status === 'rented').length;
    const el = document.getElementById("kpi-booked-suites");
    if (el) el.textContent = `${active} / ${total}`;

    const trendEl = document.getElementById("kpi-suites-trend");
    if (trendEl && total > 0) {
      const rate = Math.round((active / total) * 100);
      trendEl.textContent = `${rate}% Taux d'occupation`;
    }
  }

  // 3. Concierge Requests
  const { data: bookings, error: bError } = await supabaseClient.from("bookings").select("status, amount");
  if (!bError && bookings) {
    const pending = bookings.filter(b => b.status === 'pending').length;
    const el = document.getElementById("kpi-pending-concierge");
    if (el) el.textContent = `${pending} En attente`;

    // 4. Monthly Revenue
    let revenue = 0;
    bookings.forEach(b => {
      if (b.status === 'confirmed') {
        const amtStr = b.amount || "";
        const num = parseInt(amtStr.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num)) {
          revenue += num;
        }
      }
    });
    const revEl = document.getElementById("kpi-revenue");
    if (revEl) {
      revEl.textContent = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(revenue);
    }
  }
}
