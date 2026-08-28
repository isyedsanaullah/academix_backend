// ── Seed Data ─────────────────────────────────────────────
// All IDs are defined here so relationships can be cross-linked

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const id = () => crypto.randomBytes(12).toString('hex');

// ── IDs ────────────────────────────────────────────────────
const SUPER_ADMIN_ID  = id();
const COLLEGE_ID      = id();
const COLLEGE2_ID     = id();
const SESSION_ID      = id();
const CLASS1_ID       = id(); // FSC Part 1
const CLASS2_ID       = id(); // FSC Part 2
const SECTION_A_ID    = id();
const SECTION_B_ID    = id();
const SECTION_C_ID    = id();
const SUBJECT_PHY_ID  = id();
const SUBJECT_CHEM_ID = id();
const SUBJECT_BIO_ID  = id();
const SUBJECT_MATH_ID = id();
const SUBJECT_ENG_ID  = id();
const SUBJECT_URD_ID  = id();
const SUBJECT_CS_ID   = id();

// User IDs
const ADMIN_USER_ID      = id();
const REGISTRAR_USER_ID  = id();
const ACCOUNTANT_USER_ID = id();
const PRINCIPAL_USER_ID  = id();
const TEACHER1_USER_ID   = id();
const TEACHER2_USER_ID   = id();
const TEACHER3_USER_ID   = id();
const EMPLOYEE1_USER_ID  = id();

// Student IDs
const STU = Array.from({ length: 10 }, () => id());

// Teacher Profile IDs
const TEACHER1_PROFILE_ID = id();
const TEACHER2_PROFILE_ID = id();
const TEACHER3_PROFILE_ID = id();

// Exam / Attendance / Fee IDs
const EXAM1_ID = id();
const EXAM2_ID = id();

const hash = (pw) => bcrypt.hashSync(pw, 10);
const now  = new Date();
const dob  = (y, m, d) => new Date(y, m - 1, d);

// ── DATA ───────────────────────────────────────────────────

