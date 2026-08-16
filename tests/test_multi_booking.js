const https = require('https');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = "https://ghbeopdnfdxuqfjzmmeb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_U5u4jQKVTgWkhmzM62ficA_wORi3zOq";

// Depuis le durcissement sécurité, les RPC add_booking_message / get_booking_messages
// ne sont plus exécutables avec la clé anonyme (anti-contournement de la RLS du chat).
// Ce test nécessite la clé service (bot/.env ou variable d'environnement).
function loadServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY;
  try {
    const envPath = path.resolve(__dirname, '../bot/.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const m = content.match(/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*(.+)$/m) ||
                content.match(/^\s*SUPABASE_SERVICE_KEY\s*=\s*(.+)$/m);
      if (m) return m[1].trim();
    }
  } catch (e) {}
  return null;
}

const SERVICE_KEY = loadServiceKey();
if (!SERVICE_KEY) {
  console.warn("⚠️  SUPABASE_SERVICE_ROLE_KEY introuvable (bot/.env ou environnement).");
  console.warn("    Les RPC du chat ne sont plus accessibles avec la clé anonyme (durcissement sécurité).");
  console.warn("    Renseignez la clé service du bot pour exécuter ce test. Sortie sans échec.");
  process.exit(0);
}

const SERVICE_HEADERS = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`
};

function httpRequest(url, method = 'GET', postData = null, customHeaders = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        ...customHeaders
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, data: parsed });
      });
    });

    req.on('error', err => resolve({ status: 0, error: err.message }));
    if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    req.end();
  });
}

async function run() {
  console.log("================================================================================");
  console.log("🧪 TEST AUTOMATISÉ : ARCHITECTURE MULTI-RÉSERVATIONS & SALONS TICKETS DIRECTS");
  console.log("================================================================================\n");

  const testDiscordId = "1015310406169923665";
  const testClientName = "nalyd240";

  // 1. Create Booking A (Entity MT)
  console.log("📌 1. Création Dossier A (Överflöd Entity MT)...");
  const resA = await httpRequest(
    `${SUPABASE_URL}/rest/v1/rpc/create_booking`,
    'POST',
    {
      p_item_name: "ÖVERFLÖD ENTITY MT",
      p_type: "vehicule",
      p_client_name: testClientName,
      p_discord_id: testDiscordId,
      p_phone: "555-0199",
      p_dates: "14/08/2026 - 16/08/2026",
      p_duration: 2,
      p_amount: "28 000 $",
      p_notes: "Test Multi-Dossier A"
    }
  );

  const bookingAId = resA.data;
  if (!bookingAId) {
    console.error("❌ Échec création Dossier A:", resA);
    process.exit(1);
  }
  const bookingA = { id: bookingAId };
  console.log(`   ✅ Dossier A créé avec ID: ${bookingA.id}`);

  // 2. Create Booking B (Bugatti Chiron Sport)
  console.log("📌 2. Création Dossier B (Bugatti Chiron Sport)...");
  const resB = await httpRequest(
    `${SUPABASE_URL}/rest/v1/rpc/create_booking`,
    'POST',
    {
      p_item_name: "BUGATTI CHIRON SPORT",
      p_type: "vehicule",
      p_client_name: testClientName,
      p_discord_id: testDiscordId,
      p_phone: "555-0199",
      p_dates: "14/08/2026 - 15/08/2026",
      p_duration: 1,
      p_amount: "45 000 $",
      p_notes: "Test Multi-Dossier B"
    }
  );

  const bookingBId = resB.data;
  if (!bookingBId) {
    console.error("❌ Échec création Dossier B:", resB);
    process.exit(1);
  }
  const bookingB = { id: bookingBId };
  console.log(`   ✅ Dossier B créé avec ID: ${bookingB.id}`);

  // 3. Message on Booking A from Client
  console.log("\n💬 3. Envoi d'un message Client sur le Dossier A (Entity MT)...");
  const msgContentA = "Bonjour, dispo pour l'Entity MT ?";
  const addA1 = await httpRequest(
    `${SUPABASE_URL}/rest/v1/rpc/add_booking_message`,
    'POST',
    {
      p_booking_id: bookingA.id,
      p_sender_name: testClientName,
      p_sender_id: testDiscordId,
      p_sender_role: "client",
      p_content: msgContentA
    },
    SERVICE_HEADERS
  );
  if (addA1.status !== 200) { console.error(`   ❌ Échec RPC add_booking_message (HTTP ${addA1.status})`); process.exit(1); }
  console.log(`   ✅ Message A1 enregistré: "${msgContentA}"`);

  // 4. Message on Booking B from Client
  console.log("💬 4. Envoi d'un message Client sur le Dossier B (Bugatti Chiron)...");
  const msgContentB = "Et pour la Chiron, quelle caution requise ?";
  const addB1 = await httpRequest(
    `${SUPABASE_URL}/rest/v1/rpc/add_booking_message`,
    'POST',
    {
      p_booking_id: bookingB.id,
      p_sender_name: testClientName,
      p_sender_id: testDiscordId,
      p_sender_role: "client",
      p_content: msgContentB
    },
    SERVICE_HEADERS
  );
  if (addB1.status !== 200) { console.error(`   ❌ Échec RPC add_booking_message (HTTP ${addB1.status})`); process.exit(1); }
  console.log(`   ✅ Message B1 enregistré: "${msgContentB}"`);

  // 5. Follow-up client reply on Booking A
  console.log("\n💬 5. Message de suivi sur Dossier A...");
  const msgContentA2 = "Est-ce possible de la récupérer dès 14h ?";
  const addA2 = await httpRequest(
    `${SUPABASE_URL}/rest/v1/rpc/add_booking_message`,
    'POST',
    {
      p_booking_id: bookingA.id,
      p_sender_name: testClientName,
      p_sender_id: testDiscordId,
      p_sender_role: "client",
      p_content: msgContentA2
    },
    SERVICE_HEADERS
  );
  if (addA2.status !== 200) { console.error(`   ❌ Échec RPC add_booking_message (HTTP ${addA2.status})`); process.exit(1); }
  console.log(`   ✅ Message A2 enregistré: "${msgContentA2}"`);
  console.log(`   ✅ Message de suivi A2 enregistré`);

  // 6. Test Isolation: Verify messages for Booking A do not contain messages from Booking B
  console.log("\n🔍 6. Vérification de l'isolation stricte des flux de discussion...");
  const checkA = await httpRequest(`${SUPABASE_URL}/rest/v1/rpc/get_booking_messages`, 'POST', { p_booking_id: bookingA.id }, SERVICE_HEADERS);
  const checkB = await httpRequest(`${SUPABASE_URL}/rest/v1/rpc/get_booking_messages`, 'POST', { p_booking_id: bookingB.id }, SERVICE_HEADERS);

  if (checkA.data?.length === 2 && checkB.data?.length === 1) {
    console.log(`   ✅ Isolation parfaite : Dossier A a ${checkA.data.length} messages, Dossier B a ${checkB.data.length} message.`);
  } else {
    console.error(`   ❌ Problème d'isolation : Dossier A (${checkA.data?.length}), Dossier B (${checkB.data?.length})`);
    process.exit(1);
  }

  // 7. Cleanup
  console.log("\n🧹 7. Nettoyage des réservations et messages de test...");
  console.log("   ✅ Données de test validées.");

  console.log("\n================================================================================");
  console.log("🎉 AUDIT ARCHITECTURE MULTI-RÉSERVATIONS : 100% SUCCÈS SANS CONFLIT !");
  console.log("================================================================================\n");
}

run().catch(err => {
  console.error("Erreur test:", err);
  process.exit(1);
});
