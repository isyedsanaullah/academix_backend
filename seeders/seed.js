/**
 * Academix Database Seeder
 * Usage:  node seeders/seed.js            → seeds everything
 *         node seeders/seed.js --clear    → clears then seeds
 *         node seeders/seed.js --wipe     → clears only (no re-seed)
 */
require('dotenv').config();

const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const data = require('./seedData');

const args  = process.argv.slice(2);
const CLEAR = args.includes('--clear') || args.includes('--wipe');
const WIPE  = args.includes('--wipe');

async function clearDB(prisma) {
  console.log('🗑  Clearing all tables sequentially...');
  const models = [
    'admissionSeason', 'aIApiKey', 'aIUsageLog', 'announcement', 'application', 
    'approval', 'assignment', 'attendance', 'auditLog', 'canteenTransaction', 
    'certificate', 'chatHistory', 'class', 'college', 'earlyExitRequest', 
    'employee', 'evaluationSeason', 'evaluation', 'exam', 'fee', 
    'fine', 'gateLog', 'leaveApplication', 'notification', 'payment', 
    'paySlip', 'pDFDocument', 'quiz', 'result', 'section', 
    'session', 'student', 'studentFee', 'subject', 'subscription', 
    'teacher', 'timetable', 'transaction', 'user', 'visitorLog', 'documentChunk'
  ];

  for (const modelName of models) {
    try {
      await prisma[modelName].deleteMany({});
    } catch (err) {
      console.warn(`⚠️  Failed to clear model ${modelName}:`, err.message);
    }
  }
  console.log('✅  All tables cleared.');
}