const colleges = [
  {
    _id: COLLEGE_ID,
    name: 'Punjab College of Science',
    code: 'PCS',
    mongoUrl: process.env.DATABASE_URL || "",
    email: 'admin@pcs.edu.pk',
    phone: '0300-1234567',
    address: '12 Garden Town, Main Boulevard',
    city: 'Lahore',
    website: 'https://pcs.edu.pk',
    logo: 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?auto=format&fit=crop&w=150&h=150&q=80',
    subscription: { plan: 'premium', status: 'active', expiresAt: new Date('2027-06-30') },
    settings: {
      about: 'Punjab College of Science (PCS) is a premier educational institution dedicated to fostering academic excellence, innovation, and character building. With state-of-the-art laboratory facilities, experienced faculty, and a vibrant campus environment, we prepare students for leadership roles in medicine, engineering, technology, and beyond.',
      tagline: 'Excellence in Education, Leadership for the Future',
      establishedYear: 1989,
      coverPhoto: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=1200&q=80',
      socialLinks: {
        facebook: 'https://facebook.com/pcs.official',
        twitter: 'https://twitter.com/pcs_edu',
        linkedin: 'https://linkedin.com/school/punjab-college-of-science',
        instagram: 'https://instagram.com/pcs_college'
      },
      googleMap: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3401.4429959779313!2d74.32185567630737!3d31.511993247385734!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3919045a2786a347%3A0x6e8f498c4749cb2!2sGarden%20Town%2C%20Lahore%2C%20Punjab%2C%20Pakistan!5e0!3m2!1sen!2s!4v1700000000000!5m2!1sen!2s',
      programs: [
        { name: 'FSc Pre-Medical', description: 'Comprehensive curriculum for students aspiring to pursue careers in medicine and biological sciences.' },
        { name: 'FSc Pre-Engineering', description: 'Rigorous training in mathematics, physics, and chemistry for future engineers.' },
        { name: 'ICS (Computer Science)', description: 'Focused program on software engineering, database management, and computing architectures.' }
      ]
    },
    createdAt: now,
  },
  {
    _id: COLLEGE2_ID,
    name: 'Faisalabad Model College',
    code: 'FMC',
    mongoUrl: process.env.DATABASE_URL || "",
    email: 'admin@fmc.edu.pk',
    phone: '0301-9876543',
    address: '45 D-Ground, Peoples Colony',
    city: 'Faisalabad',
    website: 'https://fmc.edu.pk',
    logo: 'https://images.unsplash.com/photo-1592280771190-3e2e4d571952?auto=format&fit=crop&w=150&h=150&q=80',
    subscription: { plan: 'basic', status: 'active', expiresAt: new Date('2026-12-31') },
    settings: {
      about: 'Faisalabad Model College (FMC) is a distinguished model institution focused on providing high-quality intermediate education in the heart of Faisalabad. We combine traditional academic values with modern learning methods to guide our students towards successful careers.',
      tagline: 'Nurturing Minds, Building Character',
      establishedYear: 2005,
      coverPhoto: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1200&q=80',
      socialLinks: {
        facebook: 'https://facebook.com/fmc.faisalabad',
        linkedin: 'https://linkedin.com/school/fmc-faisalabad'
      },
      googleMap: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3408.069176378519!2d73.11166647630043!3d31.412154452585257!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3922425bcf8e11a3%3A0xc07a82ecdf609e7f!2sD-Ground%20Park%2C%20Peoples%20Colony%20No.%201%2C%20Faisalabad%2C%20Punjab!5e0!3m2!1sen!2s!4v1700000000001!5m2!1sen!2s',
      programs: [
        { name: 'FSc Pre-Medical', description: 'Preparatory courses in biology, chemistry, and physics.' },
        { name: 'ICS (Computer Science)', description: 'Introduction to programming, database systems, and math.' },
        { name: 'I.Com (Commerce)', description: 'Foundations of accounting, banking, business math, and economics.' }
      ]
    },
    createdAt: now,
  }
];

