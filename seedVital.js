require('dotenv').config();
const connectDB = require('./config/db');

// Call connectDB synchronously to register global Mongoose overrides immediately
connectDB();

const mongoose = require('mongoose');
const College = require('./models/College');
const User = require('./models/User');
const { getTenantConnection } = require('./config/connectionManager');

const PWD = 'abc123';

async function seed() {
  console.log('🔗 Connected to System via PostgreSQL Adapter');

  // ── 1. College ──
  // Check if a college with code VGC already exists
  let college = await College.findOne({ code: 'VGC' });
  
  if (college) {
    console.log('⚠ Vital Group of Colleges (VGC) exists. Deleting old data...');
    try {
      const tenantConn = await getTenantConnection(college._id);
      await cleanOld(college._id, tenantConn);
    } catch (err) {
      console.log('⚠ Could not establish tenant connection for cleanup:', err.message);
    }
    await college.deleteOne();
  }

  // Create college with details provided by the user
  college = await College.create({
    name: 'Vital Group of Colleges',
    code: 'VGC',
    slug: 'vgc',
    mongoUrl: 'mongodb://localhost:27017/academix_vgc',
    email: 'vital@gmail.com',
    phone: '03134567890',
    address: 'wazirabad main city',
    city: 'wazirabad',
    logo: '',
    website: '',
    subscription: {
      plan: 'premium',
      status: 'active',
      startedAt: new Date('2026-05-18T20:01:21.717Z'),
      expiresAt: new Date('2026-12-17T00:00:00.000Z'),
      features: ['ai_chat', 'ai_generators', 'pdf_library', 'certificates', 'visitors']
    },
    settings: {
      feeStructure: {
        tuitionFee: 8000,
        functionFee: 2000,
        labFee: 1500
      },
      academicYear: '2026',
      classes: ['FSC Part 1', 'FSC Part 2'],
      sections: ['A', 'B', 'C']
    },
    totalStudents: 100,
    totalStaff: 11,
    isActive: true
  });
  
  const CID = college._id;
  console.log('✅ College "Vital Group of Colleges" created in System DB. ID:', CID);

  // Connect to the tenant database
  console.log('🔗 Connecting to Tenant Database:', college.mongoUrl);
  const tenantConn = await getTenantConnection(CID);
  console.log('✅ Tenant DB connection established and models registered.');

  // Compile tenant-specific models
  const Session = tenantConn.model('Session');
  const Class = tenantConn.model('Class');
  const Section = tenantConn.model('Section');
  const Subject = tenantConn.model('Subject');
  const Student = tenantConn.model('Student');
  const Teacher = tenantConn.model('Teacher');
  const Employee = tenantConn.model('Employee');
  const Fee = tenantConn.model('Fee');
  const Attendance = tenantConn.model('Attendance');
  const Announcement = tenantConn.model('Announcement');
  const Exam = tenantConn.model('Exam');
  const Assignment = tenantConn.model('Assignment');
  const VisitorLog = tenantConn.model('VisitorLog');
  const Timetable = tenantConn.model('Timetable');

  // Clear any residual data in the tenant DB
  await cleanOld(CID, tenantConn);
  console.log('✅ Tenant DB cleared.');

  // ── 2. Staff Users (System DB) ──
  const users = {};
  const userList = [
    { name: 'Admin Vital', email: 'admin@vital.com', role: 'admin' },
    { name: 'Sarah Registrar', email: 'registrar@vital.com', role: 'registrar' },
    { name: 'Ali Accountant', email: 'accountant@vital.com', role: 'accountant' },
    { name: 'Dr. Khalid Principal', email: 'principal@vital.com', role: 'principal' },
    { name: 'Prof. Ahmed Physics', email: 'teacher1@vital.com', role: 'teacher' },
    { name: 'Prof. Fatima Chemistry', email: 'teacher2@vital.com', role: 'teacher' },
    { name: 'Prof. Hassan Math', email: 'teacher3@vital.com', role: 'teacher' },
    { name: 'Prof. Zainab English', email: 'teacher4@vital.com', role: 'teacher' },
    { name: 'Prof. Usman CS', email: 'teacher5@vital.com', role: 'teacher' },
    { name: 'Guard Rashid', email: 'employee1@vital.com', role: 'employee' },
    { name: 'Canteen Wali', email: 'employee2@vital.com', role: 'employee' },
  ];

  for (const u of userList) {
    const existing = await User.findOne({ email: u.email });
    if (existing) await existing.deleteOne();
    const doc = await User.create({
      ...u,
      password: PWD,
      college_id: CID,
      phone: '03' + Math.floor(100000000 + Math.random() * 900000000)
    });
    users[u.email] = doc;
  }

  // Student Users (System DB) - Create 100 students
  for (let i = 1; i <= 100; i++) {
    const email = `student${i}@vital.com`;
    const existing = await User.findOne({ email });
    if (existing) await existing.deleteOne();
    users[email] = await User.create({
      name: `Student ${i}`,
      email,
      password: PWD,
      role: 'student',
      college_id: CID
    });
  }
  console.log('✅ Users created in System DB (11 staff + 100 students)');

  // ── 3. Session ──
  const session = await Session.create({
    college_id: CID,
    name: '2026-2027',
    startDate: new Date('2026-04-01'),
    endDate: new Date('2027-03-31'),
    isCurrent: true,
    status: 'active',
    createdBy: users['admin@vital.com']._id
  });
  console.log('✅ Session created in Tenant DB');

  // ── 4. Classes ──
  const class1 = await Class.create({ college_id: CID, session_id: session._id, name: 'FSC Part 1', groups: ['Pre-Medical', 'Pre-Engineering', 'Computer Science'] });
  const class2 = await Class.create({ college_id: CID, session_id: session._id, name: 'FSC Part 2', groups: ['Pre-Medical', 'Pre-Engineering', 'Computer Science'] });
  console.log('✅ Classes created in Tenant DB');

  // ── 5. Sections ──
  const sections = {};
  const sectionCodes = ['A', 'B', 'C'];
  for (const cls of [class1, class2]) {
    for (const code of sectionCodes) {
      const sec = await Section.create({
        college_id: CID,
        session_id: session._id,
        class_id: cls._id,
        code,
        name: `Section ${code}`,
        capacity: 40
      });
      sections[`${cls.name}-${code}`] = sec;
    }
  }
  console.log('✅ Sections created in Tenant DB');

  // ── 6. Subjects (Strictly 8 Subjects) ──
  const subjectData = [
    { name: 'Physics', code: 'PHY', group: 'Common', class: 'Both', totalMarks: 100 },
    { name: 'Chemistry', code: 'CHE', group: 'Common', class: 'Both', totalMarks: 100 },
    { name: 'Mathematics', code: 'MTH', group: 'Pre-Engineering', class: 'Both', totalMarks: 100 },
    { name: 'Biology', code: 'BIO', group: 'Pre-Medical', class: 'Both', totalMarks: 100 },
    { name: 'English', code: 'ENG', group: 'Common', class: 'Both', totalMarks: 100 },
    { name: 'Urdu', code: 'URD', group: 'Common', class: 'Both', totalMarks: 75 },
    { name: 'Islamiat', code: 'ISL', group: 'Common', class: 'FSC Part 1', totalMarks: 50 },
    { name: 'Computer Science', code: 'CSC', group: 'Computer Science', class: 'Both', totalMarks: 100 },
  ];
  
  const subjects = {};
  for (const s of subjectData) {
    subjects[s.code] = await Subject.create({ ...s, college_id: CID });
  }
  console.log('✅ 8 Subjects created in Tenant DB');

  // ── 7. Teachers ──
  const teacherMap = [
    { email: 'teacher1@vital.com', code: 'T001', qual: 'M.Phil Physics', spec: 'Quantum Mechanics', subj: ['PHY'], salary: 65000 },
    { email: 'teacher2@vital.com', code: 'T002', qual: 'M.Phil Chemistry', spec: 'Organic Chemistry', subj: ['CHE'], salary: 60000 },
    { email: 'teacher3@vital.com', code: 'T003', qual: 'MS Mathematics', spec: 'Calculus', subj: ['MTH'], salary: 55000 },
    { email: 'teacher4@vital.com', code: 'T004', qual: 'MA English', spec: 'Literature', subj: ['ENG', 'URD', 'ISL'], salary: 50000 },
    { email: 'teacher5@vital.com', code: 'T005', qual: 'MS Computer Science', spec: 'AI & ML', subj: ['CSC'], salary: 70000 },
  ];
  const teachers = {};
  for (const t of teacherMap) {
    teachers[t.email] = await Teacher.create({
      college_id: CID,
      user_id: users[t.email]._id,
      employeeCode: t.code,
      phone: '03001234567',
      qualification: t.qual,
      specialization: t.spec,
      subjects: t.subj.map(c => subjects[c]._id),
      assignedClasses: [
        { class_id: class1._id, section_id: sections['FSC Part 1-A']._id },
        { class_id: class1._id, section_id: sections['FSC Part 1-B']._id },
        { class_id: class1._id, section_id: sections['FSC Part 1-C']._id },
        { class_id: class2._id, section_id: sections['FSC Part 2-A']._id },
        { class_id: class2._id, section_id: sections['FSC Part 2-B']._id },
        { class_id: class2._id, section_id: sections['FSC Part 2-C']._id }
      ],
      salary: t.salary
    });
  }
  console.log('✅ Teachers created in Tenant DB');

  // ── 8. Employees ──
  await Employee.create({ college_id: CID, user_id: users['employee1@vital.com']._id, employeeCode: 'E001', department: 'security', designation: 'Security Guard', salary: 25000 });
  await Employee.create({ college_id: CID, user_id: users['employee2@vital.com']._id, employeeCode: 'E002', department: 'canteen', designation: 'Canteen Manager', salary: 30000 });
  console.log('✅ Employees created in Tenant DB');

  // ── 9. 100 Students (50 in FSC Part 1, 50 in FSC Part 2) ──
  const studentDocs = [];
  const groups = ['Pre-Medical', 'Pre-Engineering', 'Computer Science'];
  
  for (let i = 1; i <= 100; i++) {
    // 50 in FSC Part 1 (1-50), 50 in FSC Part 2 (51-100)
    const cls = i <= 50 ? 'FSC Part 1' : 'FSC Part 2';
    
    // Distribute group evenly
    const grp = groups[(i - 1) % 3];
    
    // Distribute sections evenly: A, B, C
    const sec = sectionCodes[(i - 1) % 3];
    
    const student = await Student.create({
      college_id: CID,
      session_id: session._id,
      user_id: users[`student${i}@vital.com`]._id,
      name: `Student ${i}`,
      fatherName: `Father of Student ${i}`,
      rollNumber: `VGC-${String(i).padStart(3, '0')}`,
      registrationNumber: `REG-2026-${i}`,
      gender: i % 3 === 0 ? 'female' : 'male',
      phone: `030${i}1234567`,
      email: `student${i}@vital.com`,
      address: `House ${i}, Street ${i}, Wazirabad`,
      class: cls,
      group: grp,
      section: sec,
      guardianName: `Guardian ${i}`,
      guardianPhone: `031${i}7654321`,
      guardianRelation: 'Father',
      subjects: Object.values(subjects).filter(s => s.group === grp || s.group === 'Common').map(s => s._id),
    });
    studentDocs.push(student);
  }
  console.log('✅ 100 Students created in Tenant DB (50 in Part 1, 50 in Part 2)');

  // ── 10. Fees (Billing for 50 random students) ──
  for (const st of studentDocs.slice(0, 50)) {
    const paid = Math.random() > 0.3;
    await Fee.create({
      college_id: CID,
      session_id: session._id,
      student_id: st._id,
      month: '2026-05',
      tuitionFee: 8000,
      functionFee: 2000,
      labFee: 1500,
      totalAmount: 11500,
      paidAmount: paid ? 11500 : Math.floor(Math.random() * 5000),
      status: paid ? 'paid' : 'partial',
      paidDate: paid ? new Date() : null,
      receiptNumber: paid ? `REC-${Date.now()}-${st.rollNumber}` : null,
      enteredBy: users['accountant@vital.com']._id
    });
  }
  console.log('✅ Fee Billing generated in Tenant DB');

  // ── 11. Attendance (Last 3 days for 100 students) ──
  const statuses = ['present', 'present', 'present', 'present', 'absent', 'late', 'leave'];
  for (let d = 0; d < 3; d++) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    date.setHours(0, 0, 0, 0);
    for (const st of studentDocs) {
      await Attendance.create({
        college_id: CID,
        session_id: session._id,
        student_id: st._id,
        class: st.class,
        section: st.section,
        date,
        status: statuses[Math.floor(Math.random() * statuses.length)],
        method: 'manual',
        markedBy: users['teacher1@vital.com']._id
      });
    }
  }
  console.log('✅ 3 days of Attendance logs generated in Tenant DB');

  // ── 12. Announcements ──
  const annData = [
    { title: 'Mid-Term Exams Schedule', content: 'Mid-term exams will start from June 15, 2026. Datesheet will be shared soon.', category: 'exam', priority: 'high' },
    { title: 'Fee Deadline Extended', content: 'Last date for fee submission extended to May 25, 2026. Late fine of Rs. 500.', category: 'fee', priority: 'urgent' },
    { title: 'Science Fair 2026', content: 'Annual Science Fair on July 1. All students prepare projects.', category: 'event', priority: 'medium' },
    { title: 'Library New Books', content: '200 new books added to the library. Visit during break.', category: 'general', priority: 'low' },
    { title: 'Sports Week', content: 'Annual Sports Week from June 1-5. Register with your class teacher.', category: 'event', priority: 'medium' },
  ];
  for (const a of annData) {
    await Announcement.create({ ...a, college_id: CID, audience: 'all', createdBy: users['admin@vital.com']._id });
  }
  console.log('✅ Announcements created in Tenant DB');

  // ── 13. Exams ──
  await Exam.create({
    college_id: CID,
    session_id: session._id,
    name: 'Mid-Term 2026',
    type: 'mid',
    class: 'FSC Part 1',
    group: 'all',
    section: 'all',
    subjects: [
      { subject_id: subjects['PHY']._id, name: 'Physics', date: new Date('2026-06-15'), startTime: '09:00', endTime: '12:00', totalMarks: 100, passingMarks: 33 },
      { subject_id: subjects['CHE']._id, name: 'Chemistry', date: new Date('2026-06-17'), startTime: '09:00', endTime: '12:00', totalMarks: 100, passingMarks: 33 },
      { subject_id: subjects['ENG']._id, name: 'English', date: new Date('2026-06-19'), startTime: '09:00', endTime: '12:00', totalMarks: 100, passingMarks: 33 },
    ],
    status: 'scheduled',
    createdBy: users['admin@vital.com']._id
  });
  console.log('✅ Exams created in Tenant DB');

  // ── 14. Assignments ──
  await Assignment.create({
    college_id: CID,
    session_id: session._id,
    class_id: class1._id,
    section_id: sections['FSC Part 1-A']._id,
    subject_id: subjects['PHY']._id,
    teacher_id: users['teacher1@vital.com']._id,
    title: 'Newton\'s Laws of Motion',
    description: 'Solve all numerical problems from Ch-3.',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    totalMarks: 20,
    status: 'active'
  });
  console.log('✅ Assignments created in Tenant DB');

  // ── 15. Visitors ──
  await VisitorLog.create({ college_id: CID, visitorName: 'Muhammad Imran', cnic: '35202-1234567-1', phone: '0312-1234567', purpose: 'Parent Meeting', hostName: 'Prof. Ahmed', hostDepartment: 'Physics', enteredBy: users['employee1@vital.com']._id });
  console.log('✅ Visitors created in Tenant DB');

  // ── 16. Timetables (Monday-Friday for ALL 6 Sections) ──
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const classesArray = [class1, class2];
  
  for (const cls of classesArray) {
    for (const code of sectionCodes) {
      const secName = `${cls.name}-${code}`;
      const secDoc = sections[secName];
      
      for (const day of weekdays) {
        // Create full daily timetable for this specific section
        await Timetable.create({
          college_id: CID,
          session_id: session._id,
          class: cls.name,
          section: code,
          day,
          isActive: true,
          createdBy: users['admin@vital.com']._id,
          periods: [
            { periodNumber: 1, startTime: '08:00', endTime: '08:45', subject_id: subjects['PHY']._id, teacher_id: users['teacher1@vital.com']._id, subjectName: 'Physics', teacherName: 'Prof. Ahmed Physics' },
            { periodNumber: 2, startTime: '08:45', endTime: '09:30', subject_id: subjects['CHE']._id, teacher_id: users['teacher2@vital.com']._id, subjectName: 'Chemistry', teacherName: 'Prof. Fatima Chemistry' },
            { periodNumber: 3, startTime: '09:30', endTime: '10:00', isBreak: true, label: 'Morning Break' },
            { periodNumber: 4, startTime: '10:00', endTime: '10:45', subject_id: subjects['MTH']._id, teacher_id: users['teacher3@vital.com']._id, subjectName: 'Mathematics', teacherName: 'Prof. Hassan Math' },
            { periodNumber: 5, startTime: '10:45', endTime: '11:30', subject_id: subjects['ENG']._id, teacher_id: users['teacher4@vital.com']._id, subjectName: 'English', teacherName: 'Prof. Zainab English' },
            { periodNumber: 6, startTime: '11:30', endTime: '12:00', isBreak: true, label: 'Lunch Break' },
            { periodNumber: 7, startTime: '12:00', endTime: '12:45', subject_id: subjects['CSC']._id, teacher_id: users['teacher5@vital.com']._id, subjectName: 'Computer Science', teacherName: 'Prof. Usman CS' },
          ]
        });
      }
    }
  }
  console.log('✅ Timetables created in Tenant DB for all sections (A, B, C) of both FSC Part 1 & FSC Part 2 (Monday to Friday)');

  // Update college counts in System DB
  await College.findByIdAndUpdate(CID, { totalStudents: 100, totalStaff: 11 });

  console.log('\n🎉 SEEDING COMPLETE FOR VITAL GROUP OF COLLEGES (VGC)!\n');
  console.log('═══════════════════════════════════════════');
  console.log('           LOGIN CREDENTIALS');
  console.log('═══════════════════════════════════════════');
  console.log('  Password for ALL accounts: abc123');
  console.log('───────────────────────────────────────────');
  console.log('  ADMIN:      admin@vital.com');
  console.log('  REGISTRAR:  registrar@vital.com');
  console.log('  ACCOUNTANT: accountant@vital.com');
  console.log('  PRINCIPAL:  principal@vital.com');
  console.log('  TEACHERS:   teacher1@vital.com → teacher5@vital.com');
  console.log('  EMPLOYEES:  employee1@vital.com, employee2@vital.com');
  console.log('  STUDENTS:   student1@vital.com → student100@vital.com');
  console.log('═══════════════════════════════════════════\n');

  await mongoose.disconnect();
}

async function cleanOld(collegeId, tenantConn) {
  const modelNames = ['Session', 'Class', 'Section', 'Subject', 'Student', 'Teacher', 'Employee', 'Fee', 'Attendance', 'Announcement', 'Exam', 'Assignment', 'VisitorLog', 'Timetable'];
  for (const name of modelNames) {
    try {
      const M = tenantConn.model(name);
      await M.deleteMany({ college_id: collegeId });
    } catch (err) {
      console.log(`⚠ Failed to clear model ${name}:`, err.message);
    }
  }
  await User.deleteMany({ college_id: collegeId });
}

seed().catch(e => {
  console.error('❌ Seed error:', e.stack || e.message);
  process.exit(1);
});
