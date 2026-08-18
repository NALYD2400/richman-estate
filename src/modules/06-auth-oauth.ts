/* ==========================================================================
   Richman Estate — 06-auth-oauth.ts
   Authentification Supabase & Discord OAuth, rôles, register RP
   Porté de main.js (06-auth-oauth.js) — ES module + TypeScript.
   Client Supabase fourni par le noyau (../core/supabase) : la création locale
   de client (createClient en dur) a été supprimée lors du portage.
   ========================================================================== */

import { escapeHTML, sanitizeUrl } from "../core/sanitize";
import { supabaseClient } from "../core/supabase";
import { botFetch } from "../core/api";
import { showToast } from "./02-admin-crud";

// Render Header Nav Pill + Logout Button (Unified Capsule)
export function renderHeaderNavUserPill(displayName: any, avatarUrl: any, targetHref: any) {
  let wrapper = document.querySelector(".nav-user-pill-wrap") as HTMLElement | null;

  if (!wrapper) {
    const btn = document.querySelector(".signin-btn") || document.querySelector(".header-container a[href='login.html']");
    if (!btn) return;

    const parent = btn.parentElement;
    wrapper = document.createElement("div");
    wrapper.className = "nav-user-pill-wrap";
    wrapper.style.cssText = "display: inline-flex; align-items: center; gap: 8px; padding: 0 10px 0 4px; box-sizing: border-box; background: transparent; border: none; box-shadow: none;";
    if (parent) parent.replaceChild(wrapper, btn);
    wrapper.appendChild(btn);
  }

  const btn = wrapper.querySelector("a") as HTMLAnchorElement | null;
  if (!btn) return;

  const safeName = escapeHTML(displayName);
  const safeAvatar = sanitizeUrl(avatarUrl);

  // Styles for the avatar + username link
  btn.href = targetHref;
  btn.style.cssText = "display: flex; align-items: center; gap: 7px; text-decoration: none; background: transparent !important; box-shadow: none !important; border: none !important; padding: 0; margin: 0; height: auto;";
  btn.innerHTML = `
    <img src="${safeAvatar}" alt="" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; border: 1.5px solid rgba(0, 0, 0, 0.12); transition: transform 0.2s; flex-shrink: 0;" />
    <span class="nav-user-pill-name" style="color: #18181b; font-size: 13px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; display: inline-block;">${safeName}</span>
  `;

  const firstIcon = btn.firstElementChild as HTMLElement | null;
  if (firstIcon) {
    btn.onmouseenter = () => { firstIcon.style.transform = "scale(1.05)"; };
    btn.onmouseleave = () => { firstIcon.style.transform = "scale(1)"; };
  }

  // Add separator and logout button if not present
  if (!wrapper.querySelector(".nav-sep")) {
    const sep = document.createElement("span");
    sep.className = "nav-sep";
    sep.style.cssText = "color: rgba(0, 0, 0, 0.18); font-size: 13px; margin: 0 4px;";
    sep.textContent = "|";
    wrapper.appendChild(sep);
  }

  if (!wrapper.querySelector(".btn-logout")) {
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "btn-logout";
    logoutBtn.title = "Se Déconnecter";
    logoutBtn.onclick = (window as any).handleUserLogout;
    logoutBtn.style.cssText = "background: none; border: none; color: #dc2626; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0 2px; transition: all 0.2s;";
    logoutBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket" style="font-size: 13px;"></i>';

    logoutBtn.onmouseenter = () => {
      logoutBtn.style.color = "#991b1b";
      logoutBtn.style.transform = "scale(1.15)";
    };
    logoutBtn.onmouseleave = () => {
      logoutBtn.style.color = "#dc2626";
      logoutBtn.style.transform = "scale(1)";
    };

    wrapper.appendChild(logoutBtn);
  }
}