const users = [
  // Super Admin
  { _id: SUPER_ADMIN_ID, name: 'Super Admin', email: 'superadmin@academix.io', password: hash('super@123'), role: 'superAdmin', college_id: null, isActive: true },
  // College 1 staff
  { _id: ADMIN_USER_ID,      name: 'Ahmed Raza',     email: 'admin@pcs.edu.pk',      password: hash('admin@123'),      role: 'admin',      college_id: COLLEGE_ID, isActive: true },
  { _id: REGISTRAR_USER_ID,  name: 'Sana Khan',      email: 'registrar@pcs.edu.pk',  password: hash('registrar@123'), role: 'registrar',  college_id: COLLEGE_ID, isActive: true },
  { _id: ACCOUNTANT_USER_ID, name: 'Bilal Ahmed',    email: 'accounts@pcs.edu.pk',   password: hash('accounts@123'), role: 'accountant', college_id: COLLEGE_ID, isActive: true },
  { _id: PRINCIPAL_USER_ID,  name: 'Dr. Farrukh Ali',email: 'principal@pcs.edu.pk',  password: hash('principal@123'),role: 'principal',  college_id: COLLEGE_ID, isActive: true },
  { _id: TEACHER1_USER_ID,   name: 'Nadia Malik',    email: 'nadia@pcs.edu.pk',      password: hash('teacher@123'),  role: 'teacher',    college_id: COLLEGE_ID, isActive: true },
  { _id: TEACHER2_USER_ID,   name: 'Asad Iqbal',     email: 'asad@pcs.edu.pk',       password: hash('teacher@123'),  role: 'teacher',    college_id: COLLEGE_ID, isActive: true },
  { _id: TEACHER3_USER_ID,   name: 'Hira Baig',      email: 'hira@pcs.edu.pk',       password: hash('teacher@123'),  role: 'teacher',    college_id: COLLEGE_ID, isActive: true },
  { _id: id(),               name: 'Teacher Four',   email: 'teacher4@pcs.edu.pk',   password: hash('teacher@123'),  role: 'teacher',    college_id: COLLEGE_ID, isActive: true },
  { _id: id(),               name: 'Teacher Five',   email: 'teacher5@pcs.edu.pk',   password: hash('teacher@123'),  role: 'teacher',    college_id: COLLEGE_ID, isActive: true },
  { _id: EMPLOYEE1_USER_ID,  name: 'Zubair Hussain', email: 'security@pcs.edu.pk',   password: hash('employee@123'), role: 'employee',   college_id: COLLEGE_ID, isActive: true },
  // Students 1-5 Users for PCS
  { _id: id(),               name: 'Ali Hassan',     email: 'ali@student.pcs.edu.pk',password: hash('student@123'),  role: 'student',    college_id: COLLEGE_ID, isActive: true },
  { _id: id(),               name: 'Sara Tariq',     email: 'sara@student.pcs.edu.pk',password: hash('student@123'),  role: 'student',    college_id: COLLEGE_ID, isActive: true },
  { _id: id(),               name: 'Usman Ghani',    email: 'usman@student.pcs.edu.pk',password: hash('student@123'), role: 'student',    college_id: COLLEGE_ID, isActive: true },
  { _id: id(),               name: 'Fatima Zahra',   email: 'fatima@student.pcs.edu.pk',password: hash('student@123'),role: 'student',    college_id: COLLEGE_ID, isActive: true },
  { _id: id(),               name: 'Hamza Sheikh',   email: 'hamza@student.pcs.edu.pk',password: hash('student@123'),role: 'student',    college_id: COLLEGE_ID, isActive: true },
];

const sessions = [
  {
    _id: SESSION_ID,
    college_id: COLLEGE_ID,
    name: '2025-2026',
    startDate: new Date('2025-09-01'),
    endDate: new Date('2026-06-30'),
    isCurrent: true,
    status: 'active',
    createdBy: ADMIN_USER_ID,
  }
];

const classes = [
  { _id: CLASS1_ID, college_id: COLLEGE_ID, session_id: SESSION_ID, name: 'FSC Part 1', groups: ['Pre-Medical','Pre-Engineering','Computer Science'], isActive: true },
  { _id: CLASS2_ID, college_id: COLLEGE_ID, session_id: SESSION_ID, name: 'FSC Part 2', groups: ['Pre-Medical','Pre-Engineering','Computer Science'], isActive: true },
];

const sections = [
  { _id: SECTION_A_ID, college_id: COLLEGE_ID, session_id: SESSION_ID, class_id: CLASS1_ID, code: 'A', name: 'Pre-Medical Section',     capacity: 40, isActive: true },
  { _id: SECTION_B_ID, college_id: COLLEGE_ID, session_id: SESSION_ID, class_id: CLASS1_ID, code: 'B', name: 'Pre-Engineering Section', capacity: 40, isActive: true },
  { _id: SECTION_C_ID, college_id: COLLEGE_ID, session_id: SESSION_ID, class_id: CLASS1_ID, code: 'C', name: 'Computer Science Section', capacity: 35, isActive: true },
];

