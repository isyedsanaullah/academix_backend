require('dotenv').config();
const http = require('http');
const app = require('../server');
const generateToken = require('../utils/generateToken');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const { clearEntitlementCache } = require('../middleware/loadEntitlements');

function request(server, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      host: '127.0.0.1',
      port: addr.port,
      method,
      path,
      headers: reqHeaders
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
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  const prisma = getSystemClient();
  const college = await prisma.college.findFirst({
    where: { code: 'PCS' }
  });
  if (!college) throw new Error('PCS college not found');

  const guardUser = await prisma.user.findFirst({
    where: { email: 'security@pcs.edu.pk' }
  }) || await prisma.user.findFirst({
    where: { college_id: college.id, role: 'employee' }
  });
  if (!guardUser) throw new Error('Guard employee user not found');

  const student = await prisma.student.findFirst({
    where: { college_id: college.id, status: 'active' }
  });
  if (!student) throw new Error('Active student not found');

  const token = generateToken(guardUser.id, college.id, guardUser.role);
  const authHeaders = { 'Authorization': `Bearer ${token}` };

  const testServer = http.createServer(app);
  await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
  const port = testServer.address().port;
  console.log(`\nTest server listening on port ${port}\n`);

  const originalSubscription = college.subscription;
  const results = [];

  try {
    console.log('================================================================');
    console.log('PART (a): WITH ENTRY-SYSTEM OVERRIDE FALSE (SCANNER DISABLED)');
    console.log('================================================================');

    // Set override: entry-system = false
    const subWithOverride = {
      ...(typeof originalSubscription === 'object' && originalSubscription ? originalSubscription : {}),
      featureOverrides: {
        ...((originalSubscription && originalSubscription.featureOverrides) || {}),
        'entry-system': false
      }
    };

    await prisma.college.update({
      where: { id: college.id },
      data: { subscription: subWithOverride }
    });
    clearEntitlementCache(college.id);

    // 1. POST /api/gate/scan returns 403 FEATURE_UNAVAILABLE
    const scanRes = await request(testServer, 'POST', '/api/gate/scan', authHeaders, {
      identifier: student.qrCode,
      verificationMethod: 'QR'
    });
    console.log(`[${scanRes.status}] POST /api/gate/scan with entry-system: false`);
    console.log(`      Response: ${JSON.stringify(scanRes.body)}`);
    results.push({
      test: '(a).1 POST /api/gate/scan returns 403 FEATURE_UNAVAILABLE',
      pass: scanRes.status === 403 && scanRes.body?.code === 'FEATURE_UNAVAILABLE'
    });

    // 2. POST /api/gate/manual works with student id
    const manualRes = await request(testServer, 'POST', '/api/gate/manual', authHeaders, {
      studentId: student.id,
      action: 'entry'
    });
    console.log(`[${manualRes.status}] POST /api/gate/manual with studentId`);
    console.log(`      Response message: ${manualRes.body?.message || manualRes.body?.errorCode}`);
    results.push({
      test: '(a).2 POST /api/gate/manual works with studentId',
      pass: manualRes.status === 200 || manualRes.status === 201
    });

    // 3. POST /api/students/identify with { query: rollNumber } returns student
    const identifyQueryRes = await request(testServer, 'POST', '/api/students/identify', authHeaders, {
      query: student.rollNumber
    });
    console.log(`[${identifyQueryRes.status}] POST /api/students/identify with query: "${student.rollNumber}"`);
    const foundQuery = identifyQueryRes.body?.students?.some(s => s.id === student.id);
    console.log(`      Students returned: ${(identifyQueryRes.body?.students || []).length}, student match: ${foundQuery}`);
    results.push({
      test: '(a).3 POST /api/students/identify with query returns student',
      pass: identifyQueryRes.status === 200 && foundQuery
    });

    // 4. POST /api/students/identify with { qrCode } returns 409 METHOD_UNAVAILABLE and useMethod 'search'
    const identifyQrRes = await request(testServer, 'POST', '/api/students/identify', authHeaders, {
      qrCode: student.qrCode
    });
    console.log(`[${identifyQrRes.status}] POST /api/students/identify with qrCode`);
    console.log(`      Response: errorCode=${identifyQrRes.body?.errorCode}, useMethod=${identifyQrRes.body?.useMethod}`);
    results.push({
      test: '(a).4 POST /api/students/identify with qrCode returns 409 METHOD_UNAVAILABLE & useMethod=search',
      pass: identifyQrRes.status === 409 && identifyQrRes.body?.errorCode === 'METHOD_UNAVAILABLE' && identifyQrRes.body?.useMethod === 'search'
    });

    // 5. attendance row from /gate/manual has method 'manual'
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const attRow = await prisma.attendance.findFirst({
      where: {
        college_id: college.id,
        student_id: student.id
      },
      orderBy: { createdAt: 'desc' }
    });
    console.log(`[DB Check] Latest Attendance Row for student: method="${attRow?.method}", status="${attRow?.status}"`);
    results.push({
      test: '(a).5 Attendance row from /gate/manual has method: "manual"',
      pass: attRow && attRow.method === 'manual'
    });

    console.log('\n================================================================');
    console.log('PART (b): DEFAULT COLLEGE (SCANNER RESTORED TO DEFAULT / ON)');
    console.log('================================================================');

    // Restore original subscription
    await prisma.college.update({
      where: { id: college.id },
      data: { subscription: originalSubscription }
    });
    clearEntitlementCache(college.id);

    // 6. scanner works exactly as before
    const defaultScanRes = await request(testServer, 'POST', '/api/gate/scan', authHeaders, {
      identifier: student.qrCode,
      verificationMethod: 'QR'
    });
    console.log(`[${defaultScanRes.status}] POST /api/gate/scan with scanner active`);
    console.log(`      Response message: ${defaultScanRes.body?.message || defaultScanRes.body?.errorCode}`);
    results.push({
      test: '(b).1 Scanner works when enabled (status 200 or successful gate action/duplicate scan)',
      pass: defaultScanRes.status === 200 || defaultScanRes.status === 201 || (defaultScanRes.status === 400 && defaultScanRes.body?.errorCode === 'DUPLICATE_SCAN')
    });

    // 7. /gate/lookup no longer throws ReferenceError
    const lookupRes = await request(testServer, 'GET', `/api/gate/lookup?qrCode=${encodeURIComponent(student.qrCode)}`, authHeaders);
    console.log(`[${lookupRes.status}] GET /api/gate/lookup?qrCode=${student.qrCode}`);
    console.log(`      Data: id=${lookupRes.body?.data?.id}, name=${lookupRes.body?.data?.name}`);
    results.push({
      test: '(b).2 /gate/lookup no longer throws and returns student data',
      pass: lookupRes.status === 200 && lookupRes.body?.data?.id === student.id
    });

  } finally {
    // Ensure subscription is restored
    await prisma.college.update({
      where: { id: college.id },
      data: { subscription: originalSubscription }
    });
    clearEntitlementCache(college.id);
    testServer.close();
    await closeAllClients();
  }

  console.log('\n================================================================');
  console.log('PHASE 2 TEST SUMMARY:');
  console.log('================================================================');
  let allPass = true;
  for (const r of results) {
    console.log(`${r.pass ? '✅ PASS' : '❌ FAIL'}: ${r.test}`);
    if (!r.pass) allPass = false;
  }
  console.log('================================================================\n');

  if (!allPass) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
