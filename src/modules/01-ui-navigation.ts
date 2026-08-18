/* ==========================================================================
   Richman Estate — 01-ui-navigation.ts
   UI globale : compteurs animés, navigation mobile, onglets login/register
   Porté de 01-ui-navigation.js (découpage historique de main.js).
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // ==========================================================================
  // 1) Stats Counter Animation (IntersectionObserver + easeOutCubic)
  // ==========================================================================
  const statItems = document.querySelectorAll(".stat-item");

  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

  (window as any).animateCustomCounter = function (valueEl: any, targetVal: any, duration = 1200, decimals = 0) {
    if (!valueEl) return;
    if (valueEl._animFrameId) {
      cancelAnimationFrame(valueEl._animFrameId);
      valueEl._animFrameId = null;
    }
    const startVal = parseFloat(valueEl.textContent) || 0;
    const target = parseFloat(targetVal);
    if (isNaN(target)) return;

    valueEl.setAttribute("data-target", target);
    if (startVal === target && valueEl.textContent.trim() !== "" && valueEl.textContent.trim() !== "0") {
      valueEl.textContent = target.toFixed(decimals);
      return;
    }
    let startTime: number | null = null;

    function step(timestamp: number) {
      if (startTime === null) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);
      const currentVal = startVal + (target - startVal) * easedProgress;

      valueEl.textContent = currentVal.toFixed(decimals);

      if (progress < 1) {
        valueEl._animFrameId = requestAnimationFrame(step);
      } else {
        valueEl.textContent = target.toFixed(decimals);
        valueEl._animFrameId = null;
      }
    }

    valueEl._animFrameId = requestAnimationFrame(step);
  };

  function animateStat(statEl: any, index: number) {
    const valueEl = statEl.querySelector(".stat-value");
    if (!valueEl) return;

    const target = parseFloat(valueEl.getAttribute("data-target")) || 0;
    const decimals = parseInt(valueEl.getAttribute("data-decimals") || "0", 10);

    const duration = 1400 + index * 70;
    const startDelay = 300 + index * 80;

    setTimeout(() => {
      const liveTarget = parseFloat(valueEl.getAttribute("data-target")) || target;
      (window as any).animateCustomCounter(valueEl, liveTarget, duration, decimals);
    }, startDelay);
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const index = Array.from(statItems).indexOf(entry.target);
          animateStat(entry.target, index);
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.25 }
  );

  statItems.forEach((item) => observer.observe(item));

  // ==========================================================================
  // 2) Mobile Navigation & Sheet Drawer
  // ==========================================================================
  const burgerBtn = document.getElementById("burger-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  const mobileOverlay = document.getElementById("mobile-overlay");

  // Sync Logged-In User in Mobile Menu Drawer
  try {
    const rawUser = localStorage.getItem("richman_user");
    if (rawUser && mobileMenu) {
      const u = JSON.parse(rawUser);
      if (u && u.name) {
        const isOwner = localStorage.getItem("richman_is_owner") === "true";
        const isStaff = isOwner || u.is_admin || u.role === "admin" || u.role === "gerant_hotel" || u.role === "gerant_vehicules" || u.role === "owner";
        const targetHref = isStaff ? "admin.html" : "client.html";
        const avatarUrl = u.avatar || "assets/logo.webp";
        const roleLabel = isOwner ? "Fondateur & Owner" : isStaff ? "Staff Officiel" : "Membre Privilège";

        const signinBtnEl = mobileMenu.querySelector(".mobile-signin");
        if (signinBtnEl) {
          const userCard = document.createElement("div");
          userCard.className = "mobile-user-card";
          userCard.innerHTML = `
            <a href="${targetHref}" class="mobile-user-info">
              <img src="${avatarUrl}" alt="${u.name}" class="mobile-user-avatar" />
              <div class="mobile-user-details">
                <span class="mobile-user-name">${u.name}</span>
                <span class="mobile-user-role">${roleLabel}</span>
              </div>
            </a>
            <button class="mobile-user-logout" title="Se Déconnecter" aria-label="Se Déconnecter">
              <i class="fa-solid fa-right-from-bracket"></i>
            </button>
          `;

          const logoutBtn = userCard.querySelector(".mobile-user-logout");
          if (logoutBtn) {
            logoutBtn.addEventListener("click", () => {
              if ((window as any).handleUserLogout) {
                (window as any).handleUserLogout();
              } else {
                localStorage.removeItem("richman_user");
                localStorage.removeItem("richman_role");
                localStorage.removeItem("richman_is_owner");
                window.location.reload();
              }
            });
          }

          signinBtnEl.parentElement?.replaceChild(userCard, signinBtnEl);
        }
      }
    }
  } catch (e) {
    console.warn("[Richman] Mobile nav user sync error:", e);
  }

  const mobileLinks = document.querySelectorAll(
    ".mobile-nav-link, .mobile-signin, .mobile-user-info"
  );

  function openMenu() {
    if (!burgerBtn || !mobileMenu || !mobileOverlay) return;
    burgerBtn.classList.add("open");
    burgerBtn.setAttribute("aria-expanded", "true");
    mobileMenu.classList.add("active");
    mobileMenu.removeAttribute("aria-hidden");
    mobileOverlay.classList.add("active");
    mobileOverlay.removeAttribute("aria-hidden");
    document.body.classList.add("menu-open");
    document.body.style.overflow = "hidden";
  }

  function closeMenu() {
    if (!burgerBtn || !mobileMenu || !mobileOverlay) return;
    burgerBtn.classList.remove("open");
    burgerBtn.setAttribute("aria-expanded", "false");
    mobileMenu.classList.remove("active");
    mobileMenu.setAttribute("aria-hidden", "true");
    mobileOverlay.classList.remove("active");
    mobileOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("menu-open");
    document.body.style.overflow = "";
  }

  function toggleMenu() {
    const isOpen = burgerBtn && burgerBtn.classList.contains("open");
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  if (burgerBtn) {
    burgerBtn.addEventListener("click", toggleMenu);
  }

  if (mobileOverlay) {
    mobileOverlay.addEventListener("click", closeMenu);
  }

  mobileLinks.forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && burgerBtn && burgerBtn.classList.contains("open")) {
      closeMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (
      window.innerWidth > 860 &&
      burgerBtn &&
      burgerBtn.classList.contains("open")
    ) {
      closeMenu();
    }
  });

  // ==========================================================================
  // 3) Login / Register Interactive Features
  // ==========================================================================
  const passwordInput = document.getElementById("password") as HTMLInputElement | null;
  const passwordToggle = document.getElementById("password-toggle");
  const passwordToggleIcon = document.getElementById("password-toggle-icon");

  if (passwordToggle && passwordInput && passwordToggleIcon) {
    passwordToggle.addEventListener("click", () => {
      const isPassword = passwordInput.type === "password";
      passwordInput.type = isPassword ? "text" : "password";
      passwordToggleIcon.className = isPassword
        ? "fa-regular fa-eye-slash"
        : "fa-regular fa-eye";
    });
  }
});
