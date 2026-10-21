require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FEATURES } = require('../services/capabilityCatalog');
const {
  generateTimetableSchedule,
  runBenchmark
} = require('../services/timetableGenerator.service');
const {
  generateDraft,
  applyDraft,
  explainDraft
} = require('../controllers/timetableGenerator.controller');

async function runTests() {
  console.log('--- Starting Phase 16 Test Suite: Timetable Generator & AI Assist ---');

  // Test 1: Capability Catalog verification
  const genFeat = FEATURES.find(f => f.key === 'timetable-generator');
  assert(genFeat, 'timetable-generator feature must exist in capabilityCatalog');
  assert.strictEqual(genFeat.status, 'live');
  assert.strictEqual(genFeat.effort, 'Done');
  assert.strictEqual(genFeat.plan, 'premium');

  const aiFeat = FEATURES.find(f => f.key === 'ai-timetable-assist');
  assert(aiFeat, 'ai-timetable-assist feature must exist in capabilityCatalog');
  assert.strictEqual(aiFeat.status, 'live');
  assert.strictEqual(aiFeat.effort, 'Done');
  assert.strictEqual(aiFeat.plan, 'enterprise');
  console.log('✓ 1. Catalog features (timetable-generator, ai-timetable-assist) verified live and Done');

  // Test 2: Prisma Schema verification
  const schemaContent = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  assert(schemaContent.includes('model TimetableConstraint'), 'TimetableConstraint model must exist in schema.prisma');
  assert(schemaContent.includes('model TimetableDraft'), 'TimetableDraft model must exist in schema.prisma');
  assert(schemaContent.includes('hardScore') && schemaContent.includes('unplacedPeriods'), 'TimetableDraft must have hardScore & unplacedPeriods');
  console.log('✓ 2. Prisma schema verified with TimetableConstraint and TimetableDraft models');

  // Test 3: CSP Scheduling Engine Core & Hard Constraint Invariants
  const sampleSections = [
    { id: 'sec-1', name: '11th-A', class: '11th', group: 'Pre-Engineering' },
    { id: 'sec-2', name: '11th-B', class: '11th', group: 'Pre-Engineering' }
  ];

  const sampleSubjects = [
    { id: 'sub-phy', name: 'Physics', weeklyLoad: 4, isPractical: true, teacher_id: 'teach-phy' },
    { id: 'sub-math', name: 'Mathematics', weeklyLoad: 4, isPractical: false, teacher_id: 'teach-math' },
    { id: 'sub-chem', name: 'Chemistry', weeklyLoad: 4, isPractical: true, teacher_id: 'teach-chem' }
  ];

  const sampleTeacherSubjects = [
    { teacher_id: 'teach-phy', subject_id: 'sub-phy', isPrimary: true },
    { teacher_id: 'teach-math', subject_id: 'sub-math', isPrimary: true },
    { teacher_id: 'teach-chem', subject_id: 'sub-chem', isPrimary: true }
  ];

  // Constraint: teach-phy is unavailable on Monday Period 1
  const sampleConstraints = [
    {
      id: 'c-1',
      kind: 'teacher_unavailable',
      teacher_id: 'teach-phy',
      data: { day: 'Monday', period: 1 }
    }
  ];

  const scheduleResult = generateTimetableSchedule({
    sections: sampleSections,
    subjects: sampleSubjects,
    teacherSubjects: sampleTeacherSubjects,
    constraints: sampleConstraints,
    options: {
      periodsPerDay: 8,
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      timeLimitMs: 5000
    }
  });

  assert.strictEqual(scheduleResult.hardScore, 0, 'Hard constraint violations must be 0');
  assert(Array.isArray(scheduleResult.grid), 'Generated schedule must return a grid');

  // Verify teach-phy was NOT scheduled on Monday period 1 in any section
  scheduleResult.grid.forEach(secDay => {
    if (secDay.day === 'Monday') {
      const p1 = secDay.periods.find(p => p.periodNumber === 1);
      if (p1 && p1.teacher_id) {
        assert.notStrictEqual(p1.teacher_id, 'teach-phy', 'teach-phy must not be scheduled during unavailable slot');
      }
    }
  });

  // Verify double period adjacency for practicals
  let foundDouble = false;
  scheduleResult.grid.forEach(secDay => {
    for (let i = 0; i < secDay.periods.length - 1; i++) {
      const cur = secDay.periods[i];
      const next = secDay.periods[i + 1];
      if (cur.isPractical && next.isPractical && cur.subject_id === next.subject_id && cur.subject_id) {
        foundDouble = true;
        assert.strictEqual(next.periodNumber, cur.periodNumber + 1, 'Lab double periods must be strictly adjacent');
      }
    }
  });
  assert(foundDouble, 'Practical subject must have adjacent double periods');
  console.log('✓ 3. CSP Engine verified: 0 hard violations, unavailability respected, adjacent practical double periods');

  // Test 4: Combined Class Synchronization Across Sections (Phase 5 integration)
  const combinedClasses = [
    {
      id: 'cc-isl',
      subject_id: 'sub-isl',
      teacher_id: 'teach-isl',
      sectionIds: ['sec-1', 'sec-2'],
      isActive: true,
      room: 'Main Auditorium'
    }
  ];

  const combinedSchedule = generateTimetableSchedule({
    sections: sampleSections,
    subjects: [
      { id: 'sub-isl', name: 'Islamiat', weeklyLoad: 2, isPractical: false, teacher_id: 'teach-isl' }
    ],
    teacherSubjects: [
      { teacher_id: 'teach-isl', subject_id: 'sub-isl', isPrimary: true }
    ],
    combinedClasses,
    options: { periodsPerDay: 8, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] }
  });

  // Verify sec-1 and sec-2 share the exact same slot for Islamiat
  const sec1Slots = combinedSchedule.grid.filter(g => g.section_id === 'sec-1');
  const sec2Slots = combinedSchedule.grid.filter(g => g.section_id === 'sec-2');

  let combinedMatched = false;
  sec1Slots.forEach(g1 => {
    const g2 = sec2Slots.find(g => g.day === g1.day);
    if (g2) {
      g1.periods.forEach(p1 => {
        if (p1.isCombined && p1.subject_id === 'sub-isl') {
          const p2 = g2.periods.find(p => p.periodNumber === p1.periodNumber);
          assert(p2, 'Matching combined period must exist in section 2');
          assert.strictEqual(p2.subject_id, 'sub-isl');
          assert.strictEqual(p2.teacher_id, 'teach-isl');
          combinedMatched = true;
        }
      });
    }
  });
  assert(combinedMatched, 'Combined class must be synchronized across member sections');
  console.log('✓ 4. Combined class synchronization verified across member sections');

  // Test 5: Draft Apply with Diff Calculation & Transaction
  const mockDraft = {
    id: 'draft-1',
    college_id: 'col-1',
    hardScore: 0,
    grid: [
      {
        class: '11th',
        section: 'A',
        day: 'Monday',
        periods: [{ periodNumber: 1, subject_id: 'sub-phy', teacher_id: 'teach-phy' }]
      }
    ]
  };

  let transactionExecuted = false;
  let deletedCount = 0;
  let createdCount = 0;
  const mockApplyDb = {
    timetableDraft: {
      findFirst: async () => mockDraft,
      update: async () => ({ ...mockDraft, status: 'applied' })
    },
    timetable: {
      findMany: async () => [
        // Existing timetable entry that will be modified
        { id: 'tt-old-1', class: '11th', section: 'A', day: 'Monday' }
      ]
    },
    $transaction: async (fn) => {
      transactionExecuted = true;
      return fn({
        timetable: {
          deleteMany: async () => { deletedCount++; },
          create: async () => { createdCount++; }
        },
        timetableDraft: {
          update: async () => ({ ...mockDraft, status: 'applied' })
        }
      });
    }
  };

  let jsonResult = null;
  await applyDraft({
    tenantClient: mockApplyDb,
    collegeId: 'col-1',
    params: { id: 'draft-1' },
    user: { id: 'admin-1' },
    body: {}
  }, {
    json: (data) => { jsonResult = data; },
    status: (code) => ({ json: (data) => { jsonResult = data; } })
  }, (err) => { if (err) throw err; });

  assert(jsonResult.success, 'applyDraft must succeed');
  assert(transactionExecuted, 'applyDraft must execute within database transaction');
  assert.strictEqual(deletedCount, 1, 'Previous timetable entry must be removed');
  assert.strictEqual(createdCount, 1, 'New timetable entry must be created');
  assert.strictEqual(jsonResult.diff.modifiedEntries, 1, 'Diff must detect modified entry');
  console.log('✓ 5. Draft apply verified with transaction and diff calculation');

  // Test 6: Hard Violation Protection (draft with hardScore > 0 rejected)
  const mockBadDraft = {
    id: 'draft-bad',
    college_id: 'col-1',
    hardScore: 2 // Has 2 hard violations!
  };
  let badStatus = null;
  await applyDraft({
    tenantClient: {
      timetableDraft: { findFirst: async () => mockBadDraft }
    },
    collegeId: 'col-1',
    params: { id: 'draft-bad' },
    user: { id: 'admin-1' },
    body: {}
  }, {
    status: (code) => {
      badStatus = code;
      return { json: () => {} };
    },
    json: () => {}
  }, (err) => { if (err) throw err; });

  assert.strictEqual(badStatus, 400, 'Draft with hard violations must be blocked from applying');
  console.log('✓ 6. Hard constraint safety guard verified (cannot apply draft with violations)');

  // Test 7: AI Assist Anonymisation & Suggestion Generation
  const mockUnplacedDraft = {
    id: 'draft-unplaced-1',
    college_id: 'col-1',
    unplacedPeriods: [
      {
        subjectName: 'Physics Practical',
        teacherId: 'real-teacher-secret-id-99',
        reason: 'Laboratory room busy during all available period slots'
      }
    ]
  };

  jsonResult = null;
  await explainDraft({
    tenantClient: {
      timetableDraft: { findFirst: async () => mockUnplacedDraft }
    },
    collegeId: 'col-1',
    user: { id: 'admin-1' },
    params: { id: 'draft-unplaced-1' }
  }, {
    json: (data) => { jsonResult = data; }
  }, (err) => { if (err) throw err; });

  assert(jsonResult.success, 'explainDraft must succeed');
  assert.strictEqual(jsonResult.data.unplacedCount, 1);
  const anon = jsonResult.data.anonymisedSummary[0];
  assert.strictEqual(anon.teacherRef, 'Teacher_T1', 'Teacher ID must be anonymised to Teacher_T1');
  assert(!JSON.stringify(jsonResult).includes('real-teacher-secret-id-99'), 'Real teacher ID must never be exposed');
  assert(Array.isArray(jsonResult.data.suggestions) && jsonResult.data.suggestions.length >= 3, 'Must return at least 3 concrete suggestions');
  console.log('✓ 7. AI assist verified: strict anonymisation (no personal IDs) and 3 concrete suggestions');

  // Test 8: Benchmark Execution (12 sections, 8 periods, 40 teachers)
  console.log('Running Phase 16 benchmark on 12 sections, 8 periods, 40 teachers...');
  const bench = runBenchmark();
  assert.strictEqual(bench.sections, 12, 'Benchmark must test 12 sections');
  assert.strictEqual(bench.periodsPerDay, 8, 'Benchmark must test 8 periods');
  assert.strictEqual(bench.teachers, 40, 'Benchmark must test 40 teachers');
  assert.strictEqual(bench.hardScore, 0, 'Benchmark hardScore must be 0');
  assert.strictEqual(bench.unplacedCount, 0, 'Benchmark unplaced count must be 0');
  assert(bench.timeTakenMs < 20000, `Benchmark must complete within 20s (took ${bench.timeTakenMs}ms)`);
  console.log(`✓ 8. Benchmark PASSED: 12 sections, 40 teachers, 8 periods: ${bench.placedDemands}/${bench.totalDemands} placed in ${bench.timeTakenMs}ms (0 unplaced, 0 hard violations)`);

  console.log('========================================================================');
  console.log('🎉 ALL 8 PHASE 16 TESTS PASSED SUCCESSFULLY (100%)');
  console.log('========================================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Phase 16 test failed:', err);
  process.exit(1);
});
