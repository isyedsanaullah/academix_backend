/**
 * Academix Database Seeder
 * Usage:  node seeders/seed.js            → seeds everything
 *         node seeders/seed.js --clear    → clears then seeds
 *         node seeders/seed.js --wipe     → clears only (no re-seed)
 */
require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const { PLAN_PRICING } = require('../config/planConstants');
const { TRIAL_DAYS, TRIAL_ENTITLEMENT_PLAN } = require('../config/trialConfig');
const { BANK_DETAILS } = require('../config/billingConfig');
const data = require('./seedData');

const args  = process.argv.slice(2);
const CLEAR = args.includes('--clear') || args.includes('--wipe');
const WIPE  = args.includes('--wipe');

async function clearDB(prisma) {
  console.log('🗑  Clearing all tables sequentially...');
  const models = [
    'invoiceProofSubmission', 'platformInvoice', 'collegeSubscription',
    'collegeEntitlementAudit', 'collegeInvitation', 'collegeInvite',
    'collegeAddon', 'collegeSubscriptionPayment', 'collegeQuotaOverride',
    'collegeFeatureOverride', 'collegeCreditBalance', 'collegeUsage',
    'subscriptionPeriod', 'verifyToken', 'verifyLog', 'outboxEvent',
    'admissionSeason', 'aIApiKey', 'aIUsageLog', 'announcement', 'application',
    'approval', 'assignment', 'attendance', 'auditLog', 'canteenTransaction',
    'certificate', 'chatHistory', 'class', 'earlyExitRequest',
    'employee', 'evaluationSeason', 'evaluation', 'exam', 'fee',
    'fine', 'gateLog', 'leaveApplication', 'notification', 'payment',
    'paySlip', 'pDFDocument', 'quiz', 'result', 'section',
    'session', 'student', 'studentFee', 'subject', 'subscription',
    'teacher', 'timetable', 'transaction', 'user', 'visitorLog', 'documentChunk',
    'college'
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

    // 1. Subscription Plans (canonical PKRs from planConstants)
    const plans = [
      {
        planId: 'starter',
        name: 'Starter Plan',
        description: 'Core daily operations for smaller institutions',
        features: [
          'students', 'teachers', 'subjects', 'attendance',
          'timetable', 'notices', 'exams', 'results',
          'classes', 'sections', 'sessions', 'announcements',
          'assignments', 'quizzes', 'certificates'
        ],
        restrictions: ['No AI features', 'No fee management'],
        limits: { maxStudents: 350, maxStaff: 35, maxStorageGb: 5 },
        price: { monthly: PLAN_PRICING.starter.monthly, yearly: PLAN_PRICING.starter.yearly, currency: 'PKR' },
        isAI: false
      },
      {
        planId: 'standard',
        name: 'Standard Plan',
        description: 'Admissions, challans, board exams, payroll & AI Lite',
        features: [
          'students', 'teachers', 'subjects', 'attendance',
          'timetable', 'notices', 'exams', 'results',
          'classes', 'sections', 'sessions', 'announcements',
          'assignments', 'quizzes', 'certificates',
          'entry-system', 'fees', 'analytics', 'reports',
          'employees', 'visitors', 'canteen', 'advanced'
        ],
        restrictions: [],
        limits: { maxStudents: 1500, maxStaff: 120, maxStorageGb: 25 },
        price: { monthly: PLAN_PRICING.standard.monthly, yearly: PLAN_PRICING.standard.yearly, currency: 'PKR' },
        isAI: true
      },
      {
        planId: 'premium',
        name: 'Premium Plan',
        description: 'Full-featured multi-campus platform with AI & parent portal',
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
        limits: { maxStudents: 5000, maxStaff: 400, maxStorageGb: 100 },
        price: { monthly: PLAN_PRICING.premium.monthly, yearly: PLAN_PRICING.premium.yearly, currency: 'PKR' },
        isAI: true
      }
    ];

    for (const plan of plans) {
      await prisma.subscription.create({ data: plan });
    }
    console.log(`   ✔  Subscription Plans → ${plans.length}`);

    // 2. Colleges (including PCS=ACTIVE, FMC=TRIAL + LGC=PENDING_PAYMENT, MGC=EXPIRED, KWC=DEACTIVATED)
    const now = new Date();
    const dayMs = 86400000;
    const collegesMapped = data.colleges.map((c, idx) => {
      const isTrial = idx === 1;
      return {
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
        planId: isTrial ? TRIAL_ENTITLEMENT_PLAN : 'premium',
        billingCycle: isTrial ? 'MONTHLY' : 'YEARLY',
        subStatus: isTrial ? 'TRIAL' : 'ACTIVE',
        trialStartedAt: isTrial ? new Date(now.getTime() - 4 * dayMs) : null,
        trialEndsAt: isTrial ? new Date(now.getTime() + (TRIAL_DAYS - 4) * dayMs) : null,
        periodStart: isTrial ? null : new Date(now.getTime() - 30 * dayMs),
        periodEnd: isTrial ? null : new Date(now.getTime() + 335 * dayMs),
        subscription: c.subscription,
        settings: c.settings || {},
        createdAt: c.createdAt,
      };
    });
    for (const c of collegesMapped) {
      await prisma.college.create({ data: c });
    }
    console.log(`   ✔  Colleges      → ${collegesMapped.length} base`);

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

    // 16. Subscription Lifecycle States, Locked Subscriptions, Invoices & Planless Invitations
    const hashPw = (pw) => bcrypt.hashSync(pw, 10);
    const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
    const pcsId = collegesMapped[0].id;
    const fmcId = collegesMapped[1].id;
    const superAdminUser = usersMapped.find((u) => u.role === 'superAdmin');

    // A) PCS -> Active price-locked subscription + APPROVED invoice
    const pcsSub = await prisma.collegeSubscription.create({
      data: {
        college_id: pcsId,
        status: 'ACTIVE',
        planId: 'premium',
        planName: 'Premium',
        planPricePkr: PLAN_PRICING.premium.yearly,
        addonsSnapshot: [],
        subtotalPkr: PLAN_PRICING.premium.yearly,
        prorationCreditPkr: 0,
        totalPkr: PLAN_PRICING.premium.yearly,
        currency: 'PKR',
        billingCycle: 'YEARLY',
        startsAt: new Date(now.getTime() - 30 * dayMs),
        endsAt: new Date(now.getTime() + 335 * dayMs),
        activatedAt: new Date(now.getTime() - 30 * dayMs),
        createdBy: superAdminUser?.id || 'seed',
      },
    });
    await prisma.college.update({
      where: { id: pcsId },
      data: { activeSubscriptionId: pcsSub.id },
    });
    await prisma.platformInvoice.create({
      data: {
        college_id: pcsId,
        subscriptionId: pcsSub.id,
        invoiceNo: 'INV-2026-PCS01',
        planId: 'premium',
        billingCycle: 'YEARLY',
        purpose: 'Academix subscription - Premium - Yearly',
        lineItems: [{ itemType: 'PLAN_SUBSCRIPTION', name: 'Premium Plan (Yearly)', quantity: 1, unitPricePkr: PLAN_PRICING.premium.yearly, subtotalPkr: PLAN_PRICING.premium.yearly, status: 'PAID' }],
        currency: 'PKR',
        bankDetailsSnapshot: BANK_DETAILS,
        periodStart: new Date(now.getTime() - 30 * dayMs),
        periodEnd: new Date(now.getTime() + 335 * dayMs),
        dueDate: new Date(now.getTime() - 23 * dayMs),
        paidAt: new Date(now.getTime() - 30 * dayMs),
        amount: PLAN_PRICING.premium.yearly,
        status: 'APPROVED',
        method: 'bank',
        referenceNumber: 'UBL-PCS-90011',
        reviewedAt: new Date(now.getTime() - 30 * dayMs),
        reviewedBy: superAdminUser?.email || 'superadmin@academix.io',
        verifyToken: crypto.randomBytes(12).toString('hex'),
      },
    });

    // B) FMC (TRIAL) -> Add college admin user
    await prisma.user.create({
      data: {
        name: 'FMC Admin',
        email: 'admin@fmc.edu.pk',
        password: hashPw('admin@123'),
        role: 'admin',
        college_id: fmcId,
        isActive: true,
      },
    });

    // C) Lahore Grammar Campus -> PENDING_PAYMENT with PENDING_REVIEW invoice
    const lgc = await prisma.college.create({
      data: {
        name: 'Lahore Grammar Campus',
        code: 'LGC',
        email: 'admin@lgc.edu.pk',
        phone: '0302-1112233',
        city: 'Lahore',
        planId: 'standard',
        billingCycle: 'YEARLY',
        subStatus: 'PENDING_PAYMENT',
        trialStartedAt: new Date(now.getTime() - 10 * dayMs),
        trialEndsAt: new Date(now.getTime() + 4 * dayMs),
      },
    });
    await prisma.user.create({
      data: { name: 'LGC Admin', email: 'admin@lgc.edu.pk', password: hashPw('admin@123'), role: 'admin', college_id: lgc.id, isActive: true },
    });
    const lgcSub = await prisma.collegeSubscription.create({
      data: {
        college_id: lgc.id,
        status: 'PENDING_PAYMENT',
        planId: 'standard',
        planName: 'Standard',
        planPricePkr: PLAN_PRICING.standard.yearly,
        addonsSnapshot: [{ addonType: 'STUDENTS', name: 'Extra Students', quantity: 50, unitPricePkr: 150, subtotalPkr: 7500 }],
        subtotalPkr: PLAN_PRICING.standard.yearly + 7500,
        prorationCreditPkr: 0,
        totalPkr: PLAN_PRICING.standard.yearly + 7500,
        currency: 'PKR',
        billingCycle: 'YEARLY',
      },
    });
    const lgcInv = await prisma.platformInvoice.create({
      data: {
        college_id: lgc.id,
        subscriptionId: lgcSub.id,
        invoiceNo: 'INV-2026-LGC02',
        planId: 'standard',
        billingCycle: 'YEARLY',
        purpose: 'Academix subscription - Standard - Yearly + Extra Students x50',
        lineItems: [
          { itemType: 'PLAN_SUBSCRIPTION', name: 'Standard Plan (Yearly)', quantity: 1, unitPricePkr: PLAN_PRICING.standard.yearly, subtotalPkr: PLAN_PRICING.standard.yearly, status: 'UNPAID' },
          { itemType: 'ADDON', addonType: 'STUDENTS', name: 'Extra Students', quantity: 50, unitPricePkr: 150, subtotalPkr: 7500, status: 'UNPAID' },
        ],
        currency: 'PKR',
        bankDetailsSnapshot: BANK_DETAILS,
        periodStart: now,
        periodEnd: new Date(now.getTime() + 365 * dayMs),
        dueDate: new Date(now.getTime() + 7 * dayMs),
        amount: PLAN_PRICING.standard.yearly + 7500,
        status: 'PENDING_REVIEW',
        method: 'bank',
        referenceNumber: 'UBL-TXN-77120',
        submissionNote: 'Paid via UBL Digital App from Gulberg branch',
        submittedAt: new Date(now.getTime() - 3600 * 1000),
        submittedBy: 'admin@lgc.edu.pk',
        verifyToken: crypto.randomBytes(12).toString('hex'),
      },
    });
    await prisma.invoiceProofSubmission.create({
      data: {
        invoiceId: lgcInv.id,
        college_id: lgc.id,
        objectKey: 'seed/sample-proof-lgc.png',
        mimeType: 'image/png',
        sizeBytes: 12450,
        referenceNumber: 'UBL-TXN-77120',
        note: 'Paid via UBL Digital App from Gulberg branch',
        status: 'PENDING_REVIEW',
        submittedBy: 'admin@lgc.edu.pk',
      },
    });

    // D) Multan Garrison College -> EXPIRED (trial ended) + REJECTED & UNPAID invoices
    const mgc = await prisma.college.create({
      data: {
        name: 'Multan Garrison College',
        code: 'MGC',
        email: 'admin@mgc.edu.pk',
        phone: '0303-4445566',
        city: 'Multan',
        planId: TRIAL_ENTITLEMENT_PLAN,
        billingCycle: 'MONTHLY',
        subStatus: 'EXPIRED',
        trialStartedAt: new Date(now.getTime() - 16 * dayMs),
        trialEndsAt: new Date(now.getTime() - 2 * dayMs),
        forceReadOnly: true,
        readOnlyReason: 'TRIAL_EXPIRED',
      },
    });
    await prisma.user.createMany({
      data: [
        { name: 'MGC Admin', email: 'admin@mgc.edu.pk', password: hashPw('admin@123'), role: 'admin', college_id: mgc.id, isActive: true },
        { name: 'MGC Teacher', email: 'teacher@mgc.edu.pk', password: hashPw('teacher@123'), role: 'teacher', college_id: mgc.id, isActive: true },
      ],
    });
    const mgcSub = await prisma.collegeSubscription.create({
      data: {
        college_id: mgc.id,
        status: 'PENDING_PAYMENT',
        planId: 'starter',
        planName: 'Starter',
        planPricePkr: PLAN_PRICING.starter.monthly,
        addonsSnapshot: [],
        subtotalPkr: PLAN_PRICING.starter.monthly,
        prorationCreditPkr: 0,
        totalPkr: PLAN_PRICING.starter.monthly,
        currency: 'PKR',
        billingCycle: 'MONTHLY',
      },
    });
    await prisma.platformInvoice.create({
      data: {
        college_id: mgc.id,
        subscriptionId: mgcSub.id,
        invoiceNo: 'INV-2026-MGC03',
        planId: 'starter',
        billingCycle: 'MONTHLY',
        purpose: 'Academix subscription - Starter - Monthly',
        lineItems: [{ itemType: 'PLAN_SUBSCRIPTION', name: 'Starter Plan (Monthly)', quantity: 1, unitPricePkr: PLAN_PRICING.starter.monthly, subtotalPkr: PLAN_PRICING.starter.monthly, status: 'UNPAID' }],
        currency: 'PKR',
        bankDetailsSnapshot: BANK_DETAILS,
        periodStart: now,
        periodEnd: new Date(now.getTime() + 30 * dayMs),
        dueDate: new Date(now.getTime() + 5 * dayMs),
        amount: PLAN_PRICING.starter.monthly,
        status: 'REJECTED',
        referenceNumber: 'UBL-BAD-009',
        rejectionReason: 'Receipt image was blurry; please re-upload clear screenshot.',
        reviewedAt: new Date(now.getTime() - 7200 * 1000),
        reviewedBy: superAdminUser?.email || 'superadmin@academix.io',
        verifyToken: crypto.randomBytes(12).toString('hex'),
      },
    });

    // E) Karachi Women College -> DEACTIVATED + Audit log
    const kwc = await prisma.college.create({
      data: {
        name: 'Karachi Women College',
        code: 'KWC',
        email: 'admin@kwc.edu.pk',
        phone: '0304-7778899',
        city: 'Karachi',
        planId: 'starter',
        billingCycle: 'MONTHLY',
        subStatus: 'DEACTIVATED',
        forceReadOnly: true,
        readOnlyReason: 'DEACTIVATED',
      },
    });
    await prisma.user.createMany({
      data: [
        { name: 'KWC Admin', email: 'admin@kwc.edu.pk', password: hashPw('admin@123'), role: 'admin', college_id: kwc.id, isActive: true },
        { name: 'KWC Student', email: 'student@kwc.edu.pk', password: hashPw('student@123'), role: 'student', college_id: kwc.id, isActive: true },
      ],
    });
    await prisma.collegeEntitlementAudit.create({
      data: {
        college_id: kwc.id,
        actorUserId: superAdminUser?.id || 'superAdmin',
        actorEmail: superAdminUser?.email || 'superadmin@academix.io',
        action: 'MANUAL_SUBSCRIPTION_DEACTIVATE',
        beforeStateJson: { subStatus: 'ACTIVE' },
        afterStateJson: { subStatus: 'DEACTIVATED' },
        reason: 'Sample deactivated tenant for billing & access-lock testing',
      },
    });

    // F) Sample planless invitations
    await prisma.collegeInvitation.createMany({
      data: [
        {
          email: 'pending.invite@example.edu.pk',
          collegeName: 'Quetta Science Academy',
          tokenHash: sha256('seed-valid-invite-token-12345'),
          status: 'pending',
          invitedBy: superAdminUser?.id || 'superAdmin',
          expiresAt: new Date(now.getTime() + 7 * dayMs),
        },
        {
          email: 'expired.invite@example.edu.pk',
          collegeName: 'Peshawar Heritage College',
          tokenHash: sha256('seed-expired-invite-token-12345'),
          status: 'pending',
          invitedBy: superAdminUser?.id || 'superAdmin',
          expiresAt: new Date(now.getTime() - 2 * dayMs),
        },
      ],
    });
    console.log('   ✔  Multi-state Colleges, Invoices & Planless Invitations seeded.');

    console.log('\n🎉  Database seeded successfully!\n');
    console.log('──────────────────────────────────────────────────────────');
    console.log('  Test Credentials Across All Subscription States');
    console.log('──────────────────────────────────────────────────────────');
    console.log('  Super Admin         → superadmin@academix.io / super@123');
    console.log('  PCS [ACTIVE]        → admin@pcs.edu.pk       / admin@123');
    console.log('  FMC [TRIAL]         → admin@fmc.edu.pk       / admin@123');
    console.log('  LGC [PENDING_PAY]   → admin@lgc.edu.pk       / admin@123');
    console.log('  MGC [EXPIRED Lock]  → admin@mgc.edu.pk       / admin@123');
    console.log('  MGC Teacher (Lock)  → teacher@mgc.edu.pk     / teacher@123');
    console.log('  KWC [DEACTIVATED]   → admin@kwc.edu.pk       / admin@123');
    console.log('  KWC Student (Lock)  → student@kwc.edu.pk     / student@123');
    console.log('  Valid Invite Token  → seed-valid-invite-token-12345');
    console.log('  Expired Invite Tok. → seed-expired-invite-token-12345');
    console.log('──────────────────────────────────────────────────────────\n');

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
