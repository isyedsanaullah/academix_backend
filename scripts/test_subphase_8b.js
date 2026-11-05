'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();
const classDiaryService = require('../services/classDiaryService');
const workingDaysService = require('../services/workingDaysService');

async function testPhase8B() {
  console.log('--- Testing Sub-Phase 8B: #28 Class Diary & Academic Calendar ---');

  const college = await prisma.college.findFirst();
  assert.ok(college, 'College exists');

  let session = await prisma.session.findFirst({ where: { college_id: college.id } });
  if (!session) {
    session = await prisma.session.create({
      data: {
        college_id: college.id,
        name: 'Test Session Diary ' + Date.now(),
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-06-30')
      }
    });
  }

  const sectionId = 'sec_' + Date.now();
  const subjectId = 'sub_' + Date.now();
  const teacherId = 'teacher_' + Date.now();
  const entryDate = '2026-11-10';

  // 1. Create Period 1 Diary Entry
  console.log('1. Creating Period 1 diary entry...');
  const entryP1 = await classDiaryService.recordDiaryEntry({
    collegeId: college.id,
    sectionId,
    subjectId,
    teacherId,
    entryDate,
    periodNumber: 1,
    topicCovered: 'Quadratic Equations Introduction',
    homework: 'Exercise 2.1, Q 1-5',
    remarks: 'Active student participation'
  });
  assert.ok(entryP1.id, 'Period 1 entry created');
  assert.strictEqual(entryP1.periodNumber, 1);
  console.log('   PASS: Period 1 diary entry created successfully.');

  // 2. Test Invariant 3: Period 2 for same section/subject/date
  console.log('2. Creating Period 2 diary entry (Double Period) on same day...');
  const entryP2 = await classDiaryService.recordDiaryEntry({
    collegeId: college.id,
    sectionId,
    subjectId,
    teacherId,
    entryDate,
    periodNumber: 2,
    topicCovered: 'Quadratic Equations Advanced Word Problems',
    homework: 'Exercise 2.1, Q 6-10',
    remarks: 'Double lab session completed',
    attachments: [
      {
        fileName: 'worksheet_part2.pdf',
        fileUrl: 'https://r2.test/worksheet_part2.pdf',
        storageBytes: 1048576n
      }
    ]
  });
  assert.ok(entryP2.id, 'Period 2 entry created');
  assert.notStrictEqual(entryP1.id, entryP2.id, 'Period 1 and Period 2 are distinct rows');
  assert.strictEqual(entryP2.attachments.length, 1, 'Attachment saved with entry');
  console.log('   PASS: Invariant 3 verified: compound unique index allows multiple periods per day.');

  // 3. Test Updating Period 1 in place
  console.log('3. Updating Period 1 diary entry...');
  const updatedP1 = await classDiaryService.recordDiaryEntry({
    collegeId: college.id,
    sectionId,
    subjectId,
    teacherId,
    entryDate,
    periodNumber: 1,
    topicCovered: 'Quadratic Equations Introduction & Formulas',
    homework: 'Exercise 2.1, Q 1-8'
  });
  assert.strictEqual(updatedP1.id, entryP1.id, 'Same row updated');
  assert.strictEqual(updatedP1.topicCovered, 'Quadratic Equations Introduction & Formulas');
  console.log('   PASS: Diary entry updated in place cleanly.');

  // 4. Test Academic Calendar & Working Days Calculation
  console.log('4. Testing Academic Calendar & Working Days Calculation...');
  // Create a 2-day holiday event: 2026-11-12 to 2026-11-13
  const holiday = await prisma.academicCalendarEvent.create({
    data: {
      college_id: college.id,
      session_id: session.id,
      title: 'Iqbal Day Holiday',
      eventType: 'HOLIDAY',
      startDate: new Date('2026-11-12'),
      endDate: new Date('2026-11-13'),
      isWorkingDay: false
    }
  });

  // Calculate working days for 1 week: Monday 2026-11-09 to Sunday 2026-11-15 (7 calendar days)
  // Mon 9, Tue 10, Wed 11 = 3 working days
  // Thu 12, Fri 13 = 2 holiday days
  // Sat 14 = 1 working day (Sat is working in 6-day week)
  // Sun 15 = 1 weekend off day
  // Total working days should be 4!
  const calc = await workingDaysService.calculateWorkingDays({
    collegeId: college.id,
    sessionId: session.id,
    startDate: '2026-11-09',
    endDate: '2026-11-15'
  });

  assert.strictEqual(calc.totalCalendarDays, 7, '7 calendar days');
  assert.strictEqual(calc.holidayDaysCount, 2, '2 holiday days accounted for');
  assert.strictEqual(calc.offDaysCount, 1, '1 Sunday off-day');
  assert.strictEqual(calc.workingDaysCount, 4, '4 effective instruction working days');
  console.log('   PASS: Working days calculation accurately accounted for calendar holidays and weekends.');

  // Clean up test records
  await prisma.classDiaryAttachment.deleteMany({ where: { diary_entry_id: { in: [entryP1.id, entryP2.id] } } });
  await prisma.classDiaryEntry.deleteMany({ where: { id: { in: [entryP1.id, entryP2.id] } } });
  await prisma.academicCalendarEvent.delete({ where: { id: holiday.id } });

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8B TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');

  await prisma.$disconnect();
}

testPhase8B().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

