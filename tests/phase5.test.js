// tests/phase5.test.js
// Automated test suite for Phase 5:
// - Compulsory subject rejection & elective set validation
// - Move group rewrite & seat enforcement
// - Promotion engine dry-run mode vs real promotion
// - Capability catalog status validation

const assert = require('assert');
const { assignStudentSubjects, moveStudentGroup } = require('../controllers/groupSubject.controller');
const { runPromotions } = require('../controllers/batch.controller');
const { FEATURES } = require('../services/capabilityCatalog');

console.log('--- Starting Phase 5 Test Suite ---');

// Helper to create a mock Express response
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
    const requiredKeys = ['groups-subjects', 'combined-classes', 'group-transfer', 'session-batches'];
    for (const key of requiredKeys) {
      const feat = FEATURES.find(f => f.key === key);
      assert(feat, `Feature "${key}" must exist in capability catalog`);
      assert.strictEqual(feat.status, 'live', `Feature "${key}" status must be 'live', got '${feat.status}'`);
      assert.strictEqual(feat.effort, 'Done', `Feature "${key}" effort must be 'Done', got '${feat.effort}'`);
    }
    console.log('✓ 1. Capability catalog features confirmed as live & Done');
  }

  // ==============================================================================
  // 2. Compulsory Subject Rejection & Elective Limits Test
  // ==============================================================================
  {
    const mockCollegeId = 'college-123';
    const mockStudentId = 'student-456';
    const mockGroupId = 'grp-fsc-med';

    const mockDb = {
      student: {
        findFirst: async () => ({
          id: mockStudentId,
          college_id: mockCollegeId,
          name: 'Ali Ahmed',
          group: 'Pre-Medical',
          session_id: 'session-2025',
          status: 'active',
          subjects: []
        }),
        update: async ({ data }) => {
          return { id: mockStudentId, ...data };
        }
      },
      group: {
        findFirst: async () => ({
          id: mockGroupId,
          college_id: mockCollegeId,
          name: 'Pre-Medical'
        })
      },
      groupSubject: {
        findMany: async () => [
          { id: 'gs-1', subject_id: 'sub-bio', kind: 'compulsory', isActive: true },
          { id: 'gs-2', subject_id: 'sub-chem', kind: 'compulsory', isActive: true },
          { id: 'gs-3', subject_id: 'sub-elec1', kind: 'elective', electiveSet: 'Language', maxChoices: 1, isActive: true },
          { id: 'gs-4', subject_id: 'sub-elec2', kind: 'elective', electiveSet: 'Language', maxChoices: 1, isActive: true }
        ]
      },
      subject: {
        findUnique: async ({ where }) => ({ id: where.id, name: where.id.toUpperCase() }),
        findMany: async ({ where }) => (where.id.in || []).map(id => ({ id, name: id.toUpperCase(), code: id }))
      },
      studentSubject: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async ({ data }) => ({ count: data.length })
      }
    };

    // 2a. Attempt assigning subjects without compulsory 'sub-chem'
    {
      const req = {
        tenantClient: mockDb,
        collegeId: mockCollegeId,
        params: { id: mockStudentId },
        body: {
          subjectIds: ['sub-bio', 'sub-elec1'] // missing 'sub-chem'
        }
      };
      const res = createMockRes();
      await assignStudentSubjects(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 400, 'Should reject missing compulsory subject with status 400');
      assert.strictEqual(res.body.errorCode, 'MISSING_COMPULSORY_SUBJECT');
      assert.strictEqual(res.body.missingSubjectId, 'sub-chem');
      console.log('✓ 2a. Correctly rejected assignment missing compulsory subject (400 MISSING_COMPULSORY_SUBJECT)');
    }

    // 2b. Attempt exceeding maxChoices for elective set
    {
      const req = {
        tenantClient: mockDb,
        collegeId: mockCollegeId,
        params: { id: mockStudentId },
        body: {
          subjectIds: ['sub-bio', 'sub-chem', 'sub-elec1', 'sub-elec2'] // 2 chosen, maxChoices is 1
        }
      };
      const res = createMockRes();
      await assignStudentSubjects(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 400, 'Should reject exceeded electives with status 400');
      assert.strictEqual(res.body.errorCode, 'ELECTIVE_LIMIT_EXCEEDED');
      console.log('✓ 2b. Correctly rejected assignment exceeding elective set capacity (400 ELECTIVE_LIMIT_EXCEEDED)');
    }

    // 2c. Valid assignment including all compulsory + allowed elective
    {
      const req = {
        tenantClient: mockDb,
        collegeId: mockCollegeId,
        params: { id: mockStudentId },
        body: {
          subjectIds: ['sub-bio', 'sub-chem', 'sub-elec1']
        }
      };
      const res = createMockRes();
      await assignStudentSubjects(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 200, 'Valid subject assignment should succeed with 200');
      assert.strictEqual(res.body.success, true);
      assert.deepStrictEqual(res.body.subjects, ['SUB-BIO', 'SUB-CHEM', 'SUB-ELEC1']);
      console.log('✓ 2c. Valid subject assignment succeeded and synced Student.subjects array');
    }
  }

  // ==============================================================================
  // 3. Move Group Transfer & Seat Enforcement Test
  // ==============================================================================
  {
    const mockCollegeId = 'college-123';
    let studentRecord = {
      id: 'student-999',
      college_id: mockCollegeId,
      name: 'Zainab Tariq',
      group: 'Pre-Medical',
      section: 'A',
      session_id: 'session-2025',
      status: 'active',
      subjects: ['SUB-BIO', 'SUB-CHEM']
    };

    let studentSubjectsCreated = [];

    const mockDb = {
      student: {
        findFirst: async () => studentRecord,
        count: async ({ where }) => {
          if (where.group === 'Full-ICS') return 50;
          return 10;
        },
        update: async ({ data }) => {
          studentRecord = { ...studentRecord, ...data };
          return studentRecord;
        }
      },
      group: {
        findFirst: async ({ where }) => {
          if (where.name === 'Full-ICS' || where.id === 'grp-full') {
            return { id: 'grp-full', name: 'Full-ICS', seats: 50 };
          }
          return { id: 'grp-ics', name: 'ICS-Physics', seats: 60 };
        }
      },
      groupSubject: {
        findMany: async () => [
          { id: 'gs-comp', subject_id: 'sub-comp', kind: 'compulsory', isActive: true },
          { id: 'gs-math', subject_id: 'sub-math', kind: 'compulsory', isActive: true }
        ]
      },
      subject: {
        findMany: async ({ where }) => (where.id.in || []).map(id => ({ id, name: id.toUpperCase() })),
        findUnique: async ({ where }) => ({ id: where.id, name: where.id.toUpperCase() })
      },
      studentSubject: {
        deleteMany: async () => { studentSubjectsCreated = []; return { count: 2 }; },
        createMany: async ({ data }) => { studentSubjectsCreated = data; return { count: data.length }; }
      },
      activityLog: {
        create: async () => ({ id: 'log-1' })
      }
    };

    // 3a. Inactive student cannot be moved
    {
      const inactiveDb = {
        ...mockDb,
        student: {
          ...mockDb.student,
          findFirst: async () => ({ ...studentRecord, status: 'inactive' })
        }
      };
      const req = {
        tenantClient: inactiveDb,
        collegeId: mockCollegeId,
        params: { id: 'student-999' },
        body: { targetGroupId: 'grp-ics' }
      };
      const res = createMockRes();
      await moveStudentGroup(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 400);
      assert(res.body.message.includes('Only active students can be moved'));
      console.log('✓ 3a. Inactive student transfer rejected (400 Only active students can be moved)');
    }

    // 3b. Group with full seats rejects transfer
    {
      const req = {
        tenantClient: mockDb,
        collegeId: mockCollegeId,
        params: { id: 'student-999' },
        body: { targetGroupId: 'grp-full' }
      };
      const res = createMockRes();
      await moveStudentGroup(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 400);
      assert(res.body.message.includes('is full'));
      console.log('✓ 3b. Transfer to full group rejected (400 Group is full)');
    }

    // 3c. Successful move group rewrites group, subjects, and StudentSubject records
    {
      const req = {
        tenantClient: mockDb,
        collegeId: mockCollegeId,
        params: { id: 'student-999' },
        body: {
          targetGroupId: 'grp-ics',
          section: 'B-ICS',
          reason: 'Student switched from Pre-Medical to ICS-Physics'
        }
      };
      const res = createMockRes();
      await moveStudentGroup(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(studentRecord.group, 'ICS-Physics');
      assert.strictEqual(studentRecord.section, 'B-ICS');
      assert.deepStrictEqual(studentRecord.subjects, ['SUB-COMP', 'SUB-MATH']);
      assert.strictEqual(studentSubjectsCreated.length, 2);
      console.log('✓ 3c. Student transferred group successfully, rewrote StudentSubject and Student.subjects');
    }
  }

  // ==============================================================================
  // 4. Batch Promotion Engine (Dry-Run vs Real Execution) Test
  // ==============================================================================
  {
    const mockCollegeId = 'college-123';
    let dbWrites = 0;

    const mockStudents = [
      {
        id: 's-1',
        college_id: mockCollegeId,
        name: 'Usman Ghani',
        rollNumber: '2024-001',
        session_id: 'session-part1',
        class: '1st Year',
        group: 'Pre-Engineering',
        section: 'A',
        status: 'active',
        subjects: ['Math', 'Physics', 'Chemistry']
      },
      {
        id: 's-2',
        college_id: mockCollegeId,
        name: 'Fatima Noor',
        rollNumber: '2024-002',
        session_id: 'session-part1',
        class: '1st Year',
        group: 'Pre-Engineering',
        section: 'A',
        status: 'active',
        subjects: ['Math', 'Physics', 'Chemistry']
      }
    ];

    const mockDb = {
      session: {
        findUnique: async ({ where }) => {
          if (where.id === 'session-part1') return { id: 'session-part1', name: '2024-2025' };
          if (where.id === 'session-part2') return { id: 'session-part2', name: '2025-2026' };
          return null;
        },
        findFirst: async ({ where }) => {
          if (where.id === 'session-part1') return { id: 'session-part1', name: '2024-2025' };
          if (where.id === 'session-part2') return { id: 'session-part2', name: '2025-2026' };
          return null;
        }
      },
      student: {
        findMany: async () => mockStudents,
        create: async (data) => {
          dbWrites++;
          return { id: 'new-' + data.data.rollNumber, ...data.data };
        },
        update: async () => {
          dbWrites++;
          return {};
        }
      },
      studentSubject: {
        findMany: async () => [{ subject_id: 'sub-math', kind: 'compulsory' }],
        createMany: async () => {
          dbWrites++;
          return { count: 1 };
        }
      },
      studentPromotion: {
        create: async () => {
          dbWrites++;
          return { id: 'promo-1' };
        }
      }
    };

    // 4a. Dry Run mode: Must return candidates & samples, touching ZERO database records
    {
      const req = {
        tenantClient: mockDb,
        collegeId: mockCollegeId,
        body: {
          fromSessionId: 'session-part1',
          toSessionId: 'session-part2',
          fromClass: '1st Year',
          targetClass: '2nd Year',
          dryRun: true
        }
      };
      const res = createMockRes();
      await runPromotions(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.dryRun, true);
      assert.strictEqual(res.body.totalEligible, 2);
      assert.strictEqual(res.body.sample.length, 2);
      assert.strictEqual(dbWrites, 0, 'Dry-run mode must make zero database write operations');
      console.log('✓ 4a. Promotion dry-run returned counts and samples without mutating database (dbWrites === 0)');
    }

    // 4b. Real execution mode: Creates Part 2 student, updates old status, logs promotion
    {
      const req = {
        tenantClient: mockDb,
        collegeId: mockCollegeId,
        body: {
          fromSessionId: 'session-part1',
          toSessionId: 'session-part2',
          fromClass: '1st Year',
          targetClass: '2nd Year',
          dryRun: false
        }
      };
      const res = createMockRes();
      await runPromotions(req, res, (err) => { throw err; });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.dryRun, false);
      assert.strictEqual(res.body.promotedCount, 2);
      assert(dbWrites > 0, 'Real execution must write records to database');
      console.log(`✓ 4b. Real promotion execution completed: ${res.body.promotedCount} students promoted, records written`);
    }

    console.log('\n========================================');
    console.log('ALL PHASE 5 AUTOMATED TESTS PASSED (100%)');
    console.log('========================================\n');
  }
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