function applyRolePermissions(role: any) {
  const rawUser = localStorage.getItem("richman_user");
  const userData = rawUser ? JSON.parse(rawUser) : null;
  const userRolesList = (userData && Array.isArray(userData.roles)) ? userData.roles : [];

  const hasHotelRole = role === 'gerant_hotel' || userRolesList.some((r: any) => {
    const n = (typeof r === 'string' ? r : r.name || '').toLowerCase();
    return n.includes('hôtel') || n.includes('hotel');
  });

  const hasCarsRole = role === 'gerant_vehicules' || userRolesList.some((r: any) => {
    const n = (typeof r === 'string' ? r : r.name || '').toLowerCase();
    return n.includes('véhicule') || n.includes('vehicule') || n.includes('voiture');
  });

  if (hasHotelRole && hasCarsRole) {
    // Dual Manager: has access to BOTH hotel and cars! Only hide users and logs if not owner/admin
    if (role !== 'owner' && role !== 'admin') {
      const forbiddenTabs = ['users', 'logs'];
      forbiddenTabs.forEach(tabKey => {
        const btn = document.querySelector(`.admin-nav-item[data-tab="${tabKey}"]`) as HTMLElement | null;
        if (btn) btn.style.display = 'none';
        const section = document.getElementById(`tab-${tabKey}`) as HTMLElement | null;
        if (section) section.style.display = 'none';
      });

      const sectionTitles = document.querySelectorAll<HTMLElement>('.admin-nav-section-title');
      sectionTitles.forEach(st => {
        const txt = st.textContent ? st.textContent.trim() : '';
        if (txt === 'Général') {
          st.style.display = 'none';
        }
      });
    }
    return;
  }

  if (role === 'gerant_hotel') {
    const forbiddenTabs = ['fleet', 'bookings-cars', 'tickets-cars', 'ctg-database', 'users', 'logs', 'stats-general'];
    forbiddenTabs.forEach(tabKey => {
      const btn = document.querySelector(`.admin-nav-item[data-tab="${tabKey}"]`) as HTMLElement | null;
      if (btn) btn.style.display = 'none';
      const section = document.getElementById(`tab-${tabKey}`) as HTMLElement | null;
      if (section) section.style.display = 'none';
    });

    const sectionTitles = document.querySelectorAll<HTMLElement>('.admin-nav-section-title');
    sectionTitles.forEach(st => {
      const txt = st.textContent ? st.textContent.trim() : '';
      if (txt === 'Voitures' || txt === 'Véhicules' || txt === 'Général') {
        st.style.display = 'none';
      }
    });

    const currentActive = document.querySelector('.admin-nav-item.active');
    if (!currentActive || forbiddenTabs.includes((currentActive as HTMLElement).dataset.tab)) {
      (window as any).switchAdminTab('suites');
    }
  } else if (role === 'gerant_vehicules') {
    const forbiddenTabs = ['suites', 'bookings-suites', 'tickets-suites', 'users', 'logs', 'stats-general'];
    forbiddenTabs.forEach(tabKey => {
      const btn = document.querySelector(`.admin-nav-item[data-tab="${tabKey}"]`) as HTMLElement | null;
      if (btn) btn.style.display = 'none';
      const section = document.getElementById(`tab-${tabKey}`) as HTMLElement | null;
      if (section) section.style.display = 'none';
    });

    const sectionTitles = document.querySelectorAll<HTMLElement>('.admin-nav-section-title');
    sectionTitles.forEach(st => {
      const txt = st.textContent ? st.textContent.trim() : '';
      if (txt === 'Hébergements' || txt === 'Général') {
        st.style.display = 'none';
      }
    });

    const currentActive = document.querySelector('.admin-nav-item.active');
    if (!currentActive || forbiddenTabs.includes((currentActive as HTMLElement).dataset.tab)) {
      (window as any).switchAdminTab('fleet');
    }
  }
}

export function bindAdminUserCardDetails(displayName: any, avatarUrl: any, isOwnerFlag: any, customRole?: any) {
  const adminAvatar = document.getElementById("admin-user-avatar") as HTMLImageElement | null;
  const adminInitial = document.getElementById("admin-user-initial");
  const adminName = document.getElementById("admin-user-name");
  const adminRole = document.getElementById("admin-user-role");

  const effectiveRole = customRole || (isOwnerFlag ? "owner" : "admin");
  if (adminName) adminName.textContent = displayName || "NALYD";

  const rawUser = localStorage.getItem("richman_user");
  const userData = rawUser ? JSON.parse(rawUser) : null;
  const userRolesList = (userData && Array.isArray(userData.roles)) ? userData.roles : [];

  const hasHotelRole = effectiveRole === 'gerant_hotel' || userRolesList.some((r: any) => {
    const n = (typeof r === 'string' ? r : r.name || '').toLowerCase();
    return n.includes('hôtel') || n.includes('hotel');
  });

  const hasCarsRole = effectiveRole === 'gerant_vehicules' || userRolesList.some((r: any) => {
    const n = (typeof r === 'string' ? r : r.name || '').toLowerCase();
    return n.includes('véhicule') || n.includes('vehicule') || n.includes('voiture');
  });

  if (adminRole) {
    if (effectiveRole === "owner") {
      adminRole.textContent = "Fondateur";
    } else if (hasHotelRole && hasCarsRole) {
      adminRole.textContent = "Gérant Hôtel & Flotte";
    } else if (effectiveRole === "gerant_hotel" || hasHotelRole) {
      adminRole.textContent = "Gérant Hôtel";
    } else if (effectiveRole === "gerant_vehicules" || hasCarsRole) {
      adminRole.textContent = "Gérant Véhicules";
    } else {
      adminRole.textContent = "Administrateur";
    }
  }

  if (adminAvatar && avatarUrl && !avatarUrl.includes("logo.webp")) {
    adminAvatar.src = avatarUrl;
    adminAvatar.style.display = "block";
    if (adminInitial) adminInitial.style.display = "none";
  } else if (adminInitial) {
    adminInitial.textContent = (displayName || "N").charAt(0).toUpperCase();
    adminInitial.style.display = "grid";
    if (adminAvatar) adminAvatar.style.display = "none";
  }

  applyRolePermissions(effectiveRole);
}