const subjects = [
  { _id: SUBJECT_PHY_ID,  college_id: COLLEGE_ID, name: 'Physics',      code: 'PHY', class: 'FSC Part 1', group: 'Pre-Engineering', totalMarks: 100, passingMarks: 33, isActive: true },
  { _id: SUBJECT_CHEM_ID, college_id: COLLEGE_ID, name: 'Chemistry',    code: 'CHM', class: 'FSC Part 1', group: 'Pre-Medical',     totalMarks: 100, passingMarks: 33, isActive: true },
  { _id: SUBJECT_BIO_ID,  college_id: COLLEGE_ID, name: 'Biology',      code: 'BIO', class: 'FSC Part 1', group: 'Pre-Medical',     totalMarks: 100, passingMarks: 33, isActive: true },
  { _id: SUBJECT_MATH_ID, college_id: COLLEGE_ID, name: 'Mathematics',  code: 'MTH', class: 'FSC Part 1', group: 'Pre-Engineering', totalMarks: 100, passingMarks: 33, isActive: true },
  { _id: SUBJECT_ENG_ID,  college_id: COLLEGE_ID, name: 'English',      code: 'ENG', class: 'Both',       group: 'Common',          totalMarks: 100, passingMarks: 33, isActive: true },
  { _id: SUBJECT_URD_ID,  college_id: COLLEGE_ID, name: 'Urdu',         code: 'URD', class: 'Both',       group: 'Common',          totalMarks: 100, passingMarks: 33, isActive: true },
  { _id: SUBJECT_CS_ID,   college_id: COLLEGE_ID, name: 'Computer Sc.', code: 'CS',  class: 'FSC Part 1', group: 'Computer Science', totalMarks: 100, passingMarks: 33, isActive: true },
];

const teachers = [
  { _id: TEACHER1_PROFILE_ID, college_id: COLLEGE_ID, user_id: TEACHER1_USER_ID, qualification: 'MSc Physics',   specialization: 'Physics',     salary: 45000, status: 'active', joiningDate: new Date('2022-09-01'), subjects: [SUBJECT_PHY_ID] },
  { _id: TEACHER2_PROFILE_ID, college_id: COLLEGE_ID, user_id: TEACHER2_USER_ID, qualification: 'MSc Chemistry', specialization: 'Chemistry',   salary: 42000, status: 'active', joiningDate: new Date('2023-01-15'), subjects: [SUBJECT_CHEM_ID, SUBJECT_BIO_ID] },
  { _id: TEACHER3_PROFILE_ID, college_id: COLLEGE_ID, user_id: TEACHER3_USER_ID, qualification: 'MCS',           specialization: 'Computer Sc.',salary: 40000, status: 'active', joiningDate: new Date('2023-08-01'), subjects: [SUBJECT_CS_ID, SUBJECT_MATH_ID] },
];

const employees = [
  {
    college_id: COLLEGE_ID,
    user_id: EMPLOYEE1_USER_ID,
    department: 'security',
    designation: 'Security Guard',
    salary: 20000,
    status: 'active',
    joiningDate: new Date('2021-03-01'),
  }
];

// ── 10 Students ────────────────────────────────────────────
const studentNames = [
  ['Ali Hassan',       'Hassan Ali',     'male'],
  ['Sara Tariq',       'Tariq Mehmood',  'female'],
  ['Usman Ghani',      'Ghani Ullah',    'male'],
  ['Fatima Zahra',     'Zahra Iqbal',    'female'],
  ['Hamza Sheikh',     'Sheikh Anwar',   'male'],
  ['Ayesha Noor',      'Noor Ahmed',     'female'],
  ['Bilal Chaudhry',   'Chaudhry Jamil', 'male'],
  ['Zara Malik',       'Malik Zafar',    'female'],
  ['Omar Farooq',      'Farooq Hussain', 'male'],
  ['Maryam Ijaz',      'Ijaz Khan',      'female'],
];
const groups   = ['Pre-Medical','Pre-Medical','Pre-Engineering','Pre-Engineering','Computer Science','Pre-Medical','Pre-Engineering','Computer Science','Pre-Medical','Computer Science'];
const sections_map = [SECTION_A_ID, SECTION_A_ID, SECTION_B_ID, SECTION_B_ID, SECTION_C_ID, SECTION_A_ID, SECTION_B_ID, SECTION_C_ID, SECTION_A_ID, SECTION_C_ID];

