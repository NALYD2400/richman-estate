/* ==========================================================================
   Richman Estate — 11-stats-sync.ts
   Synchronisation des compteurs globaux (temps réel)
   ========================================================================== */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../core/config";
import { supabaseClient } from "../core/supabase";
import { loadPublicVehicles } from "./07-vehicles-showroom";
import { loadPublicSuites } from "./12-suites-showroom";
import { loadVehicles, loadSuites } from "./02-admin-crud";

document.addEventListener("DOMContentLoaded", () => {
  // ==========================================================================
  // GLOBAL STATS DYNAMIC SYNCHRONIZATION (All Pages)
  // ==========================================================================
  async function syncAllGlobalStats() {
    const suitesHomeEl = document.getElementById("stat-home-suites");
    const fleetHomeEl = document.getElementById("stat-home-vehicles");
    const fleetPageEl = document.getElementById("stat-fleet-count");
    const suitesPageEl = document.getElementById("stat-suites-count");

    if (!suitesHomeEl && !fleetHomeEl && !fleetPageEl && !suitesPageEl) return;

    let suitesCount: number | null = null;
    let fleetCount: number | null = null;

    // 1. Client Supabase (importé du noyau)
    try {
      const [sRes, vRes] = await Promise.all([
        supabaseClient.from("suites").select("id, status"),
        supabaseClient.from("vehicules").select("id, status")
      ]);
      if (!sRes.error && Array.isArray(sRes.data)) {
        suitesCount = sRes.data.length;
      }
      if (!vRes.error && Array.isArray(vRes.data)) {
        fleetCount = vRes.data.length;
      }
    } catch (e) {
      console.warn("Supabase SDK stats query:", e);
    }

    // 2. Fallback REST direct
    if (suitesCount === null || fleetCount === null) {
      try {
        const headers = {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
        };
        const [sRes, vRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/suites?select=id,status`, { headers }).then(r => r.json()),
          fetch(`${SUPABASE_URL}/rest/v1/vehicules?select=id,status`, { headers }).then(r => r.json())
        ]);
        if (Array.isArray(sRes)) {
          suitesCount = sRes.length;
        }
        if (Array.isArray(vRes)) {
          fleetCount = vRes.length;
        }
      } catch (e) {
        console.error("REST fallback query error:", e);
      }
    }

    // Update Home Page Elements
    if (suitesHomeEl && suitesCount !== null) {
      suitesHomeEl.setAttribute("data-target", String(suitesCount));
      if ((window as any).animateCustomCounter) (window as any).animateCustomCounter(suitesHomeEl, suitesCount, 1200, 0);
      else suitesHomeEl.textContent = String(suitesCount);
    }
    if (fleetHomeEl && fleetCount !== null) {
      fleetHomeEl.setAttribute("data-target", String(fleetCount));
      if ((window as any).animateCustomCounter) (window as any).animateCustomCounter(fleetHomeEl, fleetCount, 1200, 0);
      else fleetHomeEl.textContent = String(fleetCount);
    }

    // Update Catalogue Pages Elements
    if (fleetPageEl && fleetCount !== null) {
      fleetPageEl.setAttribute("data-target", String(fleetCount));
      if ((window as any).animateCustomCounter) (window as any).animateCustomCounter(fleetPageEl, fleetCount, 1200, 0);
      else fleetPageEl.textContent = String(fleetCount);
    }
    if (suitesPageEl && suitesCount !== null) {
      suitesPageEl.setAttribute("data-target", String(suitesCount));
      if ((window as any).animateCustomCounter) (window as any).animateCustomCounter(suitesPageEl, suitesCount, 1200, 0);
      else suitesPageEl.textContent = String(suitesCount);
    }
  }
  (window as any).syncAllGlobalStats = syncAllGlobalStats;
  (window as any).syncHomeStats = syncAllGlobalStats;

  // Run stats sync on page load and retry
  syncAllGlobalStats();
  setTimeout(syncAllGlobalStats, 300);
  setTimeout(syncAllGlobalStats, 900);

  // Load public vehicles if on vehicules page
  if (document.getElementById("public-fleet-grid") || window.location.pathname.includes("vehicules")) {
    setTimeout(() => loadPublicVehicles(), 200);
  }

  // Load public suites if on suites page
  if (document.getElementById("public-suites-grid") || window.location.pathname.includes("suites")) {
    setTimeout(() => loadPublicSuites(), 200);
  }

  // Real-time synchronization for Public Showroom & Admin Dashboard & Home Page
  try {
    supabaseClient
      .channel('public_fleet_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicules' }, () => {
        if (document.getElementById("public-fleet-grid") || window.location.pathname.includes("vehicules")) {
          loadPublicVehicles();
        }
        if (document.getElementById("fleet-admin-list")) {
          loadVehicles();
        }
        syncAllGlobalStats();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        if (document.getElementById("public-fleet-grid") || window.location.pathname.includes("vehicules")) {
          loadPublicVehicles();
        }
        if (document.getElementById("fleet-admin-list")) {
          loadVehicles();
          const loadBookings = (window as any).loadBookings;
          if (typeof loadBookings === 'function') loadBookings();
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suites' }, () => {
        if (document.getElementById("public-suites-grid") || window.location.pathname.includes("suites")) {
          loadPublicSuites();
        }
        if (document.getElementById("suites-admin-list")) {
          loadSuites();
        }
        syncAllGlobalStats();
      })
      .subscribe();
  } catch (e) { console.warn('[Richman]', e); }
});
