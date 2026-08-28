const mongoose = require('mongoose');
require('dotenv').config();

async function seedTimetable() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const Subject = require('./models/Subject.js');
  const Timetable = require('./models/Timetable');
  const Session = require('./models/Session');

  const collegeId = new mongoose.Types.ObjectId('6a022af7003e6915bb4c9a83');
  
  // Teachers
  const teachers = {
    physics:   { id: '6a022afa003e6915bb4c9a92', name: 'Prof. Ahmed Physics' },
    chemistry: { id: '6a022afb003e6915bb4c9a95', name: 'Prof. Fatima Chemistry' },
    math:      { id: '6a022afc003e6915bb4c9a98', name: 'Prof. Hassan Math' },
    english:   { id: '6a022afd003e6915bb4c9a9b', name: 'Prof. Zainab English' },
    cs:        { id: '6a022afd003e6915bb4c9a9e', name: 'Prof. Usman CS' },
  };

  // Get current session
  const session = await Session.findOne({ college_id: collegeId, isCurrent: true });
  
  // ═══ Create Subjects for FSC Part 1 Computer Science ═══
  const subjectDefs = [
    { name: 'Computer Science', code: 'CS-101', group: 'Computer Science', class: 'FSC Part 1', totalMarks: 100, teacher: teachers.cs },
    { name: 'Mathematics', code: 'MATH-101', group: 'Computer Science', class: 'FSC Part 1', totalMarks: 100, teacher: teachers.math },
    { name: 'Physics', code: 'PHY-101', group: 'Computer Science', class: 'FSC Part 1', totalMarks: 100, teacher: teachers.physics },
    { name: 'English', code: 'ENG-101', group: 'Computer Science', class: 'FSC Part 1', totalMarks: 100, teacher: teachers.english },
    { name: 'Urdu', code: 'URDU-101', group: 'Common', class: 'FSC Part 1', totalMarks: 100, teacher: teachers.english },
    { name: 'Islamiat', code: 'ISL-101', group: 'Common', class: 'FSC Part 1', totalMarks: 50, teacher: teachers.english },
    { name: 'Pak Studies', code: 'PAK-101', group: 'Common', class: 'FSC Part 1', totalMarks: 50, teacher: teachers.chemistry },
    { name: 'Statistics', code: 'STAT-101', group: 'Computer Science', class: 'FSC Part 1', totalMarks: 100, teacher: teachers.math },
  ];

  const subjectIds = {};
  for (const s of subjectDefs) {
    const existing = await Subject.findOne({ college_id: collegeId, code: s.code });
    if (existing) {
      existing.teacher_id = new mongoose.Types.ObjectId(s.teacher.id);
      await existing.save();
      subjectIds[s.name] = existing._id;
      console.log('Updated:', s.name);
    } else {
      const sub = await Subject.create({
        college_id: collegeId, name: s.name, code: s.code,
        group: s.group, class: s.class, totalMarks: s.totalMarks,
        teacher_id: new mongoose.Types.ObjectId(s.teacher.id)
      });
      subjectIds[s.name] = sub._id;
      console.log('Created:', s.name);
    }
  }

  // ═══ Full Week Timetable ═══
  // 8 periods/day: 08:00-08:45, 08:50-09:35, 09:40-10:25, BREAK 10:25-10:45, 
  // 10:45-11:30, 11:35-12:20, 12:25-01:10, LUNCH 01:10-01:40, 01:40-02:25

  const timeSlots = [
    { n: 1, s: '08:00', e: '08:45' },
    { n: 2, s: '08:50', e: '09:35' },
    { n: 3, s: '09:40', e: '10:25' },
    { n: 4, s: '10:25', e: '10:45', isBreak: true, label: 'Morning Break ☕' },
    { n: 5, s: '10:45', e: '11:30' },
    { n: 6, s: '11:35', e: '12:20' },
    { n: 7, s: '12:25', e: '13:10' },
    { n: 8, s: '13:10', e: '13:40', isBreak: true, label: 'Lunch Break 🍽️' },
    { n: 9, s: '13:40', e: '14:25' },
  ];

  // Subject schedule per day (period numbers that are NOT breaks: 1,2,3,5,6,7,9)
  const weekSchedule = {
    Monday:    ['Computer Science', 'Mathematics', 'Physics', null, 'English', 'Statistics', 'Urdu', null, 'Islamiat'],
    Tuesday:   ['Mathematics', 'Physics', 'Computer Science', null, 'Statistics', 'English', 'Islamiat', null, 'Computer Science'],
    Wednesday: ['Physics', 'Computer Science', 'Mathematics', null, 'Urdu', 'Computer Science', 'English', null, 'Statistics'],
    Thursday:  ['English', 'Mathematics', 'Statistics', null, 'Computer Science', 'Physics', 'Pak Studies', null, 'Mathematics'],
    Friday:    ['Computer Science', 'Physics', 'English', null, 'Mathematics', 'Urdu', 'Computer Science', null, 'Pak Studies'],
    Saturday:  ['Statistics', 'Computer Science', 'Physics', null, 'Mathematics', 'Islamiat', 'English', null, 'Urdu'],
  };

  // Helper to get teacher for subject
  const getTeacher = (subName) => {
    const def = subjectDefs.find(s => s.name === subName);
    return def ? def.teacher : null;
  };

  // Clear existing timetable for this class
  await Timetable.deleteMany({ college_id: collegeId, class: 'FSC Part 1', section: 'A' });

  for (const [day, subjects] of Object.entries(weekSchedule)) {
    const periods = timeSlots.map((slot, idx) => {
      if (slot.isBreak) {
        return { periodNumber: slot.n, startTime: slot.s, endTime: slot.e, isBreak: true, label: slot.label };
      }
      const subName = subjects[idx];
      if (!subName) return null;
      const teacher = getTeacher(subName);
      return {
        periodNumber: slot.n, startTime: slot.s, endTime: slot.e,
        subject_id: subjectIds[subName],
        teacher_id: teacher ? new mongoose.Types.ObjectId(teacher.id) : undefined,
        subjectName: subName,
        teacherName: teacher?.name || '',
        isBreak: false
      };
    }).filter(Boolean);

    await Timetable.create({
      college_id: collegeId, session_id: session?._id,
      class: 'FSC Part 1', section: 'A', group: 'Computer Science',
      day, periods, isActive: true
    });
    console.log(`✅ ${day}: ${periods.filter(p => !p.isBreak).length} periods seeded`);
  }

  console.log('\n🎓 Timetable seeded successfully for FSC Part 1 - Section A - Computer Science');
  process.exit(0);
}

seedTimetable().catch(e => { console.error(e); process.exit(1); });