const students = studentNames.map(([name, fatherName, gender], i) => ({
  _id: STU[i],
  college_id: COLLEGE_ID,
  session_id: SESSION_ID,
  name,
  fatherName,
  gender,
  rollNumber: `PCS-2025-${String(i + 1).padStart(3, '0')}`,
  registrationNumber: `REG-${2025}-${String(i + 1).padStart(4, '0')}`,
  cnic: `35201-${String(1234567 + i)}-${i % 2 === 0 ? '1' : '3'}`,
  dateOfBirth: dob(2006, (i % 6) + 1, (i % 28) + 1),
  phone: `030${i}-1234${String(i).padStart(3,'0')}`,
  email: `${name.split(' ')[0].toLowerCase()}@student.pcs.edu.pk`,
  address: `House ${i + 1}, Block ${String.fromCharCode(65 + i % 5)}, Lahore`,
  class: 'FSC Part 1',
  group: groups[i],
  section_id: sections_map[i],
  guardianName: fatherName,
  guardianPhone: `0311-${String(9876543 + i).slice(0, 7)}`,
  guardianRelation: 'father',
  status: i === 8 ? 'dropped' : 'active',
  admissionDate: new Date('2025-09-15'),
}));

// ── Fees (3 months for each student) ──────────────────────
const months = ['2025-10', '2025-11', '2025-12'];
const fees = [];
students.forEach((s, si) => {
  months.forEach((month, mi) => {
    const paid = si < 7; // first 7 students paid all 3 months
    const partialPay = si === 7; // student 8 is partial
    const tuition = groups[si] === 'Computer Science' ? 4500 : 4000;
    fees.push({
      college_id: COLLEGE_ID,
      session_id: SESSION_ID,
      student_id: s._id,
      month,
      tuitionFee: tuition,
      functionFee: 200,
      labFee: groups[si] !== 'Pre-Medical' ? 300 : 400,
      fine: 0,
      scholarshipDeduction: si === 0 ? 500 : 0,
      totalAmount: tuition + 200 + (groups[si] !== 'Pre-Medical' ? 300 : 400) - (si === 0 ? 500 : 0),
      paidAmount: paid ? (tuition + 200 + (groups[si] !== 'Pre-Medical' ? 300 : 400) - (si === 0 ? 500 : 0)) : partialPay ? 2000 : 0,
      status: paid ? 'paid' : partialPay ? 'partial' : 'unpaid',
      paidDate: paid ? new Date(`2025-${String(parseInt(month.split('-')[1]) + 1).padStart(2,'0')}-05`) : null,
      receiptNumber: paid ? `RCP-${2025}-${si * 3 + mi + 1}` : null,
      enteredBy: ACCOUNTANT_USER_ID,
    });
  });
});