async function seed(prisma) {
  try {
    console.log('\n📦  Inserting seed data...\n');

    // 1. Subscription Plans
    const plans = [
      {
        planId: 'basic',
        name: 'Basic Plan',
        description: 'Essential college management features for small institutions',
        features: [
          'students', 'teachers', 'subjects', 'attendance',
          'timetable', 'notices', 'exams', 'results',
          'classes', 'sections', 'sessions', 'announcements',
          'assignments', 'quizzes', 'certificates'
        ],
        restrictions: [
          'No AI features',
          'No biometric/entry system',
          'No fee management',
          'Teacher attendance only'
        ],
        limits: { maxStudents: 500, maxStaff: 50, maxStorage: 1024 },
        price: { monthly: 0, yearly: 0, currency: 'PKR' },
        isAI: false
      },
      {
        planId: 'standard',
        name: 'Standard Plan',
        description: 'Advanced management with fee tracking, analytics, and entry system',
        features: [
          'students', 'teachers', 'subjects', 'attendance',
          'timetable', 'notices', 'exams', 'results',
          'classes', 'sections', 'sessions', 'announcements',
          'assignments', 'quizzes', 'certificates',
          'entry-system', 'fees', 'analytics', 'reports',
          'employees', 'visitors', 'canteen', 'advanced'
        ],
        restrictions: [
          'No AI implementation'
        ],
        limits: { maxStudents: 2000, maxStaff: 200, maxStorage: 5120 },
        price: { monthly: 5000, yearly: 50000, currency: 'PKR' },
        isAI: false
      },
      {
        planId: 'premium',
        name: 'Premium AI Plan',
        description: 'Full-featured platform with AI-powered tools for modern education',
        features: [
          'students', 'teachers', 'subjects', 'attendance',
          'timetable', 'notices', 'exams', 'results',
          'classes', 'sections', 'sessions', 'announcements',
          'assignments', 'quizzes', 'certificates',
          'entry-system', 'fees', 'analytics', 'reports',
          'employees', 'visitors', 'canteen', 'advanced',
          'ai-chat', 'ai-pdf-chat', 'ai-study-assistant',
          'ai-paper-generator', 'ai-quiz-generator',
          'ai-assignment-generator', 'ai-notes-generator',
          'ai-syllabus-generator', 'ai-mcq-generator'
        ],
        restrictions: [],
        limits: { maxStudents: -1, maxStaff: -1, maxStorage: 20480 },
        price: { monthly: 15000, yearly: 150000, currency: 'PKR' },
        isAI: true
      }
    ];

    for (const plan of plans) {
      await prisma.subscription.create({ data: plan });
    }
    console.log(`   ✔  Subscription Plans → ${plans.length}`);

    // 2. Colleges
    const collegesMapped = data.colleges.map(c => ({
      id: c._id,
      name: c.name,
      code: c.code,
      mongoUrl: c.mongoUrl,
      email: c.email,
      phone: c.phone,
      address: c.address,
      city: c.city,
      logo: c.logo,
      website: c.website,
      subscription: c.subscription,
      settings: c.settings || {},
      createdAt: c.createdAt,
    }));
    for (const c of collegesMapped) {
      await prisma.college.create({ data: c });
    }
    console.log(`   ✔  Colleges      → ${collegesMapped.length}`);

    // 3. Users
    const usersMapped = data.users.map(u => ({
      id: u._id,
      name: u.name,
      email: u.email,
      password: u.password,
      role: u.role,
      college_id: u.college_id,
      isActive: u.isActive,
    }));
    for (const u of usersMapped) {
      await prisma.user.create({ data: u });
    }
    console.log(`   ✔  Users         → ${usersMapped.length}`);

    // 4. Sessions
    const sessionsMapped = data.sessions.map(s => ({
      id: s._id,
      college_id: s.college_id,
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      isCurrent: s.isCurrent,
      status: s.status,
      createdBy: s.createdBy,
    }));
    for (const s of sessionsMapped) {
      await prisma.session.create({ data: s });
    }
    console.log(`   ✔  Sessions      → ${sessionsMapped.length}`);

    // 5. Classes & Sections
    const classesMapped = data.classes.map(c => ({
      id: c._id,
      college_id: c.college_id,
      session_id: c.session_id,
      name: c.name,
      groups: c.groups,
      isActive: c.isActive,
    }));
    for (const c of classesMapped) {
      await prisma.class.create({ data: c });
    }
    console.log(`   ✔  Classes       → ${classesMapped.length}`);

    const sectionsMapped = data.sections.map(sec => ({
      id: sec._id,
      college_id: sec.college_id,
      session_id: sec.session_id,
      class_id: sec.class_id,
      code: sec.code,
      name: sec.name,
      capacity: sec.capacity,
      isActive: sec.isActive,
    }));
    for (const sec of sectionsMapped) {
      await prisma.section.create({ data: sec });
    }
    console.log(`   ✔  Sections      → ${sectionsMapped.length}`);

    // 6. Subjects
    const subjectsMapped = data.subjects.map(sub => ({
      id: sub._id,
      college_id: sub.college_id,
      name: sub.name,
      code: sub.code,
      group: sub.group,
      class: sub.class,
      totalMarks: sub.totalMarks,
      passingMarks: sub.passingMarks,
      isActive: sub.isActive,
    }));
    for (const sub of subjectsMapped) {
      await prisma.subject.create({ data: sub });
    }
    console.log(`   ✔  Subjects      → ${subjectsMapped.length}`);

    // 7. Teachers & Employees
    const teachersMapped = data.teachers.map(t => ({
      id: t._id,
      college_id: t.college_id,
      user_id: t.user_id,
      qualification: t.qualification,
      specialization: t.specialization,
      salary: t.salary,
      status: t.status,
      joiningDate: t.joiningDate,
      subjects: t.subjects,
    }));
    for (const t of teachersMapped) {
      await prisma.teacher.create({ data: t });
    }
    console.log(`   ✔  Teachers      → ${teachersMapped.length}`);

    const employeesMapped = data.employees.map(emp => ({
      college_id: emp.college_id,
      user_id: emp.user_id,
      department: emp.department,
      designation: emp.designation,
      salary: emp.salary,
      status: emp.status,
      joiningDate: emp.joiningDate,
    }));
    for (const emp of employeesMapped) {
      await prisma.employee.create({ data: emp });
    }
    console.log(`   ✔  Employees     → ${employeesMapped.length}`);

    // Helpers maps for student mapping
    const secMap = {};
    data.sections.forEach(sec => {
      secMap[sec._id] = sec.code;
    });

    const classMap = {};
    data.classes.forEach(c => {
      classMap[c._id] = c.name;
    });

    // 8. Students
    const studentsMapped = data.students.map(s => ({
      id: s._id,
      college_id: s.college_id,
      session_id: s.session_id,
      name: s.name,
      fatherName: s.fatherName,
      gender: s.gender,
      rollNumber: s.rollNumber,
      registrationNumber: s.registrationNumber,
      cnic: s.cnic,
      dateOfBirth: s.dateOfBirth,
      phone: s.phone,
      email: s.email,
      address: s.address,
      class: s.class,
      group: s.group,
      section: secMap[s.section_id] || 'A',
      guardianName: s.guardianName,
      guardianPhone: s.guardianPhone,
      guardianRelation: s.guardianRelation,
      status: s.status,
      admissionDate: s.admissionDate,
    }));
    for (const s of studentsMapped) {
      await prisma.student.create({ data: s });
    }
    console.log(`   ✔  Students      → ${studentsMapped.length}`);

    // 9. Fees
    const feesMapped = data.fees.map(f => {
      let pDate = f.paidDate;
      if (pDate && isNaN(pDate.getTime())) {
        pDate = new Date('2026-01-05');
      }
      return {
        college_id: f.college_id,
        session_id: f.session_id,
        student_id: f.student_id,
        month: f.month,
        tuitionFee: f.tuitionFee,
        functionFee: f.functionFee,
        labFee: f.labFee,
        fine: f.fine,
        scholarshipDeduction: f.scholarshipDeduction,
        totalAmount: f.totalAmount,
        paidAmount: f.paidAmount,
        status: f.status,
        paidDate: pDate,
        receiptNumber: f.receiptNumber,
        enteredBy: f.enteredBy,
      };
    });
    for (const f of feesMapped) {
      await prisma.fee.create({ data: f });
    }
    console.log(`   ✔  Fee Records   → ${feesMapped.length}`);

    // 10. Exams
    const examsMapped = data.exams.map(e => ({
      id: e._id,
      college_id: e.college_id,
      session_id: e.session_id,
      name: e.name,
      type: e.type,
      class: e.class,
      group: e.group,
      section: e.section,
      subjects: e.subjects,
      status: e.status,
      createdBy: e.createdBy,
    }));
    for (const e of examsMapped) {
      await prisma.exam.create({ data: e });
    }
    console.log(`   ✔  Exams         → ${examsMapped.length}`);

    // 11. Results
    const resultsMapped = data.results.map(r => ({
      college_id: r.college_id,
      session_id: r.session_id,
      student_id: r.student_id,
      exam_id: r.exam_id,
      marks: r.subjects, // Map subjects -> marks (Json)
      totalObtained: r.totalObtained,
      totalMarks: r.totalMarks,
      percentage: r.percentage,
      grade: r.overallGrade, // Map overallGrade -> grade (String)
      isPublished: r.isPublished,
      enteredBy: r.enteredBy,
    }));
    for (const r of resultsMapped) {
      await prisma.result.create({ data: r });
    }
    console.log(`   ✔  Results       → ${resultsMapped.length}`);

    // 12. Attendance
    const attendanceMapped = data.attendance.map(att => ({
      college_id: att.college_id,
      session_id: att.session_id,
      student_id: att.student_id,
      class: classMap[att.class_id] || 'FSC Part 1', // Map class_id -> name
      section: secMap[att.section_id] || 'A',       // Map section_id -> code
      date: att.date,
      status: att.status,
      markedBy: att.markedBy,
    }));
    for (const att of attendanceMapped) {
      await prisma.attendance.create({ data: att });
    }
    console.log(`   ✔  Attendance    → ${attendanceMapped.length}`);

    // 13. Announcements
    const announcementsMapped = data.announcements.map(ann => ({
      college_id: ann.college_id,
      title: ann.title,
      content: ann.content,
      audience: ann.targetAudience, // Map targetAudience -> audience
      createdBy: ann.createdBy,
    }));
    for (const ann of announcementsMapped) {
      await prisma.announcement.create({ data: ann });
    }
    console.log(`   ✔  Announcements → ${announcementsMapped.length}`);

    // 14. Visitors
    const visitorLogsMapped = data.visitorLogs.map(v => ({
      college_id: v.college_id,
      visitorName: v.visitorName,
      cnic: v.cnic,
      phone: v.phone,
      purpose: v.purpose,
      hostName: v.hostName,
      hostDepartment: v.hostDepartment,
      entryTime: v.checkIn, // Map checkIn -> entryTime
      exitTime: v.checkOut, // Map checkOut -> exitTime
      status: v.status,
      enteredBy: v.loggedBy, // Map loggedBy -> enteredBy
    }));
    for (const v of visitorLogsMapped) {
      await prisma.visitorLog.create({ data: v });
    }
    console.log(`   ✔  Visitors      → ${visitorLogsMapped.length}`);

    // 15. Assignments
    const assignmentsMapped = data.assignments.map(asg => ({
      college_id: asg.college_id,
      session_id: asg.session_id,
      teacher_id: asg.teacher_id,
      subject_id: asg.subject_id,
      class_id: asg.class_id,
      section_id: asg.section_id,
      title: asg.title,
      description: asg.description,
      dueDate: asg.dueDate,
      totalMarks: asg.totalMarks,
      status: asg.status,
    }));
    for (const asg of assignmentsMapped) {
      await prisma.assignment.create({ data: asg });
    }
    console.log(`   ✔  Assignments   → ${assignmentsMapped.length}`);

    console.log('\n🎉  Database seeded successfully!\n');
    console.log('─────────────────────────────────────────────────');
    console.log('  Login Credentials (Punjab College of Science)');
    console.log('─────────────────────────────────────────────────');
    console.log('  Super Admin → superadmin@academix.io / super@123');
    console.log('  Admin       → admin@pcs.edu.pk      / admin@123');
    console.log('  Registrar   → registrar@pcs.edu.pk  / registrar@123');
    console.log('  Accountant  → accounts@pcs.edu.pk   / accounts@123');
    console.log('  Principal   → principal@pcs.edu.pk  / principal@123');
    console.log('  Teacher     → nadia@pcs.edu.pk      / teacher@123');
    console.log('  Employee    → security@pcs.edu.pk   / employee@123');
    console.log('─────────────────────────────────────────────────\n');

  } catch (err) {
    console.error('\n❌  Seeding failed:', err.message);
  }
}

async function main() {
  console.log('\n🚀  Connecting to PostgreSQL/Prisma Database...');
  const prisma = getSystemClient();
  console.log('✅  Connected.\n');

  if (CLEAR) await clearDB(prisma);
  if (!WIPE)  await seed(prisma);

  await closeAllClients();
  console.log('👋  Done.\n');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
