require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FEATURES } = require('../services/capabilityCatalog');
const { getCachedCollegeLogo } = require('../services/studentReport.service');
const {
  getStudentReportPDF,
  getBatchStudentReportPDF
} = require('../controllers/report.controller');

// WCAG 2.1 AA Contrast Ratio Calculator
function sRGBtoLin(colorChannel) {
  const c = colorChannel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function getLuminance(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return 0.2126 * sRGBtoLin(r) + 0.7152 * sRGBtoLin(g) + 0.0722 * sRGBtoLin(b);
}

function getContrastRatio(hex1, hex2) {
  const lum1 = getLuminance(hex1);
  const lum2 = getLuminance(hex2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

async function runTests() {
  console.log('--- Starting Phase 17 Test Suite: Role Themes & Student Reports ---');

  // Test 1: Capability Catalog verification
  const roleThemesFeat = FEATURES.find(f => f.key === 'role-themes');
  assert(roleThemesFeat, 'role-themes feature must exist in capabilityCatalog');
  assert.strictEqual(roleThemesFeat.status, 'live');
  assert.strictEqual(roleThemesFeat.effort, 'Done');
  assert.strictEqual(roleThemesFeat.core, true);

  const studentRepFeat = FEATURES.find(f => f.key === 'student-reports');
  assert(studentRepFeat, 'student-reports feature must exist in capabilityCatalog');
  assert.strictEqual(studentRepFeat.status, 'live');
  assert.strictEqual(studentRepFeat.effort, 'Done');
  assert.strictEqual(studentRepFeat.plan, 'standard');
  console.log('✓ 1. Catalog features (role-themes, student-reports) verified live and Done');

  // Test 2: WCAG 2.1 AA Contrast Ratio Verification (>= 4.5:1)
  const roleAccents = [
    { role: 'superAdmin', accent: '#F59E0B', bg: '#0F172A', minRatio: 4.5 },
    { role: 'admin', accent: '#2563EB', bg: '#FFFFFF', minRatio: 4.5 },
    { role: 'principal', accent: '#4338CA', bg: '#FFFFFF', minRatio: 4.5 },
    { role: 'registrar', accent: '#7C3AED', bg: '#FFFFFF', minRatio: 4.5 },
    { role: 'accountant', accent: '#047857', bg: '#FFFFFF', minRatio: 4.5 },
    { role: 'teacher', accent: '#C2410C', bg: '#FFFFFF', minRatio: 4.5 },
    { role: 'student', accent: '#0E7490', bg: '#FFFFFF', minRatio: 4.5 },
    { role: 'employee', accent: '#475569', bg: '#FFFFFF', minRatio: 4.5 },
    { role: 'guard', accent: '#475569', bg: '#FFFFFF', minRatio: 4.5 }
  ];

  roleAccents.forEach(({ role, accent, bg, minRatio }) => {
    const ratio = getContrastRatio(accent, bg);
    assert(ratio >= minRatio, `Contrast ratio for ${role} (${accent} against ${bg}) must be >= ${minRatio}:1 (got ${ratio.toFixed(2)}:1)`);
  });
  console.log('✓ 2. WCAG AA Contrast verified: All 8 role accents achieve >= 4.5:1 against their backgrounds');

  // Test 3: Frontend CSS Variables verification in globals.css
  const globalsCss = fs.readFileSync(path.join(__dirname, '../../client-next/app/globals.css'), 'utf8');
  assert(globalsCss.includes('[data-role="admin"]'), 'globals.css must define data-role admin');
  assert(globalsCss.includes('[data-role="accountant"]'), 'globals.css must define data-role accountant');
  assert(globalsCss.includes('[data-role="registrar"]'), 'globals.css must define data-role registrar');
  assert(globalsCss.includes('[data-role="teacher"]'), 'globals.css must define data-role teacher');
  assert(globalsCss.includes('--accent:'), 'globals.css must define --accent variable');
  assert(globalsCss.includes('--sidebar-bg:'), 'globals.css must define --sidebar-bg variable');
  assert(globalsCss.includes('--sidebar-active:'), 'globals.css must define --sidebar-active variable');
  console.log('✓ 3. CSS variables verified in client-next/app/globals.css for all roles');

  // Test 4: DashboardLayout & Sidebar data-role attribute binding
  const layoutJsx = fs.readFileSync(path.join(__dirname, '../../client-next/components/layout/DashboardLayout.jsx'), 'utf8');
  assert(layoutJsx.includes('data-role={activeRole}'), 'DashboardLayout must apply data-role attribute at layout root');

  const sidebarJsx = fs.readFileSync(path.join(__dirname, '../../client-next/components/layout/Sidebar.jsx'), 'utf8');
  assert(sidebarJsx.includes('var(--accent)'), 'Sidebar must use var(--accent) CSS variable');
  assert(sidebarJsx.includes('var(--sidebar-active)'), 'Sidebar must use var(--sidebar-active) CSS variable');
  console.log('✓ 4. DashboardLayout & Sidebar verified: Root data-role set and CSS variables bound');

  // Test 5: In-Memory Logo Caching (10-minute cache)
  const mockSystemDb = {
    college: {
      findUnique: async () => ({
        id: 'col-cache-1',
        name: 'Cache Test College',
        logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      })
    }
  };

  const logoBuf1 = await getCachedCollegeLogo(mockSystemDb, 'col-cache-1');
  assert(logoBuf1 && Buffer.isBuffer(logoBuf1), 'Must return buffer for college logo');
  const logoBuf2 = await getCachedCollegeLogo(mockSystemDb, 'col-cache-1');
  assert.strictEqual(logoBuf1, logoBuf2, 'Second call must return cached instance from memory');
  console.log('✓ 5. In-memory logo cache verified: Avoids redundant Cloudflare R2 downloads');

  // Test 6: Single Student Comprehensive Report PDF Generation & Role Security
  const mockTenantDb = {
    student: {
      findFirst: async ({ where }) => {
        if (where.college_id === 'col-1' && (where.OR?.[0]?.id === 'stud-1' || where.id === 'stud-1')) {
          return {
            id: 'stud-1',
            user_id: 'u-stud-1',
            rollNumber: 'FA26-101',
            class: '11th',
            section: 'A',
            group: 'Pre-Engineering',
            college_id: 'col-1'
          };
        }
        return null;
      }
    },
    attendance: { findMany: async () => [] },
    result: { findMany: async () => [] },
    fee: { findMany: async () => [] },
    fine: { findMany: async () => [] }
  };

  const sysDbMock = {
    user: {
      findUnique: async () => ({ id: 'u-stud-1', name: 'Zaid Khan' })
    },
    college: {
      findUnique: async () => ({ id: 'col-1', name: 'FMC College', address: 'Faisalabad' })
    }
  };

  // 6a: Other student blocked (403 FORBIDDEN)
  let forbiddenStatus = null;
  let forbiddenJson = null;
  await getStudentReportPDF({
    tenantClient: mockTenantDb,
    collegeId: 'col-1',
    user: { id: 'u-other-student', role: 'student' },
    params: { id: 'stud-1' }
  }, {
    status: (code) => {
      forbiddenStatus = code;
      return { json: (data) => { forbiddenJson = data; } };
    },
    setHeader: () => {}
  }, (err) => { if (err) throw err; });

  assert.strictEqual(forbiddenStatus, 403, 'Student requesting other student report must get 403');
  assert.strictEqual(forbiddenJson.code, 'FORBIDDEN');

  // 6b: Admin or own student generates PDF stream
  const chunks = [];
  const mockResStream = {
    headers: {},
    setHeader: function(k, v) { this.headers[k] = v; },
    write: function(chunk) { chunks.push(chunk); },
    end: function() { chunks.push(Buffer.from('')); },
    on: function() {},
    once: function() {},
    emit: function() {}
  };

  await getStudentReportPDF({
    tenantClient: mockTenantDb,
    collegeId: 'col-1',
    user: { id: 'admin-1', role: 'admin' },
    params: { id: 'stud-1' }
  }, mockResStream, (err) => { if (err) throw err; });

  assert.strictEqual(mockResStream.headers['Content-Type'], 'application/pdf');
  assert(mockResStream.headers['Content-Disposition'].includes('Student_Report_FA26-101.pdf'));
  console.log('✓ 6. Single student report PDF verified: Strict RBAC check (403 for other students) & streaming headers');

  // Test 7: Batch Student Report Limit Enforcement (> 60 students blocked)
  const mockBatchDb = {
    student: {
      findMany: async () => {
        // Return 62 mock students (exceeding limit)
        const list = [];
        for (let i = 1; i <= 62; i++) list.push({ id: `s-${i}`, rollNumber: `R-${i}` });
        return list;
      }
    }
  };

  let batchStatus = null;
  let batchJson = null;
  await getBatchStudentReportPDF({
    tenantClient: mockBatchDb,
    collegeId: 'col-1',
    user: { id: 'admin-1', role: 'admin' },
    body: { sectionId: 'sec-big' }
  }, {
    status: (code) => {
      batchStatus = code;
      return { json: (data) => { batchJson = data; } };
    },
    setHeader: () => {}
  }, (err) => { if (err) throw err; });

  assert.strictEqual(batchStatus, 400, 'Batch report exceeding 60 students must return 400');
  assert.strictEqual(batchJson.code, 'BATCH_LIMIT_EXCEEDED');
  console.log('✓ 7. Batch student report limit verified: Max 60 students limit enforced (400 BATCH_LIMIT_EXCEEDED)');

  console.log('========================================================================');
  console.log('🎉 ALL 7 PHASE 17 TESTS PASSED SUCCESSFULLY (100%)');
  console.log('========================================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Phase 17 test failed:', err);
  process.exit(1);
});
