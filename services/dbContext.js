/**
 * Database Context Service (Prisma Implementation)
 * Queries the PostgreSQL database to build context for AI chat.
 * Analyzes the user's question and fetches relevant data from tables.
 */

const { getSystemClient, getTenantClient } = require('../config/prismaManager');

/**
 * Detect which topics the user is asking about
 */
const detectTopics = (message) => {
  const msg = message.toLowerCase();
  const topics = [];

  // People & contacts
  if (/principal|head|director/.test(msg)) topics.push('principal');
  if (/teacher|professor|instructor|faculty|sir|madam|miss/.test(msg)) topics.push('teachers');
  if (/student|classmate|class\s?fellow|batch/.test(msg)) topics.push('students');
  if (/registrar/.test(msg)) topics.push('registrar');
  if (/admin|administrator/.test(msg)) topics.push('admin');
  if (/staff|employee/.test(msg)) topics.push('employees');

  // Schedule & timetable
  if (/timetable|schedule|period|lecture|class\s?time|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday/.test(msg)) topics.push('timetable');

  // Subjects
  if (/subject|course|syllabus/.test(msg)) topics.push('subjects');

  // Fees
  if (/fee|payment|challan|dues|tuition|balance/.test(msg)) topics.push('fees');

  // Exams & results
  if (/exam|test|result|grade|mark|percentage|pass|fail|datesheet/.test(msg)) topics.push('exams');

  // Attendance
  if (/attendance|absent|present|leave/.test(msg)) topics.push('attendance');

  // Announcements
  if (/announcement|notice|news|update|circular/.test(msg)) topics.push('announcements');

  // College info
  if (/college|campus|address|contact|phone|email|about|location/.test(msg)) topics.push('college');

  // Session
  if (/session|academic\s?year|semester/.test(msg)) topics.push('session');

  // Student personal academic data
  if (/\bmy\s+(result|grade|marks?|gpa|cgpa|percentage|score|position|rank)\b/.test(msg) ||
      (/\b(result|grade|marks?|gpa|cgpa|percentage)\b/.test(msg) && /\b(my|i |am i|me )\b/.test(msg))) {
    topics.push('my-results');
  }
  if (/\bmy\s+(profile|info|details|roll|name|enrollment|program|department|semester|status|data)\b/.test(msg) || /\bwho am i\b/.test(msg)) {
    topics.push('my-profile');
  }
  if (/\b(performance|progress|how am i|how i am|how can i improve|academic standing|weak subject|strong subject|improve my|at risk|eligible for exam|should i focus|my standing|my progress|my performance|how to improve|which subject)\b/.test(msg)) {
    topics.push('performance');
  }
  if (/\b(fine|penalty|discipline|disciplinary|warning|misconduct)\b/.test(msg)) topics.push('fines');
  if (/\b(assignment|homework|submission|pending)\b/.test(msg)) topics.push('assignments');
  if (/\bquiz(zes)?\b/.test(msg)) topics.push('quizzes');

  // If nothing detected, return general
  if (topics.length === 0) topics.push('general');

  return topics;
};

/**
 * Get the day name for relative queries
 */
const getDayName = (message) => {
  const msg = message.toLowerCase();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();

  if (msg.includes('today')) return days[today.getDay()];
  if (msg.includes('tomorrow')) return days[(today.getDay() + 1) % 7];
  for (const d of days) {
    if (msg.includes(d.toLowerCase())) return d;
  }
  return null;
};

/**
 * Build database context based on detected topics
 */
