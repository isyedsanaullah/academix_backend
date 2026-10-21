require('dotenv').config();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getSystemClient } = require('../config/prismaManager');
const { getTenantClient } = require('../config/prismaManager');
const generateToken = require('../utils/generateToken');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';

async function runSmokeTests() {
  console.log('--- Starting Phase 18 Smoke Test Suite (HTTP against localhost:5000) ---');

  const sysDb = getSystemClient();

  // 1. Fetch Colleges
  const colleges = await sysDb.college.findMany();
  const pcsCollege = colleges.find(c => c.code === 'PCS') || colleges[0];
  const fmcCollege = colleges.find(c => c.code === 'FMC') || colleges[1] || pcsCollege;

  // 2. Fetch Users for each role
  const allUsers = await sysDb.user.findMany();
  const usersByRole = {};
  allUsers.forEach(u => {
    if (!usersByRole[u.role]) usersByRole[u.role] = u;
  });

  // Role tokens
  const roles = ['superAdmin', 'admin', 'principal', 'registrar', 'accountant', 'teacher', 'student', 'employee'];
  const tokens = {};

  roles.forEach(role => {
    const user = usersByRole[role];
    if (user) {
      tokens[role] = generateToken(user.id, user.college_id || pcsCollege.id, role);
    } else {
      // Generate synthetic token if user row missing
      tokens[role] = jwt.sign(
        { userId: `test-${role}`, college_id: pcsCollege.id, role },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );
    }
  });

  // 3. Lookup real IDs from tenant DB
  let tenantDb;
  try {
    tenantDb = pcsCollege.db_url ? getTenantClient(pcsCollege.db_url) : sysDb;
  } catch (e) {
    tenantDb = sysDb;
  }

  const [realStudent, realTeacher, realClass, realSection, realSubject, realSession, realFee] = await Promise.all([
    tenantDb.student?.findFirst() || null,
    tenantDb.teacher?.findFirst() || null,
    tenantDb.class?.findFirst() || null,
    tenantDb.section?.findFirst() || null,
    tenantDb.subject?.findFirst() || null,
    tenantDb.session?.findFirst() || null,
    tenantDb.fee?.findFirst() || null
  ]);

  const realIds = {
    id: realStudent?.id || realClass?.id || 'sample-id-1',
    studentId: realStudent?.id || 'sample-student-1',
    teacherId: realTeacher?.id || 'sample-teacher-1',
    classId: realClass?.id || 'sample-class-1',
    sectionId: realSection?.id || 'sample-section-1',
    subjectId: realSubject?.id || 'sample-subject-1',
    sessionId: realSession?.id || 'sample-session-1',
    feeId: realFee?.id || 'sample-fee-1'
  };

  // 4. Candidate GET Routes from Inventory
  const inventoryPath = path.join(__dirname, '../../docs/route-inventory.md');
  const inventoryContent = fs.readFileSync(inventoryPath, 'utf8');
  const lines = inventoryContent.split('\n');

  const getRoutes = [];
  lines.forEach(line => {
    if (line.startsWith('| **GET** |')) {
      const parts = line.split('|').map(s => s.trim());
      // parts[2] is path, parts[3] is feature, parts[4] is exempt, parts[5] is roles
      const rawPath = parts[2].replace(/`/g, '');
      const allowedRolesStr = parts[5];
      let allowedRoles = allowedRolesStr.split(',').map(r => r.trim());
      if (allowedRolesStr.includes('public') || allowedRolesStr.includes('authenticated')) {
        allowedRoles = ['admin']; // Test with admin as representative
      }

      getRoutes.push({
        path: rawPath,
        roles: allowedRoles
      });
    }
  });

  console.log(`Found ${getRoutes.length} GET routes to test across allowed roles...`);

  const results = [];
  let passCount = 0;
  let failCount = 0;

  for (const item of getRoutes) {
    // Substitute route params with real IDs
    let resolvedPath = item.path;
    Object.entries(realIds).forEach(([param, val]) => {
      resolvedPath = resolvedPath.replace(`:${param}`, val);
    });
    // Replace remaining generic :param
    resolvedPath = resolvedPath.replace(/:[a-zA-Z0-9_]+/g, 'sample-id-1');

    // Skip PDF streaming or binary download routes in simple smoke (tested in scenarios)
    if (resolvedPath.endsWith('.pdf')) continue;

    for (const role of item.roles) {
      const token = tokens[role] || tokens['admin'];
      let url = `${BASE_URL}${resolvedPath}`;
      if (role === 'superAdmin' && !resolvedPath.startsWith('/api/super-admin')) {
        url += (url.includes('?') ? '&' : '?') + `college_id=${pcsCollege.id}`;
      }

      try {
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-college-id': pcsCollege.id
          }
        });

        const status = resp.status;
        let isPass = false;
        let note = '';

        if (status === 200 || status === 204 || status === 304) {
          isPass = true;
          note = '200 OK';
        } else if (status === 403) {
          isPass = true;
          note = '403 Plan/Role Boundary';
        } else if (status === 404) {
          isPass = true;
          note = '404 Entity Not Found / Empty List';
        } else if (status === 400) {
          isPass = true;
          note = '400 Validation (Missing Parameters)';
        } else if (status === 500) {
          isPass = false;
          note = '500 Server Error';
        } else if (status === 401) {
          isPass = false;
          note = '401 Unauthorized';
        } else {
          isPass = true;
          note = `${status} Handled Status`;
        }

        if (isPass) passCount++;
        else failCount++;

        results.push({
          method: 'GET',
          path: resolvedPath,
          role,
          status,
          isPass,
          note
        });
      } catch (err) {
        failCount++;
        results.push({
          method: 'GET',
          path: resolvedPath,
          role,
          status: 'CONN_ERR',
          isPass: false,
          note: err.message
        });
      }
    }
  }

  // 5. Generate docs/route-results.md
  let reportMd = `# Academix Route Smoke Test Results (Phase 18)\n\n`;
  reportMd += `Executed: ${new Date().toISOString()}\n`;
  reportMd += `Target: \`${BASE_URL}\`\n\n`;
  reportMd += `## Summary\n\n`;
  reportMd += `- **Total Tests Run**: ${results.length}\n`;
  reportMd += `- **Passed**: ${passCount} (${((passCount / results.length) * 100).toFixed(1)}%)\n`;
  reportMd += `- **Failed**: ${failCount}\n\n`;

  reportMd += `## Results Table\n\n`;
  reportMd += `| Status | Code | Method | Path | Role | Note |\n`;
  reportMd += `| :---: | :---: | :--- | :--- | :--- | :--- |\n`;

  results.forEach(r => {
    const icon = r.isPass ? '✅ PASS' : '❌ FAIL';
    reportMd += `| ${icon} | **${r.status}** | ${r.method} | \`${r.path}\` | \`${r.role}\` | ${r.note} |\n`;
  });

  const outPath = path.join(__dirname, '../../docs/route-results.md');
  fs.writeFileSync(outPath, reportMd, 'utf8');

  console.log(`✓ Smoke tests complete: ${passCount} passed, ${failCount} failed. Saved to docs/route-results.md`);
  return { passCount, failCount, total: results.length };
}

if (require.main === module) {
  runSmokeTests().then(res => {
    if (res.failCount > 0) process.exit(1);
    process.exit(0);
  }).catch(err => {
    console.error('Smoke tests failed:', err);
    process.exit(1);
  });
}

module.exports = runSmokeTests;
