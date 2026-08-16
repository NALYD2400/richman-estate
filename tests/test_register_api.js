const http = require('http');

// Secret API défini AVANT le chargement d'apiServer.js (dotenv ne surcharge pas les vars existantes)
process.env.BOT_API_SECRET = process.env.BOT_API_SECRET || 'unit_test_api_secret';

const { startApiServer } = require('../bot/services/apiServer');

async function testRegisterEndpoint() {
  console.log('🧪 Test unitaire : /api/register-member');

  // Mock Discord client
  const mockClient = {
    user: { tag: 'MockBot#0001' },
    guilds: {
      cache: {
        get: () => ({
          id: '1537171063715401870',
          roles: { cache: new Map() },
          members: {
            fetch: async (id) => ({
              id,
              manageable: true,
              setNickname: async () => {},
              roles: {
                cache: new Map(),
                add: async () => {}
              },
              user: {
                displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png'
              }
            })
          }
        }),
        first: () => ({ id: '1537171063715401870' })
      }
    }
  };

  const TEST_PORT = 3999;
  const server = startApiServer(mockClient, TEST_PORT);

  await new Promise(r => setTimeout(r, 200));

  function request(path, payload, extraHeaders = {}) {
    return new Promise((resolve) => {
      const body = JSON.stringify(payload);
      const req = http.request({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...extraHeaders
        }
      }, (res) => {
        let resData = '';
        res.on('data', chunk => resData += chunk);
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(resData); } catch (e) {}
          resolve({ status: res.statusCode, json });
        });
      });
      req.on('error', (err) => resolve({ status: 0, error: err.message }));
      req.write(body);
      req.end();
    });
  }

  // Test 1: Empty body -> 400
  const t1 = await request('/api/register-member', {});
  console.log(`Test 1 (Empty payload) -> Status: ${t1.status} (Attendu: 400)`);
  if (t1.status !== 400) throw new Error('Test 1 failed');

  // Test 2: Missing rules acceptance -> 400
  const t2 = await request('/api/register-member', {
    discordId: '1015310406169923665',
    firstName: 'Marc',
    lastName: 'Louis',
    rpId: '62336',
    acceptedRules: false
  });
  console.log(`Test 2 (Missing rules) -> Status: ${t2.status} (Attendu: 400)`);
  if (t2.status !== 400) throw new Error('Test 2 failed');

  // Test 3: Valid registration WITHOUT auth -> 401 (sécurité : usurpation impossible)
  const t3 = await request('/api/register-member', {
    discordId: '1015310406169923665',
    firstName: 'Marc',
    lastName: 'Louis',
    rpId: '62336',
    acceptedRules: true
  });
  console.log(`Test 3 (Valid payload, sans auth) -> Status: ${t3.status} (Attendu: 401)`);
  if (t3.status !== 401) throw new Error('Test 3 failed: un appel non authentifié ne doit pas pouvoir enregistrer un membre');

  // Test 4: Valid registration WITH API secret -> 200
  const t4 = await request('/api/register-member', {
    discordId: '1015310406169923665',
    firstName: 'Marc',
    lastName: 'Louis',
    rpId: '62336',
    acceptedRules: true
  }, { 'Authorization': `Bearer ${process.env.BOT_API_SECRET}` });
  console.log(`Test 4 (Valid registration + clé API) -> Status: ${t4.status}, Nickname: ${t4.json.nickname}`);
  if (t4.status !== 200 || !t4.json.success || t4.json.nickname !== 'Marc Louis | 62336') {
    throw new Error('Test 4 failed: ' + JSON.stringify(t4.json));
  }

  server.close();
  console.log('✅ Tous les tests unitaires de /api/register-member sont passés avec succès !');
}

testRegisterEndpoint().catch(err => {
  console.error('❌ Échec test unitaire :', err);
  process.exit(1);
});