// ── Exams ─────────────────────────────────────────────────
const exams = [
  {
    _id: EXAM1_ID,
    college_id: COLLEGE_ID,
    session_id: SESSION_ID,
    name: 'First Mid Term',
    type: 'mid',
    class: 'FSC Part 1',
    group: 'all',
    section: 'all',
    subjects: [
      { subject_id: SUBJECT_PHY_ID,  name: 'Physics',     date: new Date('2025-11-10'), startTime: '09:00', endTime: '11:00', totalMarks: 50, passingMarks: 17 },
      { subject_id: SUBJECT_CHEM_ID, name: 'Chemistry',   date: new Date('2025-11-11'), startTime: '09:00', endTime: '11:00', totalMarks: 50, passingMarks: 17 },
      { subject_id: SUBJECT_ENG_ID,  name: 'English',     date: new Date('2025-11-12'), startTime: '09:00', endTime: '11:00', totalMarks: 50, passingMarks: 17 },
    ],
    status: 'completed',
    createdBy: REGISTRAR_USER_ID,
  },
  {
    _id: EXAM2_ID,
    college_id: COLLEGE_ID,
    session_id: SESSION_ID,
    name: 'Annual Examination',
    type: 'final',
    class: 'FSC Part 1',
    group: 'all',
    section: 'all',
    subjects: [
      { subject_id: SUBJECT_PHY_ID,  name: 'Physics',     date: new Date('2026-05-05'), startTime: '09:00', endTime: '12:00', totalMarks: 100, passingMarks: 33 },
      { subject_id: SUBJECT_CHEM_ID, name: 'Chemistry',   date: new Date('2026-05-07'), startTime: '09:00', endTime: '12:00', totalMarks: 100, passingMarks: 33 },
      { subject_id: SUBJECT_BIO_ID,  name: 'Biology',     date: new Date('2026-05-09'), startTime: '09:00', endTime: '12:00', totalMarks: 100, passingMarks: 33 },
      { subject_id: SUBJECT_MATH_ID, name: 'Mathematics', date: new Date('2026-05-11'), startTime: '09:00', endTime: '12:00', totalMarks: 100, passingMarks: 33 },
      { subject_id: SUBJECT_ENG_ID,  name: 'English',     date: new Date('2026-05-13'), startTime: '09:00', endTime: '12:00', totalMarks: 100, passingMarks: 33 },
    ],
    status: 'scheduled',
    createdBy: REGISTRAR_USER_ID,
  }
];

// ── Results (mid-term results for 8 students) ─────────────
const obtainedMarks = [45,42,38,47,35,40,44,28,33,41];
const results = students.slice(0, 8).map((s, i) => ({
  college_id: COLLEGE_ID,
  session_id: SESSION_ID,
  student_id: s._id,
  exam_id: EXAM1_ID,
  class: 'FSC Part 1',
  group: groups[i],
  subjects: [
    { subject_id: SUBJECT_PHY_ID,  subjectName: 'Physics',   obtainedMarks: obtainedMarks[i],     totalMarks: 50, passingMarks: 17, grade: obtainedMarks[i] >= 45 ? 'A+' : obtainedMarks[i] >= 40 ? 'A' : obtainedMarks[i] >= 33 ? 'B' : obtainedMarks[i] >= 25 ? 'C' : 'F' },
    { subject_id: SUBJECT_ENG_ID,  subjectName: 'English',   obtainedMarks: obtainedMarks[i] - 3, totalMarks: 50, passingMarks: 17, grade: 'B' },
  ],
  totalObtained: obtainedMarks[i] + (obtainedMarks[i] - 3),
  totalMarks: 100,
  percentage: ((obtainedMarks[i] + obtainedMarks[i] - 3) / 100) * 100,
  overallGrade: obtainedMarks[i] >= 40 ? 'A' : 'B',
  isPublished: true,
  enteredBy: TEACHER1_USER_ID,
}));

// ── Attendance (last 7 school days) ──────────────────────
const attendance = [];
const days = [-6,-5,-4,-3,-2,-1,0].map(d => { const dt = new Date(); dt.setDate(dt.getDate() + d); return dt; });
students.forEach(s => {
  days.forEach(date => {
    attendance.push({
      college_id: COLLEGE_ID,
      session_id: SESSION_ID,
      student_id: s._id,
      class_id: CLASS1_ID,
      section_id: s.section_id,
      date,
      status: Math.random() > 0.15 ? 'present' : 'absent',
      markedBy: TEACHER1_USER_ID,
    });
  });
});

