// tests/phase6.test.js
// Automated test suite for Phase 6:
// - Attendance minimum check (< 75% rejected; override allows 'ready')
// - 20-row CSV gazette import matching by roll number & unmatched tracking
// - Board result analysis totals exactly equaling row counts
// - Capability catalog status validation for board features

require('dotenv').config();
const assert = require('assert');
const {
  updateBoardFormStatus,
  importBoardResults,
  getBoardResultAnalysis
} = require('../controllers/board.controller');
const { FEATURES } = require('../services/capabilityCatalog');

console.log('--- Starting Phase 6 Test Suite ---');

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, val) {
      this.headers[key] = val;
    }
  };
  return res;
}

async function runTests() {
  // ==============================================================================
  // 1. Capability Catalog Live Status Test
  // ==============================================================================
  {
    const requiredKeys = [
      'board-registration',
      'board-exam-forms',
      'board-candidates',
      'board-slips',
      'board-results',
      'board-result-import',
      'board-result-analysis',
      'board-attendance-check',
      'fee-board-alert'
    ];

    for (const key of requiredKeys) {
      const feat = FEATURES.find(f => f.key === key);
      assert(feat, `Feature "${key}" must exist in capability catalog`);
      assert.strictEqual(feat.status, 'live', `Feature "${key}" status must be 'live', got '${feat.status}'`);
      assert.strictEqual(feat.effort, 'Done', `Feature "${key}" effort must be 'Done', got '${feat.effort}'`);
    }
    console.log('✓ 1. All 9 board examination capability catalog features confirmed live & Done');
  }

  // ==============================================================================
  // 2. Attendance Minimum Gating & Principal Override Test
  // ==============================================================================
  {
    const mockCollegeId = 'college-alpha';
    let formData = {
      id: 'form-001',
      college_id: mockCollegeId,
      session_id: 'session-2026',
      student_id: 'student-low-att',
      kind: 'registration',
      board: 'FBISE Islamabad',
      status: 'draft',
      attendancePercent: null,
      attendanceOk: null,
      attendanceOverrideBy: null,
      remarks: null
    };

    const mockDb = {
      boardForm: {
        findFirst: async () => formData,
        update: async ({ data }) => {
          formData = { ...formData, ...data };
          return formData;
        }
      },
      // Student has 10 days attendance, 5 present -> 50% attendance
      attendance: {
        findMany: async () => [
          { status: 'present' }, { status: 'present' }, { status: 'present' }, { status: 'present' }, { status: 'present' },
          { status: 'absent' }, { status: 'absent' }, { status: 'absent' }, { status: 'absent' }, { status: 'absent' }
        ]
      },
      eligibilityRule: {
        findFirst: async () => ({ minAttendancePercent: 75 })
      }
    };

    // 2a. Without override: Attempting to advance to 'ready' must be blocked
    {
      const req = {
        tenantClient: mockDb,
        collegeId: mockCollegeId,
        params: { id: 'form-001' },
        user: { id: 'teacher-1', role: 'teacher' },
        body: { status: 'ready', overrideAttendance: false }
      };
      const res = createMockRes();
      await updateBoardFormStatus(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.errorCode, 'ATTENDANCE_SHORTAGE');
      assert.strictEqual(res.body.attendancePercent, 50);
      assert.strictEqual(res.body.minRequired, 75);
      assert.strictEqual(formData.status, 'draft', 'Status must remain draft on shortage');
      console.log('✓ 2a. Student with 50% attendance rejected from reaching "ready" (400 ATTENDANCE_SHORTAGE)');
    }

    // 2b. With Principal override & remarks: Transition to 'ready' succeeds
    {
      const req = {
        tenantClient: mockDb,
        collegeId: mockCollegeId,
        params: { id: 'form-001' },
        user: { id: 'principal-1', role: 'principal' },
        body: {
          status: 'ready',
          overrideAttendance: true,
          remarks: 'Institutional medical waiver approved by Principal'
        }
      };
      const res = createMockRes();
      await updateBoardFormStatus(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(formData.status, 'ready');
      assert.strictEqual(formData.attendanceOverrideBy, 'principal-1');
      assert.strictEqual(formData.remarks, 'Institutional medical waiver approved by Principal');
      console.log('✓ 2b. Principal override with reason successfully advanced status to "ready"');
    }
  }

  // ==============================================================================
  // 3. 20-Row Gazette CSV Import & Matching Test
  // ==============================================================================
  {
    const mockCollegeId = 'college-alpha';
    const insertedResults = [];

    // Pre-registered board forms for 12 students (rolls: 1001 to 1012)
    const mockBoardForms = [];
    for (let i = 1; i <= 12; i++) {
      mockBoardForms.push({
        id: `bf-${i}`,
        student_id: `student-${i}`,
        boardRollNumber: `100${i < 10 ? '0' + i : i}`
      });
    }

    const mockDb = {
      boardResultImport: {
        create: async ({ data }) => ({ id: 'import-99', ...data }),
        update: async () => ({ id: 'import-99' })
      },
      boardForm: {
        findMany: async () => mockBoardForms
      },
      boardResult: {
        upsert: async ({ create }) => {
          insertedResults.push(create);
          return { id: `res-${insertedResults.length}`, ...create };
        }
      }
    };

    // Generate 20 CSV rows:
    // Rolls 10001 to 10012 match pre-registered forms (12 matched)
    // Rolls 10013 to 10020 are external/unmatched (8 unmatched)
    const csvLines = ['roll_no,candidate_name,father_name,total_marks,obtained_marks,grade,status'];
    for (let i = 1; i <= 20; i++) {
      const roll = `100${i < 10 ? '0' + i : i}`;
      const marks = 350 + i * 8;
      const status = i === 19 ? 'fail' : 'pass';
      csvLines.push(`${roll},Student ${i},Father ${i},550,${marks},A,${status}`);
    }
    const csvText = csvLines.join('\n');

    const req = {
      tenantClient: mockDb,
      collegeId: mockCollegeId,
      body: {
        session_id: 'session-2026',
        board: 'FBISE Islamabad',
        examYear: 2026,
        part: 1,
        csvText
      }
    };
    const res = createMockRes();
    await importBoardResults(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.summary.totalRows, 20, 'Must process exactly 20 rows');
    assert.strictEqual(res.body.summary.matchedCount, 12, 'Must match exactly 12 pre-registered students');
    assert.strictEqual(res.body.summary.unmatchedCount, 8, 'Must record exactly 8 unmatched candidates');
    assert.strictEqual(insertedResults.length, 20, 'Must write all 20 records to BoardResult table');

    // Verify unmatched rows have student_id: null
    const unmatchedRecords = insertedResults.filter(r => r.student_id === null);
    assert.strictEqual(unmatchedRecords.length, 8);
    const matchedRecords = insertedResults.filter(r => r.student_id !== null);
    assert.strictEqual(matchedRecords.length, 12);
    console.log('✓ 3. 20-row sample imported: exactly 12 matched by roll number, 8 saved as unmatched (student_id: null)');
  }

  // ==============================================================================
  // 4. Board Result Analysis Totals Test
  // ==============================================================================
  {
    const mockCollegeId = 'college-alpha';

    // 25 result records with known status distribution:
    // 18 pass, 4 fail, 2 compartment, 1 absent = 25 appeared
    const mockResults = [];
    for (let i = 1; i <= 18; i++) {
      mockResults.push({
        id: `r-${i}`,
        boardRollNumber: `R-${i}`,
        student_id: `s-${i}`,
        status: 'pass',
        percentage: i <= 5 ? 85 : 72,
        grade: i <= 5 ? 'A+' : 'A',
        totalObtained: i <= 5 ? 465 : 395,
        totalMarks: 550,
        marks: [
          { subject: 'English', total: 80, pass: true },
          { subject: 'Urdu', total: 75, pass: true }
        ]
      });
    }
    for (let i = 19; i <= 22; i++) {
      mockResults.push({
        id: `r-${i}`,
        boardRollNumber: `R-${i}`,
        student_id: `s-${i}`,
        status: 'fail',
        percentage: 28,
        grade: 'F',
        totalObtained: 154,
        totalMarks: 550,
        marks: [
          { subject: 'English', total: 25, pass: false },
          { subject: 'Urdu', total: 20, pass: false }
        ]
      });
    }
    for (let i = 23; i <= 24; i++) {
      mockResults.push({
        id: `r-${i}`,
        boardRollNumber: `R-${i}`,
        student_id: `s-${i}`,
        status: 'compartment',
        percentage: 38,
        grade: 'E',
        totalObtained: 209,
        totalMarks: 550,
        marks: [
          { subject: 'English', total: 34, pass: true },
          { subject: 'Urdu', total: 28, pass: false }
        ]
      });
    }
    mockResults.push({
      id: `r-25`,
      boardRollNumber: `R-25`,
      student_id: `s-25`,
      status: 'absent',
      percentage: 0,
      grade: 'F',
      totalObtained: 0,
      totalMarks: 550,
      marks: []
    });

    const mockDb = {
      boardResult: {
        findMany: async () => mockResults
      },
      student: {
        findMany: async () => mockResults.map(r => ({
          id: r.student_id,
          name: `Student ${r.student_id}`,
          rollNumber: `ROLL-${r.student_id}`,
          group: 'Pre-Medical'
        }))
      },
      subject: {
        findMany: async () => [
          { id: 'sub-eng', name: 'English', code: 'ENG', teacher_id: 't-1' },
          { id: 'sub-urd', name: 'Urdu', code: 'URD', teacher_id: 't-2' }
        ]
      },
      teacher: {
        findMany: async () => [
          { id: 't-1', user_id: 'u-1', employeeCode: 'EMP-01' },
          { id: 't-2', user_id: 'u-2', employeeCode: 'EMP-02' }
        ]
      }
    };

    const req = {
      tenantClient: mockDb,
      collegeId: mockCollegeId,
      query: { board: 'FBISE Islamabad', examYear: 2026 }
    };
    const res = createMockRes();
    await getBoardResultAnalysis(req, res, (err) => { throw err; });

    assert.strictEqual(res.statusCode, 200);
    const { overall, gradeDistribution } = res.body.data;

    // Constraint: Analysis totals MUST exactly equal row counts
    assert.strictEqual(overall.appeared, 25, 'Total appeared must equal 25');
    assert.strictEqual(overall.passed, 18, 'Passed must equal 18');
    assert.strictEqual(overall.failed, 4, 'Failed must equal 4');
    assert.strictEqual(overall.compartment, 2, 'Compartment must equal 2');
    assert.strictEqual(overall.absent, 1, 'Absent must equal 1');

    const sumStatus = overall.passed + overall.failed + overall.compartment + overall.absent + overall.withheld;
    assert.strictEqual(overall.appeared, sumStatus, 'Sum of all status categories must equal total appeared');

    const sumGrades = Object.values(gradeDistribution).reduce((a, b) => a + b, 0);
    assert.strictEqual(overall.appeared, sumGrades, 'Sum of all grade distribution buckets must equal total appeared');

    assert.strictEqual(overall.aPlusCount, 5, 'A+ count must equal 5');
    assert.strictEqual(overall.passPercentage, 72.0, 'Pass percentage must equal 72.0% (18/25 * 100)');
    console.log('✓ 4. Analysis totals verified: appeared (25) exactly equals passed (18) + failed (4) + comp (2) + absent (1)');
  }

  console.log('\n========================================');
  console.log('ALL PHASE 6 AUTOMATED TESTS PASSED (100%)');
  console.log('========================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
