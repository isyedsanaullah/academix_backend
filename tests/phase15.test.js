require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FEATURES } = require('../services/capabilityCatalog');
const {
  getTeachersForSubject,
  getSubjectsForTeacher,
  checkTimetableClashes
} = require('../services/timetable.service');

async function runTests() {
  console.log('--- Starting Phase 15 Test Suite: Timetable (Multi-Subject, Views & Substitutions) ---');

  // Test 1: Capability Catalog verification
  const catalogKeys = ['teacher-subjects', 'student-timetable', 'teacher-today', 'substitutions'];
  catalogKeys.forEach(key => {
    const feat = FEATURES.find(f => f.key === key);
    assert(feat, `${key} feature must exist in capabilityCatalog`);
    assert.strictEqual(feat.status, 'live', `${key} status must be live`);
    assert.strictEqual(feat.effort, 'Done', `${key} effort must be Done`);
  });
  console.log('✓ 1. Catalog features (teacher-subjects, student-timetable, teacher-today, substitutions) verified live and Done');

  // Test 2: Prisma Schema verification
  const schemaContent = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  assert(schemaContent.includes('model TeacherSubject'), 'TeacherSubject model must exist in schema.prisma');
  assert(schemaContent.includes('model TimetableSubstitution'), 'TimetableSubstitution model must exist in schema.prisma');
  assert(schemaContent.includes('slotKey'), 'TimetableSubstitution must include slotKey');
  console.log('✓ 2. Prisma schema verified with TeacherSubject and TimetableSubstitution models');

  // Test 3: Multi-subject resolution (TeacherSubject + Subject.teacher_id)
  const mockTenantDb = {
    subject: {
      findFirst: async ({ where }) => {
        const subs = [
          { id: 'sub-phy', name: 'Physics', teacher_id: 'teach-1' },
          { id: 'sub-chem', name: 'Chemistry', teacher_id: 'teach-2' }
        ];
        return subs.find(s => s.id === where?.id) || null;
      },
      findMany: async () => [
        { id: 'sub-phy', name: 'Physics', teacher_id: 'teach-1' },
        { id: 'sub-chem', name: 'Chemistry', teacher_id: 'teach-2' }
      ]
    },
    teacherSubject: {
      findMany: async ({ where }) => {
        const list = [
          { id: 'ts-1', teacher_id: 'teach-1', subject_id: 'sub-chem', maxPeriodsPerDay: 3 }
        ];
        return list.filter(ts => !where?.subject_id || ts.subject_id === where.subject_id);
      }
    },
    teacher: {
      findMany: async () => [
        { id: 'teach-1', user_id: 'u-1' },
        { id: 'teach-2', user_id: 'u-2' }
      ]
    },
    user: {
      findMany: async () => [
        { id: 'u-1', name: 'Prof. Ahmad', email: 'ahmad@college.edu' },
        { id: 'u-2', name: 'Dr. Bilal', email: 'bilal@college.edu' }
      ]
    }
  };

  const teachersForChem = await getTeachersForSubject(mockTenantDb, 'col-1', 'sub-chem');
  assert.strictEqual(teachersForChem.length, 2, 'Should find 2 teachers for Chemistry (primary + assigned)');
  const primaryChem = teachersForChem.find(t => t.id === 'teach-2');
  const secondaryChem = teachersForChem.find(t => t.id === 'teach-1');
  assert(primaryChem.isPrimary, 'teach-2 must be primary teacher for Chemistry');
  assert(!secondaryChem.isPrimary, 'teach-1 must be secondary/assigned teacher for Chemistry');

  const subjectsForTeach1 = await getSubjectsForTeacher(mockTenantDb, 'col-1', 'teach-1');
  assert.strictEqual(subjectsForTeach1.length, 2, 'teach-1 should have 2 subjects (Physics as primary, Chemistry as secondary)');
  console.log('✓ 3. Multi-subject teacher resolution verified (resolves Subject.teacher_id + TeacherSubject)');

  // Test 4: Timetable Clash Detection
  // Case 4a: Section internal duplicate period
  const duplicatePeriodClash = await checkTimetableClashes({
    tenantDb: { timetable: { findMany: async () => [] } },
    collegeId: 'col-1',
    day: 'Monday',
    targetClass: '11th',
    targetSection: 'A',
    periods: [
      { periodNumber: 1, teacher_id: 'teach-1' },
      { periodNumber: 1, teacher_id: 'teach-2' } // Duplicate periodNumber!
    ]
  });
  assert.strictEqual(duplicatePeriodClash.hasClash, true);
  assert.strictEqual(duplicatePeriodClash.code, 'SECTION_PERIOD_CLASH');

  // Case 4b: Teacher double-booked in another section during same period
  const teacherClashDb = {
    timetable: {
      findMany: async () => [
        {
          id: 'tt-other',
          class: '11th',
          section: 'B',
          day: 'Monday',
          periods: [
            { periodNumber: 2, teacher_id: 'teach-1', isBreak: false }
          ]
        }
      ]
    },
    teacher: {
      findFirst: async () => ({ id: 'teach-1', user_id: 'u-1' })
    },
    user: {
      findFirst: async () => ({ id: 'u-1', name: 'Prof. Ahmad' })
    }
  };

  const teacherClash = await checkTimetableClashes({
    tenantDb: teacherClashDb,
    collegeId: 'col-1',
    day: 'Monday',
    targetClass: '11th',
    targetSection: 'A',
    periods: [
      { periodNumber: 2, teacher_id: 'teach-1', isBreak: false }
    ]
  });
  assert.strictEqual(teacherClash.hasClash, true);
  assert.strictEqual(teacherClash.code, 'TEACHER_DOUBLE_BOOKED');
  assert(teacherClash.message.includes('Prof. Ahmad'), 'Clash message should name the conflicting teacher');

  // Case 4c: Clean timetable with no clashes
  const noClash = await checkTimetableClashes({
    tenantDb: teacherClashDb,
    collegeId: 'col-1',
    day: 'Monday',
    targetClass: '11th',
    targetSection: 'A',
    periods: [
      { periodNumber: 3, teacher_id: 'teach-1', isBreak: false }
    ]
  });
  assert.strictEqual(noClash.hasClash, false);
  console.log('✓ 4. Timetable clash detection verified (section duplicate period & teacher double-booking)');

  // Test 5: Substitution Rule Enforcement
  // Rule 5a: One substitute cannot take all periods if absent teacher has >= 2 periods
  const { assignSubstitution } = require('../controllers/substitution.controller');
  
  const mockSubDb = {
    teacher: {
      findFirst: async ({ where }) => ({ id: where.id, user_id: 'u-' + where.id })
    },
    college: {
      findFirst: async () => ({ id: 'col-1', settings: { maxSubstitutionsPerTeacherPerDay: 2 } })
    },
    timetable: {
      findMany: async () => [
        {
          id: 'tt-absent',
          class: '11th',
          section: 'A',
          day: 'Monday',
          periods: [
            { periodNumber: 1, teacher_id: 'teach-absent' },
            { periodNumber: 2, teacher_id: 'teach-absent' } // 2 periods total for absent teacher
          ]
        }
      ]
    },
    timetableSubstitution: {
      findFirst: async () => null,
      findMany: async () => [
        // Already substituted period 1 with teach-sub
        {
          id: 'sub-existing-1',
          date: '2026-10-26',
          absentTeacher_id: 'teach-absent',
          substituteTeacher_id: 'teach-sub',
          periodNumber: 1,
          status: 'active'
        }
      ]
    }
  };

  // Attempt to assign period 2 to teach-sub as well
  let statusResult = null;
  let jsonResult = null;
  const mockRes = {
    status: (code) => {
      statusResult = code;
      return {
        json: (data) => { jsonResult = data; }
      };
    },
    json: (data) => { jsonResult = data; }
  };

  await assignSubstitution({
    tenantClient: mockSubDb,
    collegeId: 'col-1',
    user: { id: 'admin-1' },
    body: {
      date: '2026-10-26',
      slotKey: 'Monday_P2_11th_A',
      class: '11th',
      section: 'A',
      periodNumber: 2,
      absentTeacher_id: 'teach-absent',
      substituteTeacher_id: 'teach-sub'
    }
  }, mockRes, (err) => { if (err) throw err; });

  assert.strictEqual(statusResult, 409, 'Should return 409 conflict when 1 substitute assigned all periods');
  assert.strictEqual(jsonResult.code, 'SUBSTITUTE_LIMIT');
  console.log('✓ 5. Substitution limit rule verified (409 SUBSTITUTE_LIMIT when 1 substitute takes all periods)');

  // Test 6: Daily Substitution Cap (maxSubstitutionsPerTeacherPerDay = 2)
  const mockCapDb = {
    teacher: {
      findFirst: async ({ where }) => ({ id: where.id, user_id: 'u-' + where.id })
    },
    college: {
      findFirst: async () => ({ id: 'col-1', settings: { maxSubstitutionsPerTeacherPerDay: 2 } })
    },
    timetable: {
      findMany: async () => []
    },
    timetableSubstitution: {
      findFirst: async () => null,
      findMany: async ({ where }) => {
        // Already has 2 active substitutions on this day
        if (where?.substituteTeacher_id === 'teach-sub') {
          return [
            { id: 'sub-1', date: '2026-10-26', status: 'active' },
            { id: 'sub-2', date: '2026-10-26', status: 'active' }
          ];
        }
        return [];
      }
    }
  };

  statusResult = null;
  jsonResult = null;
  await assignSubstitution({
    tenantClient: mockCapDb,
    collegeId: 'col-1',
    user: { id: 'admin-1' },
    body: {
      date: '2026-10-26',
      slotKey: 'Monday_P3_12th_B',
      class: '12th',
      section: 'B',
      periodNumber: 3,
      absentTeacher_id: 'teach-other',
      substituteTeacher_id: 'teach-sub'
    }
  }, mockRes, (err) => { if (err) throw err; });

  assert.strictEqual(statusResult, 409, 'Should return 409 when substitute exceeds daily cap');
  assert.strictEqual(jsonResult.code, 'DAILY_SUBSTITUTION_LIMIT');
  console.log('✓ 6. Daily substitution cap verified (maxSubstitutionsPerTeacherPerDay enforcement)');

  // Test 7: Teacher Today View calculation
  const { getTeacherToday } = require('../controllers/timetable.controller');
  const mockTeacherTodayDb = {
    teacher: {
      findFirst: async () => ({ id: 'teach-today-1', user_id: 'u-teach-1' })
    },
    timetable: {
      findMany: async () => [
        {
          id: 'tt-today',
          class: '11th',
          section: 'A',
          group: 'Pre-Medical',
          periods: [
            { periodNumber: 1, startTime: '08:30', endTime: '09:15', teacher_id: 'teach-today-1', subject_id: 'sub-bio' },
            { periodNumber: 2, startTime: '09:15', endTime: '10:00', teacher_id: 'teach-today-1', subject_id: 'sub-bio' }
          ]
        }
      ]
    },
    timetableSubstitution: {
      findMany: async () => []
    },
    subject: {
      findMany: async () => [{ id: 'sub-bio', name: 'Biology' }]
    },
    user: {
      findMany: async () => []
    }
  };

  jsonResult = null;
  await getTeacherToday({
    tenantClient: mockTeacherTodayDb,
    collegeId: 'col-1',
    user: { id: 'u-teach-1' }
  }, {
    json: (data) => { jsonResult = data; }
  }, (err) => { if (err) throw err; });

  assert(jsonResult.success, 'getTeacherToday must return success');
  assert(jsonResult.data.date, 'getTeacherToday must return current Karachi date');
  assert(jsonResult.data.statusMessage, 'getTeacherToday must produce a human status message');
  console.log('✓ 7. Teacher today dashboard calculation verified');

  // Test 8: Student Timetable Overlay with Substitutions
  const { getMyTimetable } = require('../controllers/timetable.controller');
  const mockStudentDb = {
    student: {
      findFirst: async () => ({ id: 'stud-1', user_id: 'u-stud-1', class: '11th', section: 'A' })
    },
    timetable: {
      findMany: async () => [
        {
          id: 'tt-week-mon',
          class: '11th',
          section: 'A',
          day: 'Monday',
          periods: [
            { periodNumber: 1, teacher_id: 'teach-orig-1', subject_id: 'sub-math' }
          ]
        }
      ]
    },
    timetableSubstitution: {
      findMany: async () => [
        {
          id: 'sub-mon-1',
          date: '2026-10-26', // Monday
          class: '11th',
          section: 'A',
          periodNumber: 1,
          subject_id: 'sub-math',
          absentTeacher_id: 'teach-orig-1',
          substituteTeacher_id: 'teach-sub-1',
          reason: 'Medical Leave',
          status: 'active'
        }
      ]
    },
    subject: {
      findMany: async () => [{ id: 'sub-math', name: 'Mathematics' }]
    },
    teacher: {
      findMany: async () => [
        { id: 'teach-orig-1', user_id: 'u-orig' },
        { id: 'teach-sub-1', user_id: 'u-sub' }
      ]
    },
    user: {
      findMany: async () => [
        { id: 'u-orig', name: 'Sir Original' },
        { id: 'u-sub', name: 'Sir Substitute' }
      ]
    }
  };

  jsonResult = null;
  await getMyTimetable({
    tenantClient: mockStudentDb,
    collegeId: 'col-1',
    user: { id: 'u-stud-1' },
    query: { date: '2026-10-26' }
  }, {
    json: (data) => { jsonResult = data; }
  }, (err) => { if (err) throw err; });

  assert(jsonResult.success, 'getMyTimetable must succeed');
  const monTimetable = jsonResult.data.find(t => t.day === 'Monday');
  assert(monTimetable, 'Monday timetable must be returned');
  const p1 = monTimetable.periods.find(p => p.periodNumber === 1);
  assert(p1.isSubstitution, 'Period 1 must be flagged as a substitution');
  assert.strictEqual(p1.teacher_id.name, 'Sir Substitute', 'Period 1 teacher name must be the substitute teacher');
  assert.strictEqual(p1.originalTeacher.name, 'Sir Original', 'Original teacher must be preserved');
  console.log('✓ 8. Student timetable substitution overlay verified (shows substitute teacher and preserves original)');

  console.log('========================================================================');
  console.log('🎉 ALL 8 PHASE 15 TESTS PASSED SUCCESSFULLY (100%)');
  console.log('========================================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Phase 15 test failed:', err);
  process.exit(1);
});