// ── Announcements ─────────────────────────────────────────
const announcements = [
  { college_id: COLLEGE_ID, title: 'Welcome Back Students', content: 'We welcome all students to the new academic session 2025-2026. Please collect your fee challan from the accounts office.', targetAudience: 'all', createdBy: ADMIN_USER_ID, isActive: true },
  { college_id: COLLEGE_ID, title: 'Mid-Term Exam Schedule', content: 'Mid-term examinations will commence from November 10, 2025. Please check the detailed schedule on the notice board.', targetAudience: 'student', createdBy: REGISTRAR_USER_ID, isActive: true },
  { college_id: COLLEGE_ID, title: 'Fee Submission Deadline', content: 'Last date for fee submission without fine is 15th of every month. After that Rs. 200 fine will be charged.', targetAudience: 'student', createdBy: ACCOUNTANT_USER_ID, isActive: true },
  { college_id: COLLEGE_ID, title: 'Staff Meeting Notice', content: 'All teaching staff are requested to attend the monthly staff meeting on Friday at 2:00 PM in the Conference Room.', targetAudience: 'teacher', createdBy: PRINCIPAL_USER_ID, isActive: true },
];

// ── Visitor Logs ──────────────────────────────────────────
const visitorLogs = [
  { college_id: COLLEGE_ID, visitorName: 'Mohammad Akram', cnic: '35201-1234567-1', phone: '0300-1111111', purpose: 'Meeting with Principal', hostName: 'Dr. Farrukh Ali', hostDepartment: 'Principal Office', checkIn: new Date('2025-11-15T09:30:00'), checkOut: new Date('2025-11-15T11:00:00'), status: 'out', loggedBy: EMPLOYEE1_USER_ID },
  { college_id: COLLEGE_ID, visitorName: 'Amna Bibi',      cnic: '35201-9876543-6', phone: '0311-2222222', purpose: 'Fee Inquiry',           hostName: 'Bilal Ahmed',   hostDepartment: 'Accounts',          checkIn: new Date('2025-11-16T10:15:00'), checkOut: new Date('2025-11-16T10:45:00'), status: 'out', loggedBy: EMPLOYEE1_USER_ID },
  { college_id: COLLEGE_ID, visitorName: 'Rizwan Shah',    cnic: '35201-5555555-3', phone: '0333-3333333', purpose: 'Admission Inquiry',     hostName: 'Sana Khan',     hostDepartment: 'Registrar',         checkIn: new Date(), status: 'in', loggedBy: EMPLOYEE1_USER_ID },
];

// ── Assignments ───────────────────────────────────────────
const assignments = [
  {
    college_id: COLLEGE_ID,
    session_id: SESSION_ID,
    teacher_id: TEACHER1_USER_ID,
    subject_id: SUBJECT_PHY_ID,
    class_id:   CLASS1_ID,
    section_id: SECTION_B_ID,
    title: 'Laws of Motion - Practice Problems',
    description: 'Solve all 20 problems from Chapter 3 on Newtons Laws of Motion. Show complete working.',
    dueDate: new Date(Date.now() + 7 * 86400000),
    totalMarks: 20,
    status: 'active',
  },
  {
    college_id: COLLEGE_ID,
    session_id: SESSION_ID,
    teacher_id: TEACHER2_USER_ID,
    subject_id: SUBJECT_CHEM_ID,
    class_id:   CLASS1_ID,
    section_id: SECTION_A_ID,
    title: 'Periodic Table Report',
    description: 'Write a detailed report on the first 20 elements of the periodic table including electron configurations.',
    dueDate: new Date(Date.now() + 5 * 86400000),
    totalMarks: 25,
    status: 'active',
  },
  {
    college_id: COLLEGE_ID,
    session_id: SESSION_ID,
    teacher_id: TEACHER3_USER_ID,
    subject_id: SUBJECT_CS_ID,
    class_id:   CLASS1_ID,
    section_id: SECTION_C_ID,
    title: 'OOP Concepts Assignment',
    description: 'Create a simple class hierarchy in C++ demonstrating inheritance, polymorphism, and encapsulation.',
    dueDate: new Date(Date.now() + 10 * 86400000),
    totalMarks: 30,
    status: 'active',
  },
];

module.exports = {
  colleges, users, sessions, classes, sections, subjects,
  teachers, employees, students, fees, exams, results,
  attendance, announcements, visitorLogs, assignments,
};
