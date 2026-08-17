/* ==========================================================================
   Richman Estate — 03-admin-users.ts
   Admin : gestion utilisateurs & citoyens (rôles, suppressions)
   Porté de 03-admin-users.js (découpage historique de main.js).

   Note de portage : usersCache passe par `state` (core/state) ; l'initial
   `let usersCache = []` est reproduit par l'affectation module ci-dessous
   (aucun lecteur entre l'évaluation module et DOMContentLoaded). Les blocs
   Object.defineProperty(window, ...) « Exports inter-parties » sont
   supprimés conformément au contrat.
   ========================================================================== */

import { escapeHTML, safeJsArg, sanitizeUrl } from "../core/sanitize";
import { supabaseClient } from "../core/supabase";
import { botFetch } from "../core/api";
import { state } from "../core/state";
import { closeUserModal, showToast } from "./02-admin-crud";

// ==========================================================================
// User & Citizen Management (SaaS Profiles, Roles & Deletions)
// ==========================================================================
state.usersCache = [];

export function extractRpIdFromName(name: string): string | null {
  if (!name) return null;
  const pipeMatch = name.match(/\|\s*([0-9]{1,6})\b/);
  if (pipeMatch) return pipeMatch[1];
  const bracketMatch = name.match(/[\[\(#\-]\s*([0-9]{1,6})\s*[\]\)]?/);
  if (bracketMatch) return bracketMatch[1];
  const trailingDigitsMatch = name.match(/\b([0-9]{2,6})\s*$/);
  if (trailingDigitsMatch) return trailingDigitsMatch[1];
  return null;
}

export async function loadUsers() {
  const container = document.getElementById("users-table-body");
  const countBadge = document.getElementById("users-count-badge");
  if (!container || !supabaseClient) return;

  const { data, error } = await supabaseClient.from("profiles").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("Error loading users:", error.message);
    container.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #f87171; padding: 24px;">Erreur lors du chargement des citoyens : ${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  state.usersCache = data || [];
  if (countBadge) countBadge.textContent = `${state.usersCache.length} citoyen${state.usersCache.length > 1 ? 's' : ''}`;
  renderUsersTable(state.usersCache);
}

function renderUsersTable(usersList) {
  const container = document.getElementById("users-table-body");
  if (!container) return;

  container.innerHTML = "";
  if (!usersList || usersList.length === 0) {
    container.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #71717a; padding: 32px; font-size: 13px;">Aucun utilisateur ne correspond aux critères.</td></tr>`;
    return;
  }

  usersList.forEach(item => {
    const tr = document.createElement("tr");
    const safeName = escapeHTML(item.full_name || 'Citoyen RP');
    const safeInitial = safeName.charAt(0).toUpperCase() || 'C';
    const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('fr-FR') : '-';

    let roleBadge = '<span class="type-tag" style="background: rgba(16, 185, 129, 0.16); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 13px; padding: 6px 13px; font-weight: 700;">🌲 Citoyen</span>';
    if (item.role === 'owner') {
      roleBadge = '<span class="type-tag" style="background: rgba(197, 168, 128, 0.18); color: #c5a880; border: 1px solid rgba(197, 168, 128, 0.4); font-size: 13px; padding: 6px 13px; font-weight: 700;">👑 Fondateur</span>';
    } else if (item.role === 'admin') {
      roleBadge = '<span class="type-tag" style="background: rgba(56, 189, 248, 0.18); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); font-size: 13px; padding: 6px 13px; font-weight: 700;">🛡️ Administrateur</span>';
    } else if (item.role === 'gerant_hotel') {
      roleBadge = '<span class="type-tag" style="background: rgba(168, 85, 247, 0.18); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); font-size: 13px; padding: 6px 13px; font-weight: 700;">🏨 Gérant Hôtel</span>';
    } else if (item.role === 'gerant_vehicules') {
      roleBadge = '<span class="type-tag" style="background: rgba(234, 179, 8, 0.18); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.4); font-size: 13px; padding: 6px 13px; font-weight: 700;">🚗 Gérant Véhicules</span>';
    } else if (item.role === 'vip') {
      roleBadge = '<span class="type-tag" style="background: rgba(245, 158, 11, 0.18); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); font-size: 13px; padding: 6px 13px; font-weight: 700;">⭐ Membre VIP</span>';
    }

    const safeAvatarUrl = escapeHTML(sanitizeUrl(item.avatar_url, 'assets/logo.webp'));
    const avatarHtml = (item.avatar_url && !item.avatar_url.includes("logo.webp"))
      ? `<img src="${safeAvatarUrl}" alt="" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(197, 168, 128, 0.4); box-shadow: 0 0 12px rgba(0,0,0,0.5);" />`
      : `<div class="admin-avatar" style="width: 42px; height: 42px; font-size: 16px; font-weight: 700; background: linear-gradient(135deg, #242432 0%, #121218 100%); color: #c5a880; border: 2px solid rgba(197, 168, 128, 0.4); box-shadow: 0 0 12px rgba(0,0,0,0.4);">${safeInitial}</div>`;

    const discordBadge = item.discord_id
      ? `<span style="font-family: monospace; background: rgba(88, 101, 242, 0.14); padding: 7px 13px; border-radius: 9px; font-size: 13px; font-weight: 600; color: #f4f4f5; border: 1px solid rgba(88, 101, 242, 0.35); display: inline-flex; align-items: center; gap: 7px; letter-spacing: 0.02em;"><i class="fa-brands fa-discord" style="color: #5865F2; font-size: 14px;"></i> ${escapeHTML(item.discord_id)}</span>`
      : `<span style="color: #71717a; font-size: 12.5px;">Non lié</span>`;

    const effectiveRpId = item.rp_id || extractRpIdFromName(item.full_name);
    const rpMatricule = effectiveRpId
      ? `<span style="font-family: monospace; font-size: 13px; color: #c5a880; font-weight: 700; background: rgba(197, 168, 128, 0.1); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(197, 168, 128, 0.25);">#${escapeHTML(effectiveRpId)}</span>`
      : `<span style="color: #71717a; font-size: 13px;">—</span>`;

    tr.style.cursor = "pointer";
    tr.className = "clickable-user-row";
    tr.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.danger')) return;
      (window as any).viewUserProfile(item.id);
    };

    tr.innerHTML = `
      <td style="width: 28%;">
        <div style="display: flex; align-items: center; gap: 14px;">
          ${avatarHtml}
          <div style="min-width: 0;">
            <strong style="color: #ffffff; font-size: 14.5px; font-weight: 700; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em;">${safeName}</strong>
            ${item.email ? `<div style="font-size: 12px; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">${escapeHTML(item.email)}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="width: 22%;">${discordBadge}</td>
      <td style="width: 14%;">${rpMatricule}</td>
      <td style="width: 17%;">${roleBadge}</td>
      <td style="width: 11%; color: #f4f4f5; font-size: 13px; font-weight: 500;">${dateStr}</td>
      <td style="width: 8%; text-align: right;">
        <div class="table-actions-cell" style="justify-content: flex-end;">
          <button class="table-act-btn danger" onclick="event.stopPropagation(); window.deleteUserProfile(decodeURIComponent('${safeJsArg(item.id)}'), decodeURIComponent('${safeJsArg(safeName)}'))" title="Supprimer ce compte">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </td>
    `;
    container.appendChild(tr);
  });
}

export function applyUsersFilters() {
  const searchInput = document.getElementById("users-search-input") as HTMLInputElement | null;
  const roleFilter = document.getElementById("users-filter-role") as HTMLInputElement | null;

  const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
  const roleVal = roleFilter ? roleFilter.value : "";

  const filtered = state.usersCache.filter(u => {
    const effectiveRpId = (u.rp_id || extractRpIdFromName(u.full_name) || '').toLowerCase();
    const nameMatch = (u.full_name || '').toLowerCase().includes(query) ||
                      (u.discord_id || '').toLowerCase().includes(query) ||
                      effectiveRpId.includes(query) ||
                      (u.email || '').toLowerCase().includes(query);
    const roleMatch = !roleVal || u.role === roleVal;
    return nameMatch && roleMatch;
  });

  renderUsersTable(filtered);
}

document.addEventListener("DOMContentLoaded", () => {
// User Profile Actions & Interactive Discord Roles
(window as any).viewUserProfile = async function(userId) {
  const user = state.usersCache.find(u => u.id === userId);
  if (!user || !supabaseClient) return;

  const overlay = document.getElementById('user-modal-overlay');
  const avatarImg = document.getElementById('user-modal-avatar') as HTMLImageElement | null;
  const initialDiv = document.getElementById('user-modal-initial');
  const fullNameEl = document.getElementById('user-modal-fullname');
  const roleBadgeEl = document.getElementById('user-modal-role-badge');
  const rpIdEl = document.getElementById('user-modal-rp-id');
  const discordIdEl = document.getElementById('user-modal-discord-id');
  const createdAtEl = document.getElementById('user-modal-created-at');
  const roleSelect = document.getElementById('user-modal-role-select') as HTMLSelectElement | null;
  const saveRoleBtn = document.getElementById('user-modal-save-role-btn');
  const refreshRolesBtn = document.getElementById('user-modal-refresh-roles-btn');
  const deleteBtn = document.getElementById('user-modal-delete-btn');
  const bookingsListEl = document.getElementById('user-modal-bookings-list');

  const safeName = user.full_name || 'Citoyen RP';
  if (fullNameEl) fullNameEl.textContent = safeName;
  const emailEl = document.getElementById('user-modal-email');
  const effectiveRpId = user.rp_id || extractRpIdFromName(user.full_name);
  if (rpIdEl) rpIdEl.textContent = effectiveRpId ? `ID RP: #${effectiveRpId}` : 'ID RP: Non renseigné';
  if (discordIdEl) discordIdEl.textContent = user.discord_id || 'Non lié';
  if (createdAtEl) createdAtEl.textContent = user.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date inconnue';

  // 1-Click Copy Discord ID
  const copyBtn = document.getElementById('user-modal-copy-discord-btn');
  if (copyBtn && user.discord_id) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(user.discord_id).then(() => {
        showToast(`ID Discord (${user.discord_id}) copié dans le presse-papier !`, 'success');
        copyBtn.innerHTML = '<i class="fa-solid fa-check" style="color: #10b981;"></i>';
        setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>'; }, 2000);
      });
    };
  }

  if (roleSelect) roleSelect.value = user.role || 'citoyen';
  if (roleBadgeEl) {
    if (user.role === 'owner') {
      roleBadgeEl.textContent = '👑 Fondateur';
      roleBadgeEl.style.background = 'rgba(197, 168, 128, 0.2)';
      roleBadgeEl.style.color = '#c5a880';
      roleBadgeEl.style.borderColor = 'rgba(197, 168, 128, 0.4)';
    } else if (user.role === 'admin') {
      roleBadgeEl.textContent = '🛡️ Administrateur';
      roleBadgeEl.style.background = 'rgba(56, 189, 248, 0.2)';
      roleBadgeEl.style.color = '#38bdf8';
      roleBadgeEl.style.borderColor = 'rgba(56, 189, 248, 0.4)';
    } else if (user.role === 'gerant_hotel') {
      roleBadgeEl.textContent = '🏨 Gérant Hôtel';
      roleBadgeEl.style.background = 'rgba(168, 85, 247, 0.2)';
      roleBadgeEl.style.color = '#c084fc';
      roleBadgeEl.style.borderColor = 'rgba(168, 85, 247, 0.4)';
    } else if (user.role === 'gerant_vehicules') {
      roleBadgeEl.textContent = '🚗 Gérant Véhicules';
      roleBadgeEl.style.background = 'rgba(234, 179, 8, 0.2)';
      roleBadgeEl.style.color = '#eab308';
      roleBadgeEl.style.borderColor = 'rgba(234, 179, 8, 0.4)';
    } else if (user.role === 'vip') {
      roleBadgeEl.textContent = '⭐ Membre VIP';
      roleBadgeEl.style.background = 'rgba(245, 158, 11, 0.2)';
      roleBadgeEl.style.color = '#f59e0b';
      roleBadgeEl.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    } else {
      roleBadgeEl.textContent = '🌲 Citoyen';
      roleBadgeEl.style.background = 'rgba(16, 185, 129, 0.2)';
      roleBadgeEl.style.color = '#10b981';
      roleBadgeEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    }
  }

  if (avatarImg && initialDiv) {
    if (user.avatar_url && !user.avatar_url.includes('logo.webp')) {
      avatarImg.src = user.avatar_url;
      avatarImg.style.display = 'block';
      initialDiv.style.display = 'none';
    } else {
      initialDiv.textContent = safeName.charAt(0).toUpperCase() || 'C';
      initialDiv.style.display = 'grid';
      avatarImg.style.display = 'none';
    }
  }

  // Load Discord Server Roles in real-time with 1-click removal
  (window as any).loadUserDiscordRoles(user.discord_id, userId, user.role);

  // Wire Add Role Button
  if (saveRoleBtn) {
    saveRoleBtn.onclick = () => {
      const selectedRole = roleSelect ? roleSelect.value : 'citoyen';
      (window as any).addDiscordRole(user.discord_id, selectedRole, userId);
    };
  }

  // Wire Refresh Roles Button
  if (refreshRolesBtn) {
    refreshRolesBtn.onclick = () => {
      (window as any).loadUserDiscordRoles(user.discord_id, userId, user.role);
    };
  }

  // Load associated user bookings (Vehicles & Suites) with color-coded status
  const bookingsCountEl = document.getElementById('user-modal-bookings-count');
  if (bookingsListEl) {
    bookingsListEl.innerHTML = `<div style="text-align: center; color: #71717a; font-size: 12px; padding: 8px;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des réservations...</div>`;
    const { data: userBookings } = await supabaseClient
      .from("bookings")
      .select("*")
      .ilike("client_name", `%${safeName}%`)
      .order("created_at", { ascending: false });

    if (!userBookings || userBookings.length === 0) {
      if (bookingsCountEl) bookingsCountEl.textContent = "0 location";
      bookingsListEl.innerHTML = `<div style="text-align: center; color: #71717a; font-size: 12px; padding: 14px; background: #111116; border-radius: 12px; border: 1px dashed rgba(255,255,255,0.06);">Aucune réservation enregistrée pour ce citoyen.</div>`;
    } else {
      if (bookingsCountEl) bookingsCountEl.textContent = `${userBookings.length} location${userBookings.length > 1 ? 's' : ''}`;
      bookingsListEl.innerHTML = "";
      userBookings.forEach(b => {
        const itemDiv = document.createElement("div");
        itemDiv.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: #121217; border: 1px solid rgba(255,255,255,0.06); padding: 10px 14px; border-radius: 12px; font-size: 12.5px;";

        let statusBadge = '<span style="font-size: 11px; font-weight: 700; background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); padding: 3px 9px; border-radius: 6px;"><i class="fa-solid fa-clock"></i> En attente</span>';
        if (b.status === 'confirmed') {
          statusBadge = '<span style="font-size: 11px; font-weight: 700; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); padding: 3px 9px; border-radius: 6px;"><i class="fa-solid fa-circle-check"></i> Validé</span>';
        } else if (b.status === 'cancelled' || b.status === 'rejected') {
          statusBadge = '<span style="font-size: 11px; font-weight: 700; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35); padding: 3px 9px; border-radius: 6px;"><i class="fa-solid fa-circle-xmark"></i> Refusé / Annulé</span>';
        }

        itemDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 30px; height: 30px; border-radius: 8px; background: rgba(197, 168, 128, 0.1); display: flex; align-items: center; justify-content: center; color: #c5a880; font-size: 13px;">
              <i class="fa-solid ${b.type === 'vehicule' ? 'fa-car' : 'fa-building'}"></i>
            </div>
            <div>
              <strong style="color: #fff; display: block; font-size: 13px;">${escapeHTML(b.item_name)}</strong>
              <span style="color: #71717a; font-size: 11px;">#RES-${escapeHTML(b.id.slice(0,4).toUpperCase())} &bull; ${b.type === 'vehicule' ? 'Flotte Supercar' : 'Suite de Luxe'}</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="color: #c5a880; font-weight: 700; font-size: 13px;">${escapeHTML(b.amount)}</span>
            ${statusBadge}
          </div>
        `;
        bookingsListEl.appendChild(itemDiv);
      });
    }
  }

  // Delete action from modal
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      (window as any).deleteUserProfile(userId, safeName);
      closeUserModal();
    };
  }

  if (overlay) {
    overlay.classList.add('active');
    overlay.removeAttribute('aria-hidden');
  }
};

(window as any).loadUserDiscordRoles = function(discordId, userId, currentRole) {
  const rolesContainer = document.getElementById('user-modal-discord-roles-list');
  const rolesCountEl = document.getElementById('user-modal-discord-roles-count');

  if (rolesContainer) {
    rolesContainer.innerHTML = `<span style="color: #71717a; font-size: 11.5px;"><i class="fa-solid fa-spinner fa-spin"></i> Récupération des rôles Discord en direct...</span>`;
  }

  if (discordId) {
    botFetch('/api/check-user-roles', {
      method: "POST",
      body: JSON.stringify({ discordId })
    })
    .then(res => res.json())
    .then(botData => {
      let finalRoles = (botData && botData.roles) ? botData.roles : [];

      if (currentRole === 'owner' || discordId === '1015310406169923665' || discordId === '985083967642423366') {
        if (!finalRoles.some(r => r.name.toLowerCase().includes('fondateur') || r.name.toLowerCase().includes('owner'))) {
          finalRoles.unshift({ id: '1537194550852980757', name: '👑 Owner / Fondateur', color: '#c5a880', position: 999 });
        }
      }

      if (finalRoles.length > 0) {
        if (rolesCountEl) rolesCountEl.textContent = `${finalRoles.length} grade(s)`;
        if (rolesContainer) {
          rolesContainer.innerHTML = "";
          finalRoles.forEach(r => {
            const chip = document.createElement("span");
            const roleColor = (r.color && r.color !== '#000000' && r.color !== '#99aab5') ? r.color : '#c5a880';
            chip.style.cssText = `
              display: inline-flex;
              align-items: center;
              gap: 6px;
              font-size: 11.5px;
              font-weight: 600;
              padding: 5px 9px 5px 11px;
              border-radius: 8px;
              background: rgba(255, 255, 255, 0.04);
              border: 1px solid ${roleColor}50;
              color: ${roleColor};
              box-shadow: 0 2px 8px ${roleColor}15;
            `;
            chip.innerHTML = `
              <span style="width: 7px; height: 7px; border-radius: 50%; background-color: ${roleColor}; box-shadow: 0 0 6px ${roleColor};"></span>
              <span>${escapeHTML(r.name)}</span>
              <button type="button" title="Retirer ce rôle Discord" onclick="window.removeDiscordRole(decodeURIComponent('${safeJsArg(discordId)}'), decodeURIComponent('${safeJsArg(r.id)}'), decodeURIComponent('${safeJsArg(r.name)}'), decodeURIComponent('${safeJsArg(userId)}'))" style="background: none; border: none; color: #ef4444; margin-left: 4px; cursor: pointer; padding: 0 2px; font-size: 11px; opacity: 0.7; transition: opacity 0.2s;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.7">
                <i class="fa-solid fa-xmark"></i>
              </button>
            `;
            rolesContainer.appendChild(chip);
          });
        }
        supabaseClient.from("profiles").update({ discord_roles: finalRoles }).eq("id", userId).then(() => {});
      } else {
        if (rolesCountEl) rolesCountEl.textContent = "1 grade";
        if (rolesContainer) {
          rolesContainer.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 5px 11px; border-radius: 8px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981;">
              <span style="width: 7px; height: 7px; border-radius: 50%; background-color: #10b981;"></span> 🌲 Citoyen RP (@everyone)
            </span>
          `;
        }
      }
    })
    .catch(err => {
      console.warn("Erreur fetch Discord roles :", err);
      if (rolesContainer) {
        rolesContainer.innerHTML = `
          <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 5px 11px; border-radius: 8px; background: rgba(197, 168, 128, 0.08); border: 1px solid rgba(197, 168, 128, 0.3); color: #c5a880;">
            <span style="width: 7px; height: 7px; border-radius: 50%; background-color: #c5a880;"></span> 👑 Citoyen Enregistré
          </span>
        `;
      }
    });
  } else {
    if (rolesCountEl) rolesCountEl.textContent = "Non lié";
    if (rolesContainer) rolesContainer.innerHTML = `<span style="color: #71717a; font-size: 11.5px;">Compte sans identifiant Discord lié.</span>`;
  }
};

(window as any).addDiscordRole = async function(discordId, roleKey, userId) {
  if (!supabaseClient) return;

  // 1. Sync Supabase profile role
  let dbRole = 'client';
  if (roleKey === 'owner') dbRole = 'owner';
  else if (roleKey === 'admin') dbRole = 'admin';
  else if (roleKey === 'gerant_hotel') dbRole = 'gerant_hotel';
  else if (roleKey === 'gerant_vehicules') dbRole = 'gerant_vehicules';
  else if (roleKey === 'vip') dbRole = 'vip';

  const { error } = await supabaseClient.from("profiles").update({ role: dbRole }).eq("id", userId);
  if (error) {
    showToast("Erreur mise à jour permissions web : " + error.message, "danger");
    return;
  }

  // 2. Sync real Discord Role via bot
  if (discordId) {
    showToast("Synchronisation du rôle avec Discord en cours...", "info");
    try {
      const res = await botFetch('/api/manage-user-roles', {
        method: "POST",
        body: JSON.stringify({ discordId, action: 'add', roleKey })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Rôle "${data.roleName || roleKey}" attribué avec succès sur Discord !`, 'success');
      } else {
        showToast(`Rôle appliqué sur le site (Discord: ${data.error || 'Vérifiez la hiérarchie du bot'})`, 'warning');
      }
    } catch (e) {
      showToast("Rôle mis à jour sur le site (Bot Discord hors ligne)", "warning");
    }
  } else {
    showToast("Rôle et permissions mis à jour sur le site !", "success");
  }

  // Refresh data
  await loadUsers();
  (window as any).loadUserDiscordRoles(discordId, userId, dbRole);

  const roleBadgeEl = document.getElementById('user-modal-role-badge');
  if (roleBadgeEl) {
    roleBadgeEl.textContent = dbRole === 'owner' ? '👑 Fondateur' : (dbRole === 'admin' ? '🛡️ Administrateur' : (dbRole === 'gerant_hotel' ? '🏨 Gérant Hôtel' : (dbRole === 'gerant_vehicules' ? '🚗 Gérant Véhicules' : (dbRole === 'vip' ? '⭐ Membre VIP' : '🌲 Citoyen'))));
  }
};

(window as any).removeDiscordRole = async function(discordId, roleId, roleName, userId) {
  if (!discordId) return;

  showToast(`Suppression du rôle "${roleName}" sur Discord...`, "info");
  try {
    const res = await botFetch('/api/manage-user-roles', {
      method: "POST",
      body: JSON.stringify({ discordId, action: 'remove', roleId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Rôle "${roleName}" retiré avec succès sur Discord !`, "success");
      (window as any).loadUserDiscordRoles(discordId, userId);
      await loadUsers();
    } else {
      showToast(`Erreur Discord : ${data.error || 'Action refusée'}`, "danger");
    }
  } catch (e) {
    showToast("Impossible de joindre le bot Discord : " + e.message, "danger");
  }
};

  // ---- Affectations window (compat handlers HTML onclick="window.xxx(...)") ----
  (window as any).applyUsersFilters = applyUsersFilters;
  (window as any).loadUsers = loadUsers;
});