const buildDatabaseContext = async (message, collegeId, userId, userRole) => {
  const topics = detectTopics(message);
  const parts = [];

  try {
    const systemDb = getSystemClient();
    let tenantDb = systemDb;

    if (collegeId) {
      const college = await systemDb.college.findUnique({
        where: { id: collegeId },
        select: { mongoUrl: true }
      });
      if (college && college.mongoUrl) {
        tenantDb = getTenantClient(college.mongoUrl);
      }
    }

    // ─── Pre-fetch student record (reused by multiple handlers) ────────────
    let studentRecord = null;
    let currentSession = null;
    if (userRole === 'student' && collegeId) {
      try {
        currentSession = await tenantDb.session.findFirst({
          where: { college_id: collegeId, isCurrent: true }
        });
        if (currentSession) {
          studentRecord = await tenantDb.student.findFirst({
            where: { user_id: userId, college_id: collegeId, session_id: currentSession.id }
          });
        }
        if (!studentRecord) {
          studentRecord = await tenantDb.student.findFirst({
            where: { user_id: userId, college_id: collegeId },
            orderBy: { createdAt: 'desc' }
          });
        }
        // Performance topic triggers comprehensive data gathering
        if (studentRecord && topics.includes('performance')) {
          ['my-results', 'attendance', 'fines', 'assignments', 'quizzes', 'fees', 'my-profile'].forEach(t => {
            if (!topics.includes(t)) topics.push(t);
          });
        }
      } catch (e) {
        console.error('Student pre-fetch error:', e.message);
      }
    }

    // College info
    if (topics.includes('college') || topics.includes('general')) {
      const college = await systemDb.college.findUnique({
        where: { id: collegeId },
        select: { name: true, code: true, address: true, phone: true, email: true }
      });
      if (college) {
        parts.push(`## College Information\n- Name: ${college.name}\n- Code: ${college.code}\n- Address: ${college.address || 'N/A'}\n- Phone: ${college.phone || 'N/A'}\n- Email: ${college.email || 'N/A'}`);
      }
    }

    // Principal
    if (topics.includes('principal')) {
      const principals = await systemDb.user.findMany({
        where: { college_id: collegeId, role: 'principal', isActive: true },
        select: { name: true, email: true, phone: true }
      });
      if (principals.length > 0) {
        parts.push(`## Principal(s)\n${principals.map(p => `- ${p.name} | Email: ${p.email}${p.phone ? ' | Phone: ' + p.phone : ''}`).join('\n')}`);
      }
    }

    // Registrar
    if (topics.includes('registrar')) {
      const registrars = await systemDb.user.findMany({
        where: { college_id: collegeId, role: 'registrar', isActive: true },
        select: { name: true, email: true, phone: true }
      });
      if (registrars.length > 0) {
        parts.push(`## Registrar(s)\n${registrars.map(r => `- ${r.name} | Email: ${r.email}${r.phone ? ' | Phone: ' + r.phone : ''}`).join('\n')}`);
      }
    }

    // Admin
    if (topics.includes('admin')) {
      const admins = await systemDb.user.findMany({
        where: { college_id: collegeId, role: 'admin', isActive: true },
        select: { name: true, email: true }
      });
      if (admins.length > 0) {
        parts.push(`## Admin(s)\n${admins.map(a => `- ${a.name} | Email: ${a.email}`).join('\n')}`);
      }
    }

    // Teachers
    if (topics.includes('teachers') || topics.includes('general')) {
      const teachers = await systemDb.user.findMany({
        where: { college_id: collegeId, role: 'teacher', isActive: true },
        select: { name: true, email: true, phone: true }
      });
      if (teachers.length > 0) {
        parts.push(`## Teachers\n${teachers.map(t => `- ${t.name} | Email: ${t.email}${t.phone ? ' | Phone: ' + t.phone : ''}`).join('\n')}`);
      }
    }

    // Timetable
    if (topics.includes('timetable')) {
      const dayFilter = getDayName(message);
      const query = { college_id: collegeId, isActive: true };
      if (dayFilter) query.day = dayFilter;

      // If student, filter to their specific timetable
      if (userRole === 'student' && studentRecord) {
        query.class = studentRecord.class;
        query.section = studentRecord.section;
      }

      const timetables = await tenantDb.timetable.findMany({
        where: query
      });
      if (timetables.length > 0) {
        const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        timetables.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
        const ttText = timetables.map(tt => {
          let periods = [];
          let breaks = [];
          if (tt.periods && Array.isArray(tt.periods)) {
            periods = tt.periods
              .filter(p => !p.isBreak)
              .map(p => `  Period ${p.periodNumber}: ${p.subjectName || 'N/A'} (${p.startTime}-${p.endTime}) — ${p.teacherName || 'TBA'}`);
            breaks = tt.periods
              .filter(p => p.isBreak)
              .map(p => `  ${p.label || 'Break'}: ${p.startTime}-${p.endTime}`);
          }
          return `### ${tt.day} (${tt.class} - Section ${tt.section})\n${periods.join('\n')}\n${breaks.join('\n')}`;
        }).join('\n\n');
        parts.push(`## Timetable\n${ttText}`);
      }
    }

    // Subjects
    if (topics.includes('subjects')) {
      const subjects = await tenantDb.subject.findMany({
        where: { college_id: collegeId, isActive: true }
      });
      if (subjects.length > 0) {
        const teacherIds = [...new Set(subjects.map(s => s.teacher_id).filter(Boolean))];
        const teachersMap = {};
        if (teacherIds.length > 0) {
          const teachersList = await tenantDb.teacher.findMany({
            where: { id: { in: teacherIds } }
          });
          const userIds = teachersList.map(t => t.user_id);
          const usersList = await systemDb.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true }
          });
          const userIdToName = {};
          usersList.forEach(u => { userIdToName[u.id] = u.name; });
          teachersList.forEach(t => {
            teachersMap[t.id] = userIdToName[t.user_id] || 'TBA';
          });
        }
        parts.push(`## Subjects\n${subjects.map(s => `- ${s.name} (${s.code || 'N/A'}) | Group: ${s.group} | Class: ${s.class} | Teacher: ${teachersMap[s.teacher_id] || 'TBA'}`).join('\n')}`);
      }
    }

    // Fees (student-specific)
    if (topics.includes('fees') && userRole === 'student' && studentRecord) {
      const fees = await tenantDb.fee.findMany({
        where: { college_id: collegeId, student_id: studentRecord.id },
        orderBy: { createdAt: 'desc' },
        take: 12
      });
      if (fees.length > 0) {
        const totalFees = fees.reduce((sum, f) => sum + (f.totalAmount || 0), 0);
        const totalPaid = fees.reduce((sum, f) => sum + (f.paidAmount || 0), 0);
        const unpaidCount = fees.filter(f => f.status !== 'paid').length;
        parts.push(`## My Fee Status\n- **Total Fees:** Rs. ${totalFees} | **Total Paid:** Rs. ${totalPaid} | **Balance:** Rs. ${totalFees - totalPaid}\n- **Unpaid Months:** ${unpaidCount}\n${fees.map(f => `- ${f.month}: Rs. ${f.totalAmount} | Paid: Rs. ${f.paidAmount || 0} | Status: **${f.status}**${f.dueDate ? ' | Due: ' + new Date(f.dueDate).toLocaleDateString() : ''}`).join('\n')}`);
      }
    }

    // Exams
    if (topics.includes('exams')) {
      const exams = await tenantDb.exam.findMany({
        where: { college_id: collegeId },
        orderBy: { createdAt: 'desc' },
        take: 5
      });
      if (exams.length > 0) {
        parts.push(`## Recent Exams\n${exams.map(e => `- ${e.name} | Type: ${e.type || 'N/A'} | Status: ${e.status || 'N/A'}`).join('\n')}`);
      }
    }

    // Attendance (student-specific — enhanced)
    if (topics.includes('attendance') && userRole === 'student' && studentRecord) {
      const sessionFilter = currentSession ? { session_id: currentSession.id } : {};
      const att = await tenantDb.attendance.findMany({
        where: { college_id: collegeId, student_id: studentRecord.id, ...sessionFilter },
        orderBy: { date: 'desc' },
        take: 90
      });
      if (att.length > 0) {
        const total = att.length;
        const present = att.filter(a => a.status === 'present').length;
        const absent = att.filter(a => a.status === 'absent').length;
        const late = att.filter(a => a.status === 'late').length;
        const leave = att.filter(a => a.status === 'leave').length;
        const percentage = Math.round(present / total * 100);
        const eligibilityNote = percentage < 75
          ? '⚠️ **Warning:** Attendance below 75% — may affect exam eligibility.'
          : '✅ Attendance meets minimum requirement (75%).';
        parts.push(`## My Attendance Summary\n- **Overall:** ${present}/${total} = **${percentage}%**\n- Present: ${present} | Absent: ${absent} | Late: ${late} | Leave: ${leave}\n- ${eligibilityNote}`);
      } else {
        parts.push(`## My Attendance Summary\nNo attendance records found for the current session.`);
      }
    }

    // Announcements
    if (topics.includes('announcements')) {
      const anns = await tenantDb.announcement.findMany({
        where: { college_id: collegeId },
        orderBy: { createdAt: 'desc' },
        take: 5
      });
      if (anns.length > 0) {
        parts.push(`## Recent Announcements\n${anns.map(a => `- **${a.title}**: ${a.content?.substring(0, 150)}... (${new Date(a.createdAt).toLocaleDateString()})`).join('\n')}`);
      }
    }

    // Session
    if (topics.includes('session')) {
      const sessions = await tenantDb.session.findMany({
        where: { college_id: collegeId },
        orderBy: { createdAt: 'desc' },
        take: 3
      });
      if (sessions.length > 0) {
        parts.push(`## Academic Sessions\n${sessions.map(s => `- ${s.name} ${s.isCurrent ? '(CURRENT)' : ''} | ${s.startDate ? new Date(s.startDate).toLocaleDateString() : 'N/A'} - ${s.endDate ? new Date(s.endDate).toLocaleDateString() : 'N/A'}`).join('\n')}`);
      }
    }

    // ─── Student Profile ─────────────────────────────────────────────
    if (topics.includes('my-profile') && userRole === 'student' && studentRecord) {
      parts.push(`## My Student Profile\n- **Name:** ${studentRecord.name}\n- **Father's Name:** ${studentRecord.fatherName}\n- **Roll Number:** ${studentRecord.rollNumber}\n- **Registration:** ${studentRecord.registrationNumber || 'N/A'}\n- **Class:** ${studentRecord.class}\n- **Group:** ${studentRecord.group}\n- **Section:** ${studentRecord.section || 'N/A'}\n- **Subjects:** ${(studentRecord.subjects || []).join(', ') || 'N/A'}\n- **Status:** ${studentRecord.status || 'active'}\n- **Admission Date:** ${studentRecord.admissionDate ? new Date(studentRecord.admissionDate).toLocaleDateString() : 'N/A'}`);
    }

    // ─── Student Results (with exam resolution) ──────────────────────
    if (topics.includes('my-results') && userRole === 'student' && studentRecord) {
      const results = await tenantDb.result.findMany({
        where: { college_id: collegeId, student_id: studentRecord.id, isPublished: true },
        orderBy: { createdAt: 'desc' },
        take: 20
      });
      if (results.length > 0) {
        // Resolve exam names
        const examIds = [...new Set(results.map(r => r.exam_id))];
        const exams = await tenantDb.exam.findMany({
          where: { id: { in: examIds } },
          select: { id: true, name: true, type: true }
        });
        const examMap = {};
        exams.forEach(e => { examMap[e.id] = e; });

        const resultLines = results.map(r => {
          const exam = examMap[r.exam_id] || {};
          let subjectDetail = '';
          if (r.marks && typeof r.marks === 'object') {
            try {
              const marksArr = Array.isArray(r.marks)
                ? r.marks
                : Object.entries(r.marks).map(([k, v]) => ({ subject: k, ...(typeof v === 'object' ? v : { obtained: v }) }));
              subjectDetail = marksArr.map(m =>
                `    - ${m.subject || m.name || 'Subject'}: ${m.obtained ?? m.marks ?? 'N/A'}/${m.total ?? m.totalMarks ?? '?'}`
              ).join('\n');
            } catch (e) { /* marks parsing failed, skip detail */ }
          }
          return `- **${exam.name || 'Exam'}** (${exam.type || 'N/A'}): ${r.totalObtained || 0}/${r.totalMarks || 0} = **${r.percentage || 0}%** | Grade: ${r.grade || 'N/A'}${r.position ? ' | Position: ' + r.position : ''}${r.remarks ? ' | Remarks: ' + r.remarks : ''}${subjectDetail ? '\n' + subjectDetail : ''}`;
        }).join('\n');

        const avgPercentage = Math.round(results.reduce((sum, r) => sum + (r.percentage || 0), 0) / results.length);
        const passed = results.filter(r => (r.percentage || 0) >= 40).length;
        const failed = results.length - passed;
        parts.push(`## My Exam Results\n- **Average Percentage:** ${avgPercentage}% | **Total Exams:** ${results.length} | **Passed:** ${passed} | **Failed:** ${failed}\n${resultLines}`);
      } else {
        parts.push(`## My Exam Results\nNo published results found yet.`);
      }
    }

    // ─── Student Fines & Discipline ──────────────────────────────────
    if (topics.includes('fines') && userRole === 'student' && studentRecord) {
      const fines = await tenantDb.fine.findMany({
        where: { college_id: collegeId, student_id: studentRecord.id },
        orderBy: { createdAt: 'desc' },
        take: 10
      });
      if (fines.length > 0) {
        const unpaidFines = fines.filter(f => f.status !== 'paid');
        const totalUnpaid = unpaidFines.reduce((sum, f) => sum + (f.amount || 0), 0);
        parts.push(`## My Fines & Disciplinary Records\n- **Total Fines:** ${fines.length} | **Unpaid:** ${unpaidFines.length} (Rs. ${totalUnpaid})\n${fines.map(f => `- Rs. ${f.amount} | Reason: ${f.reason} | Category: ${f.category || 'N/A'} | Status: **${f.status}** | Date: ${new Date(f.createdAt).toLocaleDateString()}`).join('\n')}`);
      } else {
        parts.push(`## My Fines & Disciplinary Records\nNo fines or disciplinary records found. ✅`);
      }
    }

    // ─── Assignments (for student's class) ───────────────────────────
    if (topics.includes('assignments') && userRole === 'student' && studentRecord) {
      try {
        const classRecord = await tenantDb.class.findFirst({
          where: { college_id: collegeId, name: studentRecord.class }
        });
        if (classRecord) {
          const sectionFilter = studentRecord.section_id ? { section_id: studentRecord.section_id } : {};
          const assignments = await tenantDb.assignment.findMany({
            where: { college_id: collegeId, class_id: classRecord.id, ...sectionFilter, status: 'active' },
            orderBy: { dueDate: 'desc' },
            take: 10
          });
          if (assignments.length > 0) {
            const subjectIds = [...new Set(assignments.map(a => a.subject_id))];
            const subjects = await tenantDb.subject.findMany({
              where: { id: { in: subjectIds } },
              select: { id: true, name: true }
            });
            const subjectMap = {};
            subjects.forEach(s => { subjectMap[s.id] = s.name; });
            const now = new Date();
            parts.push(`## My Assignments\n${assignments.map(a => {
              const isPastDue = new Date(a.dueDate) < now;
              return `- **${a.title}** (${subjectMap[a.subject_id] || 'Subject'}) | Due: ${new Date(a.dueDate).toLocaleDateString()} ${isPastDue ? '⚠️ PAST DUE' : ''} | Marks: ${a.totalMarks || 'N/A'}`;
            }).join('\n')}`);
          } else {
            parts.push(`## My Assignments\nNo active assignments found.`);
          }
        }
      } catch (e) { /* class resolution may fail */ }
    }

    // ─── Quizzes (for student's class) ───────────────────────────────
    if (topics.includes('quizzes') && userRole === 'student' && studentRecord) {
      try {
        const classRecord = await tenantDb.class.findFirst({
          where: { college_id: collegeId, name: studentRecord.class }
        });
        if (classRecord) {
          const quizzes = await tenantDb.quiz.findMany({
            where: { college_id: collegeId, class_id: classRecord.id },
            orderBy: { createdAt: 'desc' },
            take: 10
          });
          if (quizzes.length > 0) {
            const subjectIds = [...new Set(quizzes.map(q => q.subject_id))];
            const subjects = await tenantDb.subject.findMany({
              where: { id: { in: subjectIds } },
              select: { id: true, name: true }
            });
            const subjectMap = {};
            subjects.forEach(s => { subjectMap[s.id] = s.name; });
            parts.push(`## My Quizzes\n${quizzes.map(q => `- **${q.title}** (${subjectMap[q.subject_id] || 'Subject'}) | Marks: ${q.totalMarks || 'N/A'} | Status: ${q.status}`).join('\n')}`);
          }
        }
      } catch (e) { /* class resolution may fail */ }
    }
  } catch (err) {
    console.error('DB context build error:', err.message);
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
};

module.exports = { buildDatabaseContext, detectTopics };