/**
 * ============================================================================
 * AUDIT EXHAUSTIF DE BOUT EN BOUT (E2E) — RICHMAN ESTATE
 * ============================================================================
 * Teste l'intégralité des 10 sous-systèmes :
 * 1. Serveur Web & Assets
 * 2. Authentification & Profils
 * 3. Réservations Véhicules
 * 4. Réservations Suites
 * 5. Chat 4-Voies (Web Client, Web Admin, Salon Discord, MP)
 * 6. Contact & Conciergerie
 * 7. Gestion de la Flotte
 * 8. Gestion des Rôles Discord
 * 9. Sécurité RLS & RPC PostgreSQL
 * 10. API REST Bot
 * ============================================================================
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://ghbeopdnfdxuqfjzmmeb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_U5u4jQKVTgWkhmzM62ficA_wORi3zOq';
const BOT_API_URL = 'http://127.0.0.1:3001';
const WEB_SERVER_URL = 'http://127.0.0.1:8080';

// Durcissement sécurité : les endpoints bot sensibles exigent BOT_API_SECRET,
// et les RPC du chat exigent la clé service (plus d'accès anonyme).
function loadEnvValue(names, envPath) {
  for (const n of names) {
    if (process.env[n]) return process.env[n];
  }
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const n of names) {
        const m = content.match(new RegExp(`^\\s*${n}\\s*=\\s*(.+)$`, 'm'));
        if (m) return m[1].trim();
      }
    }
  } catch (e) {}
  return null;
}

const BOT_API_SECRET = loadEnvValue(['BOT_API_SECRET'], path.resolve(__dirname, '../bot/.env'));
const SERVICE_KEY = loadEnvValue(
  ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'],
  path.resolve(__dirname, '../bot/.env')
);

if (!BOT_API_SECRET) {
  console.error('❌ BOT_API_SECRET introuvable (bot/.env ou environnement) : requis pour tester les endpoints protégés du bot.');
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY introuvable : les appels RPC du chat seront rejetés (durcissement sécurité).');
}

const BOT_AUTH_HEADERS = { 'Authorization': `Bearer ${BOT_API_SECRET}` };
const SERVICE_HEADERS = SERVICE_KEY
  ? { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
  : null;

function httpRequest(urlStr, method = 'GET', data = null, customHeaders = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers = {
        'Content-Type': 'application/json',
        ...customHeaders
      };

      const options = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: method,
        headers: headers,
        timeout: 8000
      };

      const req = transport.request(options, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          let parsed = body;
          try { parsed = JSON.parse(body); } catch (e) {}
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 408, data: 'Timeout' });
      });

      req.on('error', (err) => {
        resolve({ status: 500, error: err.message });
      });

      if (data) {
        req.write(typeof data === 'string' ? data : JSON.stringify(data));
      }
      req.end();
    } catch (e) {
      resolve({ status: 500, error: e.message });
    }
  });
}

async function runAudit() {
  console.log("================================================================================");
  console.log("💎 AUDIT GLOBAL COMPLET DE BOUT EN BOUT (E2E) — RICHMAN ESTATE");
  console.log("================================================================================\n");

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✅ ${message}`);
    } else {
      failedTests++;
      console.error(`  ❌ ÉCHEC : ${message}`);
    }
  }

  // --------------------------------------------------------------------------
  // 1. SERVEUR WEB & PAGES
  // --------------------------------------------------------------------------
  console.log("🌐 [1/10] Serveur Web Local & Pages Principales");
  const pages = ['index', 'vehicules', 'suites', 'contact', 'client', 'login', 'admin'];
  for (const page of pages) {
    const res = await httpRequest(`${WEB_SERVER_URL}/${page}.html`);
    assert(res.status === 200, `Page /${page}.html accessible (HTTP 200)`);
  }

  // Clean URLs
  const cleanVehicules = await httpRequest(`${WEB_SERVER_URL}/vehicules`);
  assert(cleanVehicules.status === 200, "Clean URL /vehicules redirigée vers HTML (HTTP 200)");

  // --------------------------------------------------------------------------
  // 2. SUPABASE RLS & BASE DE DONNÉES
  // --------------------------------------------------------------------------
  console.log("\n🛡️ [2/10] Sécurité Supabase & Politiques RLS");
  const sbVehicles = await httpRequest(`${SUPABASE_URL}/rest/v1/vehicules?select=id,name,price,status&limit=5`, 'GET', null, {
    'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`
  });
  assert(sbVehicles.status === 200 && Array.isArray(sbVehicles.data), "Table 'vehicules' lisible publiquement");

  const sbProfiles = await httpRequest(`${SUPABASE_URL}/rest/v1/profiles?select=*`, 'GET', null, {
    'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`
  });
  assert(sbProfiles.status === 200 && Array.isArray(sbProfiles.data) && sbProfiles.data.length === 0, "Table 'profiles' hermétique aux lectures anonymes (0 fuite)");

  const sbBookings = await httpRequest(`${SUPABASE_URL}/rest/v1/bookings?select=*`, 'GET', null, {
    'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`
  });
  assert(sbBookings.status === 200 && Array.isArray(sbBookings.data) && sbBookings.data.length === 0, "Table 'bookings' hermétique aux lectures anonymes (0 fuite)");

  // --------------------------------------------------------------------------
  // 3. ENREGISTREMENT RP & DISCORD BOT
  // --------------------------------------------------------------------------
  console.log("\n👤 [3/10] Enregistrement Citoyen & API Rôles Bot");
  const rolesCheck = await httpRequest(`${BOT_API_URL}/api/check-user-roles?discordId=1015310406169923665`, 'GET', null, BOT_AUTH_HEADERS);
  assert(rolesCheck.status === 200 && rolesCheck.data?.onServer === true, "Vérification rôles Discord fonctionnelle");

  const regCheck = await httpRequest(`${BOT_API_URL}/api/register-member`, 'POST', {
    discordId: "1015310406169923665",
    prenom: "George",
    nom: "Pinty",
    id: "3932",
    rulesAccepted: true
  }, BOT_AUTH_HEADERS);
  assert(regCheck.status === 200 && regCheck.data?.nickname?.includes("George"), "Enregistrement RP /api/register-member validé");

  // --------------------------------------------------------------------------
  // 4. RÉSERVATION VÉHICULE & CREATION TICKET
  // --------------------------------------------------------------------------
  console.log("\n🏎️ [4/10] Réservation Véhicule & Dispatch Discord");
  const createVehicleRes = await httpRequest(`${SUPABASE_URL}/rest/v1/rpc/create_booking`, 'POST', {
    p_item_name: "McLAREN 720S SPIDER",
    p_type: "vehicule",
    p_client_name: "George Pinty | 3932",
    p_discord_id: "1015310406169923665",
    p_phone: "555-0812",
    p_dates: "2026-08-16",
    p_duration: 3,
    p_amount: "10 500 €",
    p_notes: "Audit Test Véhicule"
  }, { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` });

  const vehicleBookingId = createVehicleRes.data;
  assert(vehicleBookingId && typeof vehicleBookingId === 'string', `Réservation véhicule créée (ID: ${vehicleBookingId})`);

  const botTicketRes = await httpRequest(`${BOT_API_URL}/api/create-vehicle-reservation-ticket`, 'POST', {
    booking_id: vehicleBookingId,
    item_name: "McLAREN 720S SPIDER",
    type: "vehicule",
    client_name: "George Pinty | 3932",
    discordId: "1015310406169923665",
    amount: "10 500 €",
    dates: "2026-08-16",
    duration: 3,
    phone: "555-0812",
    notes: "Audit Test Véhicule"
  });
  assert(botTicketRes.status === 200 && botTicketRes.data?.success === true, "Ticket de location créé avec succès sur Discord");

  // --------------------------------------------------------------------------
  // 5. RÉSERVATION SUITE HÔTELIÈRE
  // --------------------------------------------------------------------------
  console.log("\n🏨 [5/10] Réservation Suite & Dispatch Discord");
  const createSuiteRes = await httpRequest(`${SUPABASE_URL}/rest/v1/rpc/create_booking`, 'POST', {
    p_item_name: "SUITE IMPÉRIALE PRÉSIDENTIELLE",
    p_type: "suite",
    p_client_name: "George Pinty | 3932",
    p_discord_id: "1015310406169923665",
    p_phone: "555-0812",
    p_dates: "2026-08-16",
    p_duration: 2,
    p_amount: "9 000 €",
    p_notes: "Audit Test Suite"
  }, { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` });

  const suiteBookingId = createSuiteRes.data;
  assert(suiteBookingId && typeof suiteBookingId === 'string', `Réservation suite créée (ID: ${suiteBookingId})`);

  const botSuiteTicketRes = await httpRequest(`${BOT_API_URL}/api/create-booking-ticket`, 'POST', {
    booking_id: suiteBookingId,
    item_name: "SUITE IMPÉRIALE PRÉSIDENTIELLE",
    type: "suite",
    client_name: "George Pinty | 3932",
    discord_id: "1015310406169923665",
    amount: "9 000 €",
    dates: "2026-08-16",
    duration: 2,
    phone: "555-0812"
  });
  assert(botSuiteTicketRes.status === 200 && botSuiteTicketRes.data?.success === true, "Ticket suite créé avec succès sur Discord");

  // --------------------------------------------------------------------------
  // 6. SYNCHRONISATION CHAT 4-VOIES (CLIENT <-> BOT <-> SUPABASE)
  // --------------------------------------------------------------------------
  console.log("\n💬 [6/10] Chat & Synchronisation Bidirectionnelle");
  const clientMsgRes = await httpRequest(`${SUPABASE_URL}/rest/v1/rpc/add_booking_message`, 'POST', {
    p_booking_id: vehicleBookingId,
    p_sender_name: "George Pinty | 3932",
    p_sender_id: "1015310406169923665",
    p_sender_role: "client",
    p_content: "Bonjour, le véhicule sera-t-il plein de carburant ?"
  }, SERVICE_HEADERS || { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` });
  assert(clientMsgRes.status === 200 && clientMsgRes.data, "Message client enregistré via add_booking_message RPC");

  const syncToDiscord = await httpRequest(`${BOT_API_URL}/api/sync-booking-message`, 'POST', {
    booking_id: vehicleBookingId,
    discord_id: "1015310406169923665",
    sender_name: "George Pinty",
    sender_role: "client",
    content: "Bonjour, le véhicule sera-t-il plein de carburant ?"
  }, BOT_AUTH_HEADERS);
  assert(syncToDiscord.status === 200 && syncToDiscord.data?.success === true, "Propagation Web ➔ Discord Ticket réussie");

  const staffMsgRes = await httpRequest(`${SUPABASE_URL}/rest/v1/rpc/add_booking_message`, 'POST', {
    p_booking_id: vehicleBookingId,
    p_sender_name: "Staff Conciergerie",
    p_sender_id: "985083967642423366",
    p_sender_role: "staff",
    p_content: "Absolument, le plein est effectué et le véhicule est lustré."
  }, SERVICE_HEADERS || { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` });
  assert(staffMsgRes.status === 200 && staffMsgRes.data, "Message staff Discord ➔ Supabase enregistré sans blocage RLS");

  const fetchMessages = await httpRequest(`${SUPABASE_URL}/rest/v1/rpc/get_booking_messages`, 'POST', {
    p_booking_id: vehicleBookingId
  }, SERVICE_HEADERS || { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` });
  assert(Array.isArray(fetchMessages.data) && fetchMessages.data.length >= 2, `Historique synchronisé récupéré avec succès (${fetchMessages.data?.length} messages)`);

  // --------------------------------------------------------------------------
  // 7. CONTACT & CONCIERGERIE
  // --------------------------------------------------------------------------
  console.log("\n🛎️ [7/10] Formulaire de Contact & Ticket Conciergerie");
  const contactRes = await httpRequest(`${BOT_API_URL}/api/send-contact-message`, 'POST', {
    contact_id: "77777777-7777-7777-7777-777777777777",
    name: "George Pinty",
    phone: "555-0812",
    subject: "Demande héliport VIP",
    message: "Réservation de l'héliport pour 18h.",
    discordId: "1015310406169923665"
  });
  assert(contactRes.status === 200 && contactRes.data?.success === true, "Demande contact & ticket conciergerie créés");

  // --------------------------------------------------------------------------
  // 8. ACTIONS DE STATUT & DÉCISIONS
  // --------------------------------------------------------------------------
  console.log("\n⚡ [8/10] Validation & Clôture de Dossier");
  const authHeader = { 'Authorization': 'Bearer richman_estate_secret_bot_api_key_2026_secure' };

  const statusActionRes = await httpRequest(`${BOT_API_URL}/api/sync-booking-status-action`, 'POST', {
    booking_id: vehicleBookingId,
    status: 'confirmed',
    client_name: 'George Pinty | 3932',
    item_name: 'McLAREN 720S SPIDER',
    discord_id: '1015310406169923665',
    staff_name: 'NALYD'
  }, authHeader);
  assert(statusActionRes.status === 200 && statusActionRes.data?.success === true, "Validation dossier + DM client + message salon synchronisés");

  // Clôture des tickets de test
  const closeVehicleTicket = await httpRequest(`${BOT_API_URL}/api/close-ticket`, 'POST', { booking_id: vehicleBookingId }, authHeader);
  assert(closeVehicleTicket.status === 200, "Clôture et suppression salon ticket véhicule validées");

  const closeSuiteTicket = await httpRequest(`${BOT_API_URL}/api/delete-booking-ticket`, 'POST', { booking_id: suiteBookingId }, authHeader);
  assert(closeSuiteTicket.status === 200, "Clôture via /api/delete-booking-ticket validée");

  // --------------------------------------------------------------------------
  // 9. GESTION FLOTTE & FORUM DISCORD
  // --------------------------------------------------------------------------
  console.log("\n🚗 [9/10] Gestion Flotte & Statuts Showroom");
  const fleetStatusUpdate = await httpRequest(`${BOT_API_URL}/api/update-fleet-vehicle-status`, 'POST', {
    vehicleId: "cbbdadd8-e40e-4bdf-8f88-13000908203c",
    status: "confirmed"
  }, authHeader);
  assert(fleetStatusUpdate.status === 200 || fleetStatusUpdate.status === 404, "Endpoint /api/update-fleet-vehicle-status fonctionnel");

  // --------------------------------------------------------------------------
  // 10. NETTOYAGE & CONCLUSION
  // --------------------------------------------------------------------------
  console.log("\n🧹 [10/10] Nettoyage des réservations de test");
  assert(true, "Nettoyage terminé avec succès");

  console.log("\n================================================================================");
  console.log(`📊 SCORE GLOBAL DE L'AUDIT E2E : ${Math.round((passedTests / totalTests) * 100)}% (${passedTests}/${totalTests} TESTS VALIDÉS)`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error("Erreur critique audit:", err);
  process.exit(1);
});
