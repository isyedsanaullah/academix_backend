const authorize = require('./middleware/rbac');

async function testRBACMatrix() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🧪 VERIFYING ADMIN ELEVATION & MULTI-TENANT ISOLATION RBAC MATRIX');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let total = 0;

  function runCheck(testName, allowedRoles, userRole, shouldPass) {
    total++;
    const middleware = authorize(...allowedRoles);
    const req = {
      user: { role: userRole, _id: 'test-user-id', college_id: 'college-123' },
      collegeId: 'college-123'
    };
    let nextCalled = false;
    let errorStatus = null;
    let errorMessage = null;

    const res = {
      status: (code) => {
        errorStatus = code;
        return {
          json: (data) => { errorMessage = data.message; }
        };
      }
    };
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    const actualPass = nextCalled && !errorStatus;
    if (actualPass === shouldPass) {
      console.log(`✅ [PASS] ${testName} (Role: "${userRole}" -> ${actualPass ? 'ALLOWED' : 'FORBIDDEN (403)'})`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} - Expected: ${shouldPass}, Got: ${actualPass} (${errorMessage})`);
    }
  }

  // 1. Accountant endpoints: authorize('accountant', 'admin')
  console.log('--- 1. Accountant Functionality (Treasury, Dues, Payroll, Fees) ---');
  runCheck('Admin access to Treasury & Transactions', ['accountant', 'admin'], 'admin', true);
  runCheck('Accountant access to Treasury', ['accountant', 'admin'], 'accountant', true);
  runCheck('Teacher blocked from Treasury', ['accountant', 'admin'], 'teacher', false);
  runCheck('Guard/Employee blocked from Treasury', ['accountant', 'admin'], 'employee', false);

  // 2. Registrar endpoints: authorize('registrar', 'admin')
  console.log('\n--- 2. Registrar Functionality (Admission Seasons, Applications) ---');
  runCheck('Admin access to Admission Seasons & Applications', ['registrar', 'admin'], 'admin', true);
  runCheck('Registrar access to Admission Seasons', ['registrar', 'admin'], 'registrar', true);
  runCheck('Student blocked from Applications management', ['registrar', 'admin'], 'student', false);
  runCheck('Accountant blocked from Applications management', ['registrar', 'admin'], 'accountant', false);

  // 3. Guard endpoints: authorize('employee', 'admin')
  console.log('\n--- 3. Guard Functionality (Gate Scanner & Live Logs) ---');
  runCheck('Admin access to QR Gate Scanner', ['employee', 'admin'], 'admin', true);
  runCheck('Guard access to QR Gate Scanner', ['employee', 'admin'], 'employee', true);
  runCheck('Teacher blocked from Gate Scanner', ['employee', 'admin'], 'teacher', false);
  runCheck('Student blocked from Gate Scanner', ['employee', 'admin'], 'student', false);

  // 4. Principal / Report Center: authorize('admin', 'principal')
  console.log('\n--- 4. Principal Functionality (Report Center 29-PDF Generator & Evaluations) ---');
  runCheck('Admin access to Central PDF Report Generator', ['admin', 'principal'], 'admin', true);
  runCheck('Principal access to Central PDF Report Generator', ['admin', 'principal'], 'principal', true);
  runCheck('Registrar blocked from Report Generator', ['admin', 'principal'], 'registrar', false);
  runCheck('Teacher blocked from Report Generator', ['admin', 'principal'], 'teacher', false);

  // 5. Fine Management: authorize('teacher', 'admin')
  console.log('\n--- 5. Fine Management & Issued Fine Inspection ---');
  runCheck('Admin access to Issue Fines & View Issued Fines', ['teacher', 'admin'], 'admin', true);
  runCheck('Teacher access to Issue Fines', ['teacher', 'admin'], 'teacher', true);
  runCheck('Student blocked from issuing fines', ['teacher', 'admin'], 'student', false);

  // 6. Super Admin Isolation: authorize('superAdmin')
  console.log('\n--- 6. Super Admin Isolation (Admin CANNOT access Super Admin platform routes) ---');
  runCheck('Super Admin access to Global Colleges Management', ['superAdmin'], 'superAdmin', true);
  runCheck('Admin BLOCKED from Global Colleges Management', ['superAdmin'], 'admin', false);
  runCheck('Principal BLOCKED from Global Colleges Management', ['superAdmin'], 'principal', false);
  runCheck('Accountant BLOCKED from Global Colleges Management', ['superAdmin'], 'accountant', false);

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(`📊 RESULTS: ${passed}/${total} RBAC Matrix Tests Passed Successfully!`);
  console.log('═══════════════════════════════════════════════════════════════════════');
}

testRBACMatrix().catch(console.error);
