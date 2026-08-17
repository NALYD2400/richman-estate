/* ==========================================================================
   Richman Estate — 03-admin-users.ts
   Admin : Gestion Utilisateurs & Citoyens (Vercel Monochrome & Deep-linking #user-detail)
   ========================================================================== */

import { escapeHTML, safeJsArg, sanitizeUrl } from "../core/sanitize";
import { supabaseClient } from "../core/supabase";
import { botFetch } from "../core/api";
import { state } from "../core/state";
import { closeUserModal, showToast } from "./02-admin-crud";

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

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading users:", error.message);
    container.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #f87171; padding: 24px;">Erreur lors du chargement des citoyens : ${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  state.usersCache = data || [];
  if (countBadge) {
    countBadge.textContent = `${state.usersCache.length} citoyen${state.usersCache.length > 1 ? 's' : ''}`;
  }

  renderUsersTable(state.usersCache);
  checkUserDetailHash();
}

function renderUsersTable(usersList: any[]) {
  const container = document.getElementById("users-table-body");
  if (!container) return;

  container.innerHTML = "";
  if (!usersList || usersList.length === 0) {
    container.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #71717a; padding: 36px; font-size: 13px;">Aucun citoyen ne correspond aux critères.</td></tr>`;
    return;
  }

  usersList.forEach(item => {
    const tr = document.createElement("tr");
    const safeName = escapeHTML(item.full_name || 'Citoyen RP');
    const safeInitial = safeName.charAt(0).toUpperCase() || 'C';
    const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('fr-FR') : '-';

    let roleClass = 'role-citizen';
    let roleText = '🌲 Citoyen';
    if (item.role === 'owner') {
      roleClass = 'role-owner';
      roleText = '👑 Fondateur';
    } else if (item.role === 'admin') {
      roleClass = 'role-admin';
      roleText = '🛡️ Administrateur';
    } else if (item.role === 'gerant_hotel') {
      roleClass = 'role-hotel';
      roleText = '🏨 Gérant Hôtel';
    } else if (item.role === 'gerant_vehicules') {
      roleClass = 'role-cars';
      roleText = '🚗 Gérant Véhicules';
    } else if (item.role === 'vip') {
      roleClass = 'role-vip';
      roleText = '⭐ Membre VIP';
    }

    const roleBadge = `<span class="user-role-badge-clean ${roleClass}">${roleText}</span>`;

    const safeAvatarUrl = escapeHTML(sanitizeUrl(item.avatar_url, 'assets/logo.webp'));
    const avatarHtml = (item.avatar_url && !item.avatar_url.includes("logo.webp"))
      ? `<img src="${safeAvatarUrl}" alt="" class="user-avatar-clean" />`
      : `<div class="user-avatar-initial-clean">${safeInitial}</div>`;

    const discordBadge = item.discord_id
      ? `<span class="user-discord-badge-clean">
           <i class="fa-brands fa-discord" style="color: #a1a1aa; font-size: 11px;"></i>
           <span>${escapeHTML(item.discord_id)}</span>
           <button type="button" class="copy-btn" onclick="event.stopPropagation(); window.copyDiscordIdFromRow('${escapeHTML(item.discord_id)}', this)" title="Copier l'ID">
             <i class="fa-regular fa-copy"></i>
           </button>
         </span>`
      : `<span style="color: #52525b; font-size: 12px;">Non lié</span>`;

    const effectiveRpId = item.rp_id || extractRpIdFromName(item.full_name);
    const rpMatricule = effectiveRpId
      ? `<span class="user-rp-badge-clean">#${escapeHTML(effectiveRpId)}</span>`
      : `<span style="color: #52525b; font-size: 12px;">—</span>`;

    tr.style.cursor = "pointer";
    tr.className = "clickable-user-row";
    tr.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.user-act-btn-clean') || (e.target as HTMLElement).closest('.copy-btn')) return;
      (window as any).viewUserProfile(item.id);
    };

    tr.innerHTML = `
      <td style="width: 28%;">
        <div style="display: flex; align-items: center; gap: 12px;">
          ${avatarHtml}
          <div style="min-width: 0;">
            <strong style="color: #ffffff; font-size: 13.5px; font-weight: 600; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em;">${safeName}</strong>
            ${item.email ? `<div style="font-size: 11.5px; color: #71717a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">${escapeHTML(item.email)}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="width: 22%;">${discordBadge}</td>
      <td style="width: 14%;">${rpMatricule}</td>
      <td style="width: 17%;">${roleBadge}</td>
      <td style="width: 11%; color: #a1a1aa; font-size: 12px; font-family: monospace;">${dateStr}</td>
      <td style="width: 8%; text-align: right;">
        <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
          <button class="user-act-btn-clean" onclick="event.stopPropagation(); window.viewUserProfile('${escapeHTML(item.id)}')" title="Gérer ce citoyen">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
          </button>
          <button class="user-act-btn-clean danger" onclick="event.stopPropagation(); window.deleteUserProfile(decodeURIComponent('${safeJsArg(item.id)}'), decodeURIComponent('${safeJsArg(safeName)}'))" title="Supprimer ce compte">
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

export function checkUserDetailHash() {
  const hash = window.location.hash;
  if (hash.startsWith('#user-detail')) {
    const match = hash.match(/id=([^&]+)/);
    if (match && match[1]) {
      const userId = decodeURIComponent(match[1]);
      if (state.usersCache && state.usersCache.length > 0) {
        const found = state.usersCache.find(u => u.id === userId);
        if (found) {
          (window as any).viewUserProfile(userId, false);
        }
      }
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Global 1-click Discord copy
  (window as any).copyDiscordIdFromRow = function(discordId: string, btn: HTMLElement) {
    if (!discordId) return;
    navigator.clipboard.writeText(discordId).then(() => {
      showToast(`ID Discord (${discordId}) copié !`, 'success');
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check" style="color: #10b981;"></i>';
      setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
    });
  };

  // User Profile Actions & Interactive Discord Roles
  (window as any).viewUserProfile = async function(userId: string, updateHash = true) {
    const user = state.usersCache.find(u => u.id === userId);
    if (!user || !supabaseClient) return;

    if (updateHash) {
      history.pushState(null, '', '#user-detail?id=' + encodeURIComponent(userId));
    }

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
    const emailEl = document.getElementById('user-modal-email');

    const safeName = user.full_name || 'Citoyen RP';
    if (fullNameEl) fullNameEl.textContent = safeName;
    if (emailEl) emailEl.textContent = user.email || 'Aucune adresse email';
    
    const effectiveRpId = user.rp_id || extractRpIdFromName(user.full_name);
    if (rpIdEl) rpIdEl.textContent = effectiveRpId ? `ID RP: #${effectiveRpId}` : 'ID RP: Non renseigné';
    if (discordIdEl) discordIdEl.textContent = user.discord_id || 'Non lié';
    if (createdAtEl) createdAtEl.textContent = user.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date inconnue';

    // 1-Click Copy Discord ID in Modal
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
      let roleClass = 'role-citizen';
      let roleText = '🌲 Citoyen';
      if (user.role === 'owner') {
        roleClass = 'role-owner';
        roleText = '👑 Fondateur';
      } else if (user.role === 'admin') {
        roleClass = 'role-admin';
        roleText = '🛡️ Administrateur';
      } else if (user.role === 'gerant_hotel') {
        roleClass = 'role-hotel';
        roleText = '🏨 Gérant Hôtel';
      } else if (user.role === 'gerant_vehicules') {
        roleClass = 'role-cars';
        roleText = '🚗 Gérant Véhicules';
      } else if (user.role === 'vip') {
        roleClass = 'role-vip';
        roleText = '⭐ Membre VIP';
      }

      roleBadgeEl.className = `user-role-badge-clean ${roleClass}`;
      roleBadgeEl.textContent = roleText;
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

    // Load associated user bookings (Vehicles & Suites)
    const bookingsCountEl = document.getElementById('user-modal-bookings-count');
    if (bookingsListEl) {
      bookingsListEl.innerHTML = `<div style="text-align: center; color: #71717a; font-size: 11.5px; padding: 10px;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des réservations...</div>`;
      const { data: userBookings } = await supabaseClient
        .from("bookings")
        .select("*")
        .ilike("client_name", `%${safeName}%`)
        .order("created_at", { ascending: false });

      if (!userBookings || userBookings.length === 0) {
        if (bookingsCountEl) bookingsCountEl.textContent = "0 location";
        bookingsListEl.innerHTML = `<div style="text-align: center; color: #71717a; font-size: 11.5px; padding: 12px; background: #0c0c0e; border-radius: 8px; border: 1px dashed #27272a;">Aucune réservation pour ce citoyen.</div>`;
      } else {
        if (bookingsCountEl) bookingsCountEl.textContent = `${userBookings.length} location${userBookings.length > 1 ? 's' : ''}`;
        bookingsListEl.innerHTML = "";
        userBookings.forEach(b => {
          const itemDiv = document.createElement("div");
          itemDiv.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: #18181b; border: 1px solid #27272a; padding: 8px 12px; border-radius: 8px; font-size: 12px;";

          let statusBadge = '<span style="font-size: 10.5px; font-weight: 600; background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 7px; border-radius: 4px;"><i class="fa-solid fa-clock"></i> En attente</span>';
          if (b.status === 'confirmed') {
            statusBadge = '<span style="font-size: 10.5px; font-weight: 600; background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 7px; border-radius: 4px;"><i class="fa-solid fa-circle-check"></i> Validé</span>';
          } else if (b.status === 'cancelled' || b.status === 'rejected') {
            statusBadge = '<span style="font-size: 10.5px; font-weight: 600; background: rgba(239, 68, 68, 0.12); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 2px 7px; border-radius: 4px;"><i class="fa-solid fa-circle-xmark"></i> Annulé</span>';
          }

          itemDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              <i class="fa-solid ${b.type === 'vehicule' ? 'fa-car' : 'fa-building'}" style="color: #a1a1aa; font-size: 12px;"></i>
              <div style="min-width: 0;">
                <strong style="color: #ffffff; display: block; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(b.item_name)}</strong>
                <span style="color: #71717a; font-size: 10.5px; font-family: monospace;">#RES-${escapeHTML(b.id.slice(0,4).toUpperCase())}</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #e4e4e7; font-weight: 600; font-size: 12px;">${escapeHTML(b.amount)}</span>
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

  (window as any).loadUserDiscordRoles = function(discordId: string, userId: string, currentRole?: string) {
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

        if (currentRole === 'owner') {
          if (!finalRoles.some(r => r.name.toLowerCase().includes('fondateur') || r.name.toLowerCase().includes('owner'))) {
            finalRoles.unshift({ id: '1537194550852980757', name: '👑 Owner / Fondateur', color: '#ffffff', position: 999 });
          }
        }

        if (finalRoles.length > 0) {
          if (rolesCountEl) rolesCountEl.textContent = `${finalRoles.length} grade(s)`;
          if (rolesContainer) {
            rolesContainer.innerHTML = "";
            finalRoles.forEach(r => {
              const chip = document.createElement("span");
              const roleColor = (r.color && r.color !== '#000000' && r.color !== '#99aab5') ? r.color : '#e4e4e7';
              chip.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                font-weight: 500;
                padding: 4px 8px;
                border-radius: 6px;
                background: #18181b;
                border: 1px solid #27272a;
                color: #ffffff;
              `;
              chip.innerHTML = `
                <span style="width: 6px; height: 6px; border-radius: 50%; background-color: ${roleColor};"></span>
                <span>${escapeHTML(r.name)}</span>
                <button type="button" title="Retirer ce rôle Discord" onclick="window.removeDiscordRole(decodeURIComponent('${safeJsArg(discordId)}'), decodeURIComponent('${safeJsArg(r.id)}'), decodeURIComponent('${safeJsArg(r.name)}'), decodeURIComponent('${safeJsArg(userId)}'))" style="background: none; border: none; color: #71717a; margin-left: 4px; cursor: pointer; padding: 0 2px; font-size: 11px; transition: color 0.15s;" onmouseenter="this.style.color='#ef4444'" onmouseleave="this.style.color='#71717a'">
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
              <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; padding: 4px 8px; border-radius: 6px; background: #18181b; border: 1px solid #27272a; color: #a1a1aa;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background-color: #10b981;"></span> 🌲 Citoyen RP (@everyone)
              </span>
            `;
          }
        }
      })
      .catch(err => {
        console.warn("Erreur fetch Discord roles :", err);
        if (rolesContainer) {
          rolesContainer.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; padding: 4px 8px; border-radius: 6px; background: #18181b; border: 1px solid #27272a; color: #a1a1aa;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background-color: #71717a;"></span> Citoyen Enregistré
            </span>
          `;
        }
      });
    } else {
      if (rolesCountEl) rolesCountEl.textContent = "Non lié";
      if (rolesContainer) rolesContainer.innerHTML = `<span style="color: #71717a; font-size: 11.5px;">Compte sans identifiant Discord lié.</span>`;
    }
  };

  (window as any).addDiscordRole = async function(discordId: string, roleKey: string, userId: string) {
    if (!supabaseClient) return;

    let dbRole = 'client';
    if (roleKey === 'owner') dbRole = 'owner';
    else if (roleKey === 'admin') dbRole = 'admin';
    else if (roleKey === 'gerant_hotel') dbRole = 'gerant_hotel';
    else if (roleKey === 'gerant_vehicules') dbRole = 'gerant_vehicules';
    else if (roleKey === 'vip') dbRole = 'vip';

    // SÉCURITÉ : le changement de rôle passe par la RPC admin_set_role (SECURITY DEFINER)
    // qui vérifie en base les droits de l'appelant (admin strict, et seul un owner peut
    // créer/rétrograder un owner). Le PATCH direct sur la colonne role est révoqué pour
    // authenticated par le patch SQL 2026-08-17.
    const { error } = await supabaseClient.rpc("admin_set_role", {
      p_target_id: userId,
      p_new_role: dbRole
    });
    if (error) {
      showToast("Erreur mise à jour permissions : " + error.message, "danger");
      return;
    }

    if (discordId) {
      showToast("Synchronisation Discord en cours...", "info");
      try {
        const res = await botFetch('/api/manage-user-roles', {
          method: "POST",
          body: JSON.stringify({ discordId, action: 'add', roleKey })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast(`Rôle "${data.roleName || roleKey}" attribué sur Discord !`, 'success');
        } else {
          showToast(`Rôle appliqué sur le site (Discord: ${data.error || 'Vérifiez la hiérarchie du bot'})`, 'warning');
        }
      } catch (e: any) {
        showToast("Rôle mis à jour sur le site (Bot Discord hors ligne)", "warning");
      }
    } else {
      showToast("Rôle et permissions mis à jour sur le site !", "success");
    }

    await loadUsers();
    (window as any).loadUserDiscordRoles(discordId, userId, dbRole);

    const roleBadgeEl = document.getElementById('user-modal-role-badge');
    if (roleBadgeEl) {
      let roleClass = 'role-citizen';
      let roleText = '🌲 Citoyen';
      if (dbRole === 'owner') { roleClass = 'role-owner'; roleText = '👑 Fondateur'; }
      else if (dbRole === 'admin') { roleClass = 'role-admin'; roleText = '🛡️ Administrateur'; }
      else if (dbRole === 'gerant_hotel') { roleClass = 'role-hotel'; roleText = '🏨 Gérant Hôtel'; }
      else if (dbRole === 'gerant_vehicules') { roleClass = 'role-cars'; roleText = '🚗 Gérant Véhicules'; }
      else if (dbRole === 'vip') { roleClass = 'role-vip'; roleText = '⭐ Membre VIP'; }

      roleBadgeEl.className = `user-role-badge-clean ${roleClass}`;
      roleBadgeEl.textContent = roleText;
    }
  };

  (window as any).removeDiscordRole = async function(discordId: string, roleId: string, roleName: string, userId: string) {
    if (!discordId) return;

    showToast(`Suppression du rôle "${roleName}" sur Discord...`, "info");
    try {
      const res = await botFetch('/api/manage-user-roles', {
        method: "POST",
        body: JSON.stringify({ discordId, action: 'remove', roleId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Rôle "${roleName}" retiré sur Discord !`, "success");
        (window as any).loadUserDiscordRoles(discordId, userId);
        await loadUsers();
      } else {
        showToast(`Erreur Discord : ${data.error || 'Action refusée'}`, "danger");
      }
    } catch (e: any) {
      showToast("Impossible de joindre le bot Discord : " + e.message, "danger");
    }
  };

  // Wire search input live filtering
  const searchInput = document.getElementById("users-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", applyUsersFilters);
  }

  const roleFilter = document.getElementById("users-filter-role");
  if (roleFilter) {
    roleFilter.addEventListener("change", applyUsersFilters);
  }

  // Keyboard shortcut listener (/ to search, Escape to close modal)
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
      const input = document.getElementById('users-search-input') as HTMLInputElement | null;
      if (input && document.getElementById('tab-users')?.classList.contains('active')) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    }
    if (e.key === 'Escape') {
      const overlay = document.getElementById('user-modal-overlay');
      if (overlay && overlay.classList.contains('active')) {
        closeUserModal();
      }
    }
  });

  // Hash Routing Listeners
  window.addEventListener('hashchange', checkUserDetailHash);
  window.addEventListener('popstate', checkUserDetailHash);

  // Affectations window
  (window as any).applyUsersFilters = applyUsersFilters;
  (window as any).loadUsers = loadUsers;
  (window as any).checkUserDetailHash = checkUserDetailHash;
});