document.addEventListener("DOMContentLoaded", () => {
  // ==========================================================================
  // Supabase Auth & Discord OAuth Integration
  // (client fourni par l'import du noyau ../core/supabase)
  // ==========================================================================

  // 1) Tab Switcher & Rules Accordion Handlers
  (window as any).switchAuthTab = function (tab: any) {
    const tabLogin = document.getElementById("tab-btn-login");
    const tabRegister = document.getElementById("tab-btn-register");
    const paneLogin = document.getElementById("pane-login");
    const paneRegister = document.getElementById("pane-register");
    const onboardPanel = document.getElementById("auth-onboarding-panel");
    const errBanner = document.getElementById("auth-error-banner");
    if (errBanner) errBanner.style.display = "none";
    if (onboardPanel) onboardPanel.style.display = "none";

    if (tab === 'register') {
      if (tabLogin) tabLogin.classList.remove("active");
      if (tabRegister) tabRegister.classList.add("active");
      if (paneLogin) paneLogin.classList.remove("active");
      if (paneRegister) paneRegister.classList.add("active");
    } else {
      if (tabRegister) tabRegister.classList.remove("active");
      if (tabLogin) tabLogin.classList.add("active");
      if (paneRegister) paneRegister.classList.remove("active");
      if (paneLogin) paneLogin.classList.add("active");
    }
  };

  (window as any).toggleAuthRules = function () {
    const content = document.getElementById("rules-content");
    const chevron = document.getElementById("rules-chevron");
    if (!content) return;
    const isHidden = content.style.display === "none" || !content.style.display;
    content.style.display = isHidden ? "block" : "none";
    if (chevron) {
      (chevron as HTMLElement).style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
    }
  };

  // 1b) Discord OAuth Direct Login
  const discordLoginBtn = document.querySelector(".social-grid.single-social button") || document.getElementById("btn-discord-login");
  if (discordLoginBtn && supabaseClient) {
    discordLoginBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        sessionStorage.removeItem("richman_pending_reg");
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: "discord",
          options: {
            scopes: "identify email guilds.join",
            redirectTo: window.location.origin + "/login.html"
          }
        });
        if (error) throw error;
      } catch (err: any) {
        console.error("Supabase Discord Auth Error:", err.message);
        showToast("Erreur de connexion Discord : " + err.message, "danger");
      }
    });
  }

  // 1c) Inscription RP Form Submission (Stores pending data & launches OAuth)
  const formRpReg = document.getElementById("form-rp-registration");
  if (formRpReg && supabaseClient) {
    formRpReg.addEventListener("submit", async (e) => {
      e.preventDefault();
      const first = (document.getElementById("reg-firstname") as HTMLInputElement | null)?.value.trim();
      const last = (document.getElementById("reg-lastname") as HTMLInputElement | null)?.value.trim();
      const rpid = (document.getElementById("reg-rpid") as HTMLInputElement | null)?.value.trim();
      const accepted = (document.getElementById("reg-accept-rules") as HTMLInputElement | null)?.checked;

      if (!first || !last || !rpid) {
        showToast("Veuillez remplir tous les champs RP obligatoires.", "warning");
        return;
      }
      if (!accepted) {
        showToast("Vous devez accepter le règlement pour continuer.", "warning");
        return;
      }

      sessionStorage.setItem("richman_pending_reg", JSON.stringify({
        prenom: first,
        nom: last,
        rpId: rpid,
        acceptedRules: true
      }));

      const btnSubmit = document.getElementById("btn-submit-register") as HTMLButtonElement | null;
      if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Redirection Discord...';
        btnSubmit.disabled = true;
      }

      try {
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: "discord",
          options: {
            scopes: "identify email guilds.join",
            redirectTo: window.location.origin + "/login.html"
          }
        });
        if (error) throw error;
      } catch (err: any) {
        console.error("Erreur OAuth Discord Inscription:", err);
        showToast("Erreur Discord : " + err.message, "danger");
        if (btnSubmit) {
          btnSubmit.innerHTML = '<i class="fa-brands fa-discord"></i><span>Créer mon profil RP & Lier Discord</span>';
          btnSubmit.disabled = false;
        }
      }
    });
  }

  // 1d) Dynamic Onboarding Finish Form Submission
  const formOnboardFinish = document.getElementById("form-onboarding-finish");
  if (formOnboardFinish) {
    formOnboardFinish.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btnSubmit = document.getElementById("btn-submit-onboard") as HTMLButtonElement | null;
      const origText = btnSubmit ? btnSubmit.innerHTML : "";
      if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enregistrement en cours...';
        btnSubmit.disabled = true;
      }

      const first = (document.getElementById("onboard-firstname") as HTMLInputElement | null)?.value.trim();
      const last = (document.getElementById("onboard-lastname") as HTMLInputElement | null)?.value.trim();
      const rpid = (document.getElementById("onboard-rpid") as HTMLInputElement | null)?.value.trim();
      const accepted = (document.getElementById("onboard-accept-rules") as HTMLInputElement | null)?.checked;

      if (!first || !last || !rpid) {
        showToast("Veuillez remplir tous les champs RP.", "warning");
        if (btnSubmit) { btnSubmit.innerHTML = origText; btnSubmit.disabled = false; }
        return;
      }

      try {
        const sessionRes = await supabaseClient.auth.getSession();
        const session = sessionRes.data?.session;
        if (!session || !session.user) {
          throw new Error("Session Discord introuvable. Veuillez recharger la page.");
        }

        const user = session.user;
        const discordUserId = user.user_metadata?.provider_id || user.user_metadata?.sub || (user.identities && user.identities[0]?.id) || user.id || "";
        const providerToken = session.provider_token || null;

        const regResp = await botFetch('/api/register-member', {
          method: "POST",
          body: JSON.stringify({
            discordId: discordUserId,
            providerToken,
            firstName: first,
            lastName: last,
            rpId: rpid,
            acceptedRules: true,
            userId: user.id
          })
        });

        if (!regResp.ok) {
          const errJson = await regResp.json().catch(() => ({}));
          throw new Error(errJson.error || ("Status HTTP " + regResp.status));
        }

        const regData = await regResp.json();
        const finalNickname = regData.nickname || `${first} ${last} | ${rpid}`;
        const finalAvatar = regData.avatarUrl || user.user_metadata?.avatar_url || "assets/logo.webp";

        localStorage.setItem("richman_user", JSON.stringify({
          name: finalNickname,
          role: "client",
          avatar: finalAvatar,
          discord_id: discordUserId,
          rpId: rpid,
          is_admin: false
        }));

        showToast(`🎉 Bienvenue ${finalNickname} ! Enregistrement validé avec succès.`, "success");

        setTimeout(() => {
          window.location.href = "index.html";
        }, 800);
      } catch (err: any) {
        console.error("Erreur validation onboarding:", err);
        const authErrorBanner = document.getElementById("auth-error-banner");
        if (authErrorBanner) {
          authErrorBanner.style.display = "block";
          authErrorBanner.innerHTML = `⚠️ Erreur lors de l'enregistrement : ${err.message}`;
        }
        if (btnSubmit) {
          btnSubmit.innerHTML = origText;
          btnSubmit.disabled = false;
        }
      }
    });
  }

  // Check if user is already registered on website
  const existingUserStr = localStorage.getItem("richman_user");
  const authFormWrap = document.querySelector(".auth-right-content") || document.querySelector(".auth-form-container");
  if (existingUserStr && authFormWrap && window.location.pathname.includes("login")) {
    try {
      const existingUser = JSON.parse(existingUserStr);
      authFormWrap.innerHTML = `
        <div style="text-align: center; padding: 10px 0 16px 0;">
          <div style="width: 60px; height: 60px; border-radius: 50%; background: #ffffff; border: 1px solid rgba(255, 255, 255, 0.4); display: grid; place-items: center; box-shadow: 0 0 25px rgba(255, 255, 255, 0.35); margin: 0 auto 16px auto;">
            <img src="assets/logo.webp" alt="Richman Estate" style="width: 38px; height: 38px; object-fit: contain;">
          </div>
          <h2 style="font-size: 22px; font-weight: 700; color: #ffffff; margin-bottom: 6px;">Profil Connecté</h2>
          <p style="font-size: 13.5px; color: #a1a1aa; line-height: 1.5; margin-bottom: 18px;">Vous êtes déjà authentifié sur Richman Estate.</p>
        </div>
        <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.12); padding: 18px; border-radius: 16px; margin: 0 0 18px 0; text-align: center;">
          <i class="fa-solid fa-circle-check" style="font-size: 32px; color: #34d399; margin-bottom: 8px; display: block;"></i>
          <h3 style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 4px;">${escapeHTML(existingUser.name)}</h3>
          ${existingUser.rpId ? `<p style="color: #8e8e8e; font-size: 12.5px;">ID RP : ${escapeHTML(existingUser.rpId)}</p>` : ''}
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <a href="index.html" class="btn-register-submit" style="display: flex; align-items: center; justify-content: center; text-decoration: none; text-align: center; line-height: normal; gap: 8px;">
            <i class="fa-solid fa-house"></i>
            <span>Accéder à la page d'accueil</span>
          </a>
          <button type="button" onclick="window.handleUserLogout()" style="background: transparent; border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; padding: 12px; border-radius: 12px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <i class="fa-solid fa-right-from-bracket"></i>
            <span>Se déconnecter / Changer de compte</span>
          </button>
        </div>
      `;
    } catch (err) {
      console.error(err);
    }
  }

  // Global User Logout Handler
  (window as any).handleUserLogout = async function () {
    localStorage.removeItem("richman_user");
    localStorage.removeItem("richman_role");
    localStorage.removeItem("richman_is_owner");
    sessionStorage.removeItem("richman_pending_reg");
    if (supabaseClient) {
      try { await supabaseClient.auth.signOut(); } catch (e) { console.error(e); }
    }
    window.location.href = "login.html";
  };

  // 3) Update Header Navigation & Handle Discord OAuth Detection
  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      const authNavBtn = document.querySelector(".header-right .btn-signin") || document.querySelector("a[href='login.html']");
      const authErrorBanner = document.getElementById("auth-error-banner");
      const isLoginPage = window.location.pathname.includes("login");

      if (session && session.user) {
        const user = session.user;
        const rawName = user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.custom_claims?.global_name || user.email?.split("@")[0] || "Citoyen";

        const discordUserId = user.user_metadata?.provider_id ||
                              user.user_metadata?.sub ||
                              (user.identities && user.identities[0]?.id) ||
                              user.id || "";

        let avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || "";
        const discordAvatarHash = user.user_metadata?.avatar;
        if (!avatar && discordAvatarHash && discordUserId) {
          avatar = `https://cdn.discordapp.com/avatars/${discordUserId}/${discordAvatarHash}.png`;
        }

        // Fetch verified role strictly from Supabase profiles database (protected by SQL trigger)
        let verifiedRole = 'client';
        try {
          const { data: dbProf } = await supabaseClient.from("profiles").select("role").eq("id", user.id).maybeSingle();
          if (dbProf && dbProf.role) {
            verifiedRole = dbProf.role;
          }
        } catch (e: any) {
          console.warn("Erreur lecture profil sécurisé:", e.message);
        }

        // SÉCURITÉ : le statut fondateur dépend EXCLUSIVEMENT du rôle en base
        // (protégé par les triggers SQL). Les métadonnées user_metadata.provider_id
        // sont forgeables par un compte email — on ne leur fait plus confiance.
        const isMasterOwner = verifiedRole === 'owner';
        const isOwner = isMasterOwner;
        const isHotelManager = verifiedRole === 'gerant_hotel';
        const isCarManager = verifiedRole === 'gerant_vehicules';
        const isAdmin = isOwner || verifiedRole === 'admin' || isHotelManager || isCarManager;
        let userRole = isOwner ? "owner" : (isHotelManager ? "gerant_hotel" : (isCarManager ? "gerant_vehicules" : (isAdmin ? "admin" : "client")));

        localStorage.setItem("richman_role", userRole);
        if (isOwner) {
          localStorage.setItem("richman_is_owner", "true");
        } else {
          localStorage.removeItem("richman_is_owner");
        }

        // Admin Access Guard for non-staff clients
        const isStaff = isOwner || isAdmin || userRole === 'gerant_hotel' || userRole === 'gerant_vehicules';
        if (window.location.pathname.includes("admin") && !isStaff) {
          showToast("🚫 Accès Refusé : La console d'administration est strictement réservée au personnel habilité.", "danger");
          setTimeout(() => { window.location.href = "index.html"; }, 1200);
          return;
        }

        // Strict Role & Server Verification
        if (discordUserId) {
          const providerToken = session.provider_token || null;

          // A) If registration data is waiting in sessionStorage, complete it immediately (Single Flight Lock)
          const pendingRegStr = sessionStorage.getItem("richman_pending_reg");
          if (pendingRegStr && !(window as any)._isProcessingPendingRegistration) {
            (window as any)._isProcessingPendingRegistration = true;
            sessionStorage.removeItem("richman_pending_reg");
            try {
              const pending = JSON.parse(pendingRegStr);
              const regResp = await botFetch('/api/register-member', {
                method: "POST",
                body: JSON.stringify({
                  discordId: discordUserId,
                  providerToken,
                  firstName: pending.prenom,
                  lastName: pending.nom,
                  rpId: pending.rpId,
                  acceptedRules: true,
                  userId: user.id
                })
              });

              if (regResp.ok) {
                const regData = await regResp.json();
                const finalNickname = regData.nickname || `${pending.prenom} ${pending.nom} | ${pending.rpId}`;
                const finalAvatar = regData.avatarUrl || avatar || "assets/logo.webp";

                localStorage.setItem("richman_user", JSON.stringify({
                  name: finalNickname,
                  role: userRole,
                  avatar: finalAvatar,
                  discord_id: discordUserId,
                  rpId: pending.rpId,
                  is_admin: isStaff || isOwner
                }));

                renderHeaderNavUserPill(finalNickname, finalAvatar, isStaff ? "admin.html" : "client.html");
                bindAdminUserCardDetails(finalNickname, finalAvatar, isOwner, userRole);

                if (isLoginPage) {
                  window.location.href = "index.html";
                }
                return;
              }
            } catch (err: any) {
              console.warn("⚠️ Erreur lors de l'enregistrement automatique :", err.message);
            } finally {
              (window as any)._isProcessingPendingRegistration = false;
            }
          }

          // B) Standard Role & Profile Check
          botFetch('/api/check-user-roles', {
            method: "POST",
            body: JSON.stringify({ discordId: discordUserId, providerToken })
          })
          .then(res => {
            if (!res.ok) throw new Error("Bot API status " + res.status);
            return res.json();
          })
          .catch(err => {
            console.warn("⚠️ Bot Sync API injoignable :", err.message);
            return {
              onServer: false,
              hasMembreRole: false,
              hasCitoyenRole: false,
              botUnreachable: true,
              nickname: rawName,
              avatarUrl: avatar
            };
          })
          .then(res => {
            const finalAvatar = res?.avatarUrl || avatar || "assets/logo.webp";
            const displayName = res?.nickname || rawName || "Citoyen";

            // Auto-sync profile details into public.profiles
            supabaseClient.from("profiles").upsert({
              id: user.id,
              discord_id: discordUserId,
              full_name: displayName,
              avatar_url: finalAvatar,
              email: user.email
            }, { onConflict: "id" }).then(() => {}, () => {});

            if (isMasterOwner) {
              // Master Owner bypasses role check restrictions
              localStorage.setItem("richman_user", JSON.stringify({
                name: displayName,
                role: userRole,
                avatar: finalAvatar,
                discord_id: discordUserId,
                is_admin: true
              }));
              renderHeaderNavUserPill(displayName, finalAvatar, "admin.html");
              bindAdminUserCardDetails(displayName, finalAvatar, true, userRole);
              if (isLoginPage) {
                window.location.href = "index.html";
              }
              return;
            }

            if (res.botUnreachable) {
              // Bot offline fallback: still allow the user to be recognized as logged in and redirected
              localStorage.setItem("richman_user", JSON.stringify({
                name: displayName,
                role: userRole,
                avatar: finalAvatar,
                discord_id: discordUserId,
                is_admin: isStaff || isOwner
              }));
              renderHeaderNavUserPill(displayName, finalAvatar, isStaff ? "admin.html" : "client.html");
              bindAdminUserCardDetails(displayName, finalAvatar, isOwner, userRole);
              if (isLoginPage) {
                window.location.href = "index.html";
              }
              return;
            }

            if (!res.hasCitoyenRole && !isStaff) {
              // User has connected Discord but is not yet registered (missing RP Citizen profile / role)
              const tabsContainer = document.getElementById("auth-tabs-container");
              const paneLogin = document.getElementById("pane-login");
              const paneRegister = document.getElementById("pane-register");
              const onboardPanel = document.getElementById("auth-onboarding-panel");
              const onboardName = document.getElementById("onboard-user-name");
              const onboardAvatar = document.getElementById("onboard-user-avatar") as HTMLImageElement | null;
              const onboardFirst = document.getElementById("onboard-firstname") as HTMLInputElement | null;
              const onboardLast = document.getElementById("onboard-lastname") as HTMLInputElement | null;

              if (onboardPanel && isLoginPage) {
                if (tabsContainer) tabsContainer.style.display = "none";
                if (paneLogin) paneLogin.style.display = "none";
                if (paneRegister) paneRegister.style.display = "none";
                if (authErrorBanner) authErrorBanner.style.display = "none";

                onboardPanel.style.display = "block";
                if (onboardName) onboardName.textContent = displayName || rawName;
                if (onboardAvatar) onboardAvatar.src = finalAvatar;

                // Attempt to prefill first/last if available
                const nameParts = (rawName || "").split(" ");
                if (nameParts.length >= 2) {
                  if (onboardFirst && !onboardFirst.value) onboardFirst.value = nameParts[0];
                  if (onboardLast && !onboardLast.value) onboardLast.value = nameParts.slice(1).join(" ");
                }
              } else if (window.location.pathname.includes("vehicules.html") || window.location.pathname.includes("suites.html") || window.location.pathname.includes("contact.html")) {
                window.location.href = "login.html";
              }
            } else {
              // Registered & Authorized Success
              localStorage.setItem("richman_user", JSON.stringify({
                name: displayName,
                role: userRole,
                roles: res?.roles || [],
                avatar: finalAvatar,
                discord_id: discordUserId,
                is_admin: isStaff || isOwner
              }));
              renderHeaderNavUserPill(displayName, finalAvatar, isStaff ? "admin.html" : "client.html");
              bindAdminUserCardDetails(displayName, finalAvatar, isOwner, userRole);
              if (isLoginPage) {
                window.location.href = "index.html";
              }
            }
          });
        }
      } else {
        // Not logged in -> Only protect the admin panel
        if (window.location.pathname.includes("admin.html") || window.location.pathname.endsWith("/admin")) {
          window.location.href = "login.html";
        }
      }
    });
  }

  // Concierge Contact Form & Auth Verification
  const contactForm = document.getElementById("concierge-contact-form") as HTMLFormElement | null;
  const contactAuthGate = document.getElementById("contact-auth-gate");
  const submitBtn = document.getElementById("btn-submit-contact") as HTMLButtonElement | null;

  async function checkContactEligibility() {
    const rawUser = localStorage.getItem("richman_user");
    const activeUser = rawUser ? JSON.parse(rawUser) : null;

    if (!activeUser || !activeUser.name) {
      if (contactAuthGate) {
        contactAuthGate.style.display = "block";
        contactAuthGate.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #fca5a5; padding: 14px; border-radius: 12px; text-align: center;">
            <i class="fa-solid fa-lock" style="font-size: 20px; color: #ef4444; margin-bottom: 6px; display: block;"></i>
            <strong style="font-size: 14px; color: #fff;">Connexion Requise</strong>
            <p style="margin: 6px 0 12px 0; font-size: 12.5px; color: #d4d4d8;">Vous devez être connecté avec votre compte Discord pour envoyer un message.</p>
            <a href="login.html" class="admin-btn-primary" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; padding: 9px 18px; font-size: 13px; border-radius: 10px; background: #5865F2; color: #fff; border: none; font-weight: 600;"><i class="fa-brands fa-discord"></i> Se Connecter avec Discord</a>
          </div>
        `;
      }
      if (contactForm) {
        contactForm.querySelectorAll("input, select, textarea").forEach(el => { (el as HTMLInputElement).disabled = true; });
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = "0.5";
        submitBtn.style.cursor = "not-allowed";
      }
      return false;
    }

    // Prefill user details
    const nameInput = document.getElementById("contact-name") as HTMLInputElement | null;
    if (nameInput && !nameInput.value) nameInput.value = activeUser.name;

    // Check Discord roles via bot API
    const isOwner = localStorage.getItem("richman_is_owner") === "true";
    let canContact = isOwner;

    if (!isOwner && activeUser.discord_id) {
      try {
        const res = await botFetch(`/api/check-user-roles?discordId=${activeUser.discord_id}`);
        if (res.ok) {
          const roleData = await res.json();
          canContact = Boolean(roleData.canContact || roleData.hasCitoyenRole || roleData.hasMembreRole);
        }
      } catch (e) {
        // Fallback: accept if user profile exists
        canContact = true;
      }
    } else if (!isOwner && !activeUser.discord_id) {
      canContact = true;
    }

    if (!canContact) {
      if (contactAuthGate) {
        contactAuthGate.style.display = "block";
        contactAuthGate.innerHTML = `
          <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); color: #fde68a; padding: 14px; border-radius: 12px; text-align: center;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 20px; color: #f59e0b; margin-bottom: 6px; display: block;"></i>
            <strong style="font-size: 14px; color: #fff;">Grade Discord Requis</strong>
            <p style="margin: 6px 0 0 0; font-size: 12.5px; color: #d4d4d8;">Vous devez posséder le grade <strong>Citoyen</strong> ou <strong>Membre</strong> sur notre Discord pour envoyer une demande.</p>
          </div>
        `;
      }
      if (contactForm) {
        contactForm.querySelectorAll("input, select, textarea").forEach(el => { (el as HTMLInputElement).disabled = true; });
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = "0.5";
        submitBtn.style.cursor = "not-allowed";
      }
      return false;
    }

    // Access granted
    if (contactAuthGate) {
      contactAuthGate.style.display = "block";
      contactAuthGate.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); color: #86efac; padding: 8px 12px; border-radius: 10px; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <i class="fa-solid fa-circle-check" style="color: #10b981;"></i>
          <span>Connecté : <strong>${escapeHTML(activeUser.name)}</strong> • Accès Support validé</span>
        </div>
      `;
    }
    if (contactForm) {
      contactForm.querySelectorAll("input, select, textarea").forEach(el => { (el as HTMLInputElement).disabled = false; });
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = "1";
      submitBtn.style.cursor = "pointer";
    }
    return true;
  }

  if (contactForm) {
    contactForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const origText = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transmission en cours...';
        submitBtn.disabled = true;
      }

      const clientName = (document.getElementById("contact-name") as HTMLInputElement | null)?.value || "Citoyen";
      const phone = (document.getElementById("contact-phone") as HTMLInputElement | null)?.value || "";
      const subject = (document.getElementById("contact-subject") as HTMLInputElement | null)?.value || "Demande de Contact";
      const message = (document.getElementById("contact-message") as HTMLTextAreaElement | null)?.value || "";
      const activeUser = JSON.parse(localStorage.getItem("richman_user") || "{}");

      try {
        let insertedId = null;
        // 1) Save in Supabase contact_messages table
        if (supabaseClient) {
          const { data: inserted } = await supabaseClient.from("contact_messages").insert([{
            name: clientName,
            phone: phone,
            subject: subject,
            message: message,
            discord_id: activeUser.discord_id || null,
            status: "pending"
          }]).select();

          if (inserted && inserted.length > 0) {
            insertedId = inserted[0].id;
          }

          try {
            await supabaseClient.from("logs").insert([{
              action: `Demande de Contact [${subject}] de ${clientName} (${phone}) : "${message}"`,
              user_name: clientName,
              type: "info"
            }]);
          } catch (logErr) {
            console.warn("Log insert warning:", logErr);
          }
        }

        // 2) Create Discord Ticket in category 1537808868636238024
        botFetch('/api/send-contact-message', {
          method: "POST",
          body: JSON.stringify({
            contact_id: insertedId,
            name: clientName,
            phone: phone,
            subject: subject,
            message: message,
            discordId: activeUser.discord_id || null
          })
        }).catch(err => console.warn("Discord contact message error:", err));

        showToast("✉️ Demande transmise ! Un salon ticket dédié a été ouvert sur Discord et un MP vous a été envoyé avec le lien direct.", "success");
        contactForm.reset();
        closeContactModal();
      } catch (err: any) {
        console.error(err);
        showToast("Erreur lors de l'envoi : " + err.message, "danger");
      } finally {
        if (submitBtn) {
          submitBtn.innerHTML = origText;
          submitBtn.disabled = false;
        }
      }
    });
  }

  // Contact Modal Open / Close Logic
  const contactModalOverlay = document.getElementById("contact-modal-overlay");
  const btnOpenContactModal = document.getElementById("btn-open-contact-modal");
  const contactModalCloseBtn = document.getElementById("contact-modal-close-btn");
  const contactModalCancelBtn = document.getElementById("contact-modal-cancel-btn");

  function openContactModal() {
    if (contactModalOverlay) {
      contactModalOverlay.classList.add("active");
      contactModalOverlay.removeAttribute("aria-hidden");
      checkContactEligibility();
    }
  }

  function closeContactModal() {
    if (contactModalOverlay) {
      if (document.activeElement && contactModalOverlay.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      contactModalOverlay.classList.remove("active");
      contactModalOverlay.setAttribute("aria-hidden", "true");
    }
  }

  if (btnOpenContactModal) btnOpenContactModal.addEventListener("click", openContactModal);
  if (contactModalCloseBtn) contactModalCloseBtn.addEventListener("click", closeContactModal);
  if (contactModalCancelBtn) contactModalCancelBtn.addEventListener("click", closeContactModal);
  if (contactModalOverlay) {
    contactModalOverlay.addEventListener("click", (e) => {
      if (e.target === contactModalOverlay) closeContactModal();
    });
  }

  // ---- Compat HTML : handlers globaux (affectations window d'origine conservées) ----
  (window as any).renderHeaderNavUserPill = renderHeaderNavUserPill;
  (window as any).bindAdminUserCardDetails = bindAdminUserCardDetails;
});
