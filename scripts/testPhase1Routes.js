require('dotenv').config();
const http = require('http');
const app = require('../server');
const generateToken = require('../utils/generateToken');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

function request(server, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({
      host: '127.0.0.1',
      port: addr.port,
      method,
      path,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  const prisma = getSystemClient();
  const pcsAdmin = await prisma.user.findFirst({
    where: { email: 'admin@pcs.edu.pk' }
  });

  if (!pcsAdmin) {
    throw new Error('Test admin user not found');
  }

  const token = generateToken(pcsAdmin.id, pcsAdmin.college_id, pcsAdmin.role);
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const testServer = http.createServer(app);
  await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
  const port = testServer.address().port;
  console.log(`Test server listening on port ${port}\n`);

  const tests = [
    { name: 'GET /api/health (public/health check)', method: 'GET', path: '/api/health', headers: {} },
    { name: 'GET /api/me/capabilities (unauthorized - no token)', method: 'GET', path: '/api/me/capabilities', headers: {} },
    { name: 'GET /api/me/capabilities (authorized PCS admin)', method: 'GET', path: '/api/me/capabilities', headers: authHeaders },
    { name: 'GET /api/profile/me (authorized profile & effectiveFeatures)', method: 'GET', path: '/api/profile/me', headers: authHeaders },
    { name: 'GET /api/attendance (gated by featureGate attendance)', method: 'GET', path: '/api/attendance', headers: authHeaders },
    { name: 'GET /api/announcements (gated by featureGate announcements)', method: 'GET', path: '/api/announcements', headers: authHeaders },
    { name: 'GET /api/canteen (gated by featureGate canteen)', method: 'GET', path: '/api/canteen', headers: authHeaders },
    { name: 'GET /api/visitors (gated by featureGate visitors)', method: 'GET', path: '/api/visitors', headers: authHeaders },
    { name: 'GET /api/timetables (gated by featureGate timetable)', method: 'GET', path: '/api/timetables', headers: authHeaders },
  ];

  console.log('--- TESTING ROUTES BY HAND WITH STATUS CODES ---');
  for (const t of tests) {
    try {
      const res = await request(testServer, t.method, t.path, t.headers);
      const isSuccess = res.status >= 200 && res.status < 400 || (t.name.includes('unauthorized') && res.status === 401);
      console.log(`[${res.status}] ${t.name}`);
      if (t.path === '/api/me/capabilities' && res.status === 200) {
        console.log(`      Capabilities returned: ${Object.keys(res.body.capabilities || {}).length} capabilities`);
      }
      if (t.path === '/api/profile/me' && res.status === 200) {
        console.log(`      Effective legacy features: ${(res.body.data?.planInfo?.effectiveFeatures || []).length} features`);
      }
    } catch (err) {
      console.error(`FAILED: ${t.name} ->`, err.message);
    }
  }

  testServer.close();
  await closeAllClients();
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
