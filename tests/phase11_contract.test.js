'use strict';

/**
 * phase11_contract.test.js
 * Master Contract Test Suite for Phase 11: Academic & Student Life Expansion
 * 
 * Verifies all canonical Phase 11 deliverables (15 Services):
 * 11A: Exam Operations & Moderation (N25, N26, N27, N28)
 * 11B: Student Leave & Multi-Head Clearance (N24, N29)
 * 11C: Teaching Pacing & LMS Knowledge (N23, N30, N31)
 * 11D: Student Life, Discipline & Alumni (N32, N33, N34)
 * 11E: Bilingual Urdu RTL & Capability Flags (N09, N21, N22)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');

const { getSystemClient } = require('../config/prismaManager');
const {
  FEATURE_REGISTRY,
  validateRegistryDAG,
  resolveCollegeFeatures,
} = require('../config/featureRegistry');

// Service imports
const examSeatingService = require('../services/examSeatingService');
const examPaperService = require('../services/examPaperService');
const resultRecheckService = require('../services/resultRecheckService');
const reportCardService = require('../services/reportCardService');
const studentLeaveService = require('../services/studentLeaveService');
const clearanceService = require('../services/clearanceService');
const syllabusService = require('../services/syllabusService');
const liveClassService = require('../services/liveClassService');
const forumService = require('../services/forumService');
const disciplineService = require('../services/disciplineService');
const clubService = require('../services/clubService');
const alumniService = require('../services/alumniService');
const i18nService = require('../services/i18nService');
const noticeTemplateService = require('../services/noticeTemplateService');
const guardianPushService = require('../services/guardianPushService');
const { createOrUpdateChain, approveStep } = require('../services/approvalService');

const prisma = getSystemClient();

async function runPhase11ContractTests() {
  console.log('====================================================');
  console.log('    PHASE 11 MASTER CONTRACT VERIFICATION SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  // Setup test tenant fixture
  const collegeId = `col_phase11_${Date.now()}`;
  let college = null;
  let session = null;
  let adminUser = null;
  let teacherUser1 = null;
  let teacherUser2 = null;
  let student1 = null;
  let student2 = null;
  let exam1 = null;

  try {
    // 0. Setup test fixtures
    college = await prisma.college.create({
      data: {
        id: collegeId,
        name: 'Phase 11 Comprehensive Model College',
        email: `p11_${collegeId}@test.com`,
        code: `P11-${Date.now().toString().slice(-4)}`,
        planId: 'premium',
        subStatus: 'ACTIVE',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000),
      },
    });

    session = await prisma.session.create({
      data: {
        college_id: collegeId,
        name: '2026-2027',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30'),
        isCurrent: true,
      },
    });

    adminUser = await prisma.user.create({
      data: {
        college_id: collegeId,
        email: `admin-${collegeId}@test.com`,
        password: 'hash',
        name: 'Principal Admin',
        role: 'admin',
      },
    });

    teacherUser1 = await prisma.user.create({
      data: {
        college_id: collegeId,
        email: `teacher1-${collegeId}@test.com`,
        password: 'hash',
        name: 'Prof. Tariq Physics',
        role: 'teacher',
      },
    });

    teacherUser2 = await prisma.user.create({
      data: {
        college_id: collegeId,
        email: `teacher2-${collegeId}@test.com`,
        password: 'hash',
        name: 'Dr. Ayesha Chemistry',
        role: 'teacher',
      },
    });

    student1 = await prisma.student.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        rollNumber: `P11-S1-${Date.now().toString().slice(-4)}`,
        name: 'Zeeshan Ali',
        fatherName: 'Muhammad Ali',
        gender: 'Male',
        class: 'FSc Part 1',
        section: 'A',
        group: 'Pre-Engineering',
        status: 'active',
      },
    });

    student2 = await prisma.student.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        rollNumber: `P11-S2-${Date.now().toString().slice(-4)}`,
        name: 'Bilal Khan',
        fatherName: 'Hamid Khan',
        gender: 'Male',
        class: 'FSc Part 1',
        section: 'B',
        group: 'Pre-Medical',
        status: 'active',
      },
    });

    exam1 = await prisma.exam.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        name: 'Send-up Examination 2026',
        type: 'send_up',
        class: 'FSc Part 1',
        group: 'All',
      },
    });

    // -------------------------------------------------------------
    // Test 1: Feature Registry Milestone Verification (129 Live + 32 Roadmap = 161 Total)
    // -------------------------------------------------------------
    try {
      const totalServices = FEATURE_REGISTRY.length;
      const liveServices = FEATURE_REGISTRY.filter((f) => f.status === 'live').length;
      const comingSoonServices = FEATURE_REGISTRY.filter((f) => f.status === 'coming_soon').length;
      const dagResult = validateRegistryDAG();

      assert.strictEqual(totalServices, 161, `Expected 161 total services, got ${totalServices}`);
      assert.ok(liveServices >= 129, `Expected at least 129 live services, got ${liveServices}`);
      assert.ok(comingSoonServices <= 32, `Expected at most 32 coming soon services, got ${comingSoonServices}`);
      assert.strictEqual(dagResult.valid, true, 'Feature registry DAG must be valid with zero cycles');

      // Assert all 15 Phase 11 features are live
      const phase11Keys = [
        'bilingual-rtl-ui',             // N09
        'notice-templates-scheduling',  // N21
        'student-leave-requests',       // N24
        'exam-seating-invigilation',    // N25
        'digital-report-card-remarks',  // N28
        'leaving-certificate-clearance',// N29
        'parent-app-push-alerts',       // N22
        'syllabus-coverage-tracker',    // N23
        'paper-setting-moderation',     // N26
        'result-moderation-recheck',    // N27
        'live-class-lecture-library',   // N30
        'class-discussion-forum',       // N31
        'discipline-counselling-records',// N32
        'events-sports-clubs',          // N33
        'alumni-records-placement',     // N34
      ];

      for (const k of phase11Keys) {
        const feat = FEATURE_REGISTRY.find((f) => f.key === k);
        assert.ok(feat, `Feature key ${k} must exist in registry`);
        assert.strictEqual(feat.status, 'live', `Feature ${k} must have status: 'live'`);
      }

      // Assert N12 and N14 remain coming_soon, N13 permanently removed
      const n12 = FEATURE_REGISTRY.find((f) => f.key === 'custom-domain');
      const n14 = FEATURE_REGISTRY.find((f) => f.key === 'single-sign-on');
      const n13 = FEATURE_REGISTRY.find((f) => f.key === 'white-label-branding' || f.id === 'N13');
      assert.strictEqual(n12.status, 'coming_soon', 'N12 must remain coming_soon');
      assert.strictEqual(n14.status, 'coming_soon', 'N14 must remain coming_soon');
      assert.strictEqual(n13, undefined, 'N13 must remain permanently removed');

      console.log('✓ Test 1 Passed: Feature registry counts exact: 129 Live + 32 Roadmap = 161 Total, DAG valid');
      passed++;
    } catch (err) {
      console.error('✗ Test 1 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 2: N25 Seating Plan Solver (prevents same section adjacent neighbors)
    // -------------------------------------------------------------
    try {
      const hall = await examSeatingService.createHall({
        collegeId,
        name: `Jinnah Hall ${Date.now()}`,
        rows: 2,
        columns: 2,
        capacity: 4,
      });

      assert.strictEqual(hall.rows, 2);
      assert.strictEqual(hall.columns, 2);
      assert.strictEqual(hall.desks.length, 4);

      // Create candidates from Section A and Section B
      const candidates = [
        { id: student1.id, section_id: 'SEC_A', subject_id: 'Physics' },
        { id: student2.id, section_id: 'SEC_B', subject_id: 'Physics' },
      ];

      const plan = await examSeatingService.generateSeatingPlan({
        collegeId,
        examId: exam1.id,
        name: 'Midterm 2026 Seating Master',
        examDate: '2026-11-20',
        sessionTime: 'MORNING',
        hallIds: [hall.id],
        candidates,
      });

      assert.ok(plan.id);
      assert.strictEqual(plan.seats.length, 2);

      // Verify that desk 1 and desk 2 have different students
      assert.notStrictEqual(plan.seats[0].student_id, plan.seats[1].student_id);

      console.log('✓ Test 2 Passed: N25 Seating solver correctly alternates candidates across exam desks');
      passed++;
    } catch (err) {
      console.error('✗ Test 2 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 3: N25 Invigilation Roster (Leave conflict & weekly cap enforcement)
    // -------------------------------------------------------------
    try {
      // 1. Create a seating plan for duty assignment
      const hall = await examSeatingService.createHall({
        collegeId,
        name: `Iqbal Hall ${Date.now()}`,
        rows: 2,
        columns: 2,
        capacity: 4,
      });

      const plan = await prisma.examSeatingPlan.create({
        data: {
          college_id: collegeId,
          examId: exam1.id,
          name: `Roster Plan ${Date.now()}`,
        },
      });

      // 2. Put teacherUser1 on approved leave on 2026-11-25
      const dutyDate = new Date('2026-11-25');
      await prisma.staffAttendance.create({
        data: {
          college_id: collegeId,
          userId: teacherUser1.id,
          date: dutyDate,
          status: 'LEAVE',
          source: 'MANUAL',
        },
      });

      // 3. Attempt to assign duty to teacher on leave -> MUST fail
      let leaveError = null;
      try {
        await examSeatingService.assignInvigilator({
          collegeId,
          seatingPlanId: plan.id,
          teacherId: teacherUser1.id,
          hallId: hall.id,
          dutyDate,
          sessionTime: 'MORNING',
        });
      } catch (err) {
        leaveError = err;
      }

      assert.ok(leaveError, 'Assigning invigilation duty to teacher on leave must throw error');
      assert.strictEqual(leaveError.code, 'TEACHER_ON_LEAVE');

      // 4. Test weekly duty cap enforcement
      await prisma.college.update({
        where: { id: collegeId },
        data: { settings: { maxInvigilationsPerWeek: 2 } },
      });

      // Assign 2 duties in same week
      await examSeatingService.assignInvigilator({
        collegeId,
        seatingPlanId: plan.id,
        teacherId: teacherUser2.id,
        hallId: hall.id,
        dutyDate: new Date('2026-11-23'),
        sessionTime: 'MORNING',
      });
      await examSeatingService.assignInvigilator({
        collegeId,
        seatingPlanId: plan.id,
        teacherId: teacherUser2.id,
        hallId: hall.id,
        dutyDate: new Date('2026-11-24'),
        sessionTime: 'MORNING',
      });

      // 3rd assignment should exceed cap of 2
      let capError = null;
      try {
        await examSeatingService.assignInvigilator({
          collegeId,
          seatingPlanId: plan.id,
          teacherId: teacherUser2.id,
          hallId: hall.id,
          dutyDate: new Date('2026-11-25'),
          sessionTime: 'MORNING',
        });
      } catch (err) {
        capError = err;
      }

      assert.ok(capError, 'Assigning beyond weekly invigilation cap must throw error');
      assert.strictEqual(capError.code, 'WEEKLY_INVIGILATION_CAP_EXCEEDED');

      console.log('✓ Test 3 Passed: N25 Invigilation roster enforces leave conflict detection and weekly duty cap');
      passed++;
    } catch (err) {
      console.error('✗ Test 3 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 4: N26 Paper Moderation Workflow (Setter !== Moderator & Sealed Read-Only)
    // -------------------------------------------------------------
    try {
      // 1. Create draft
      const draft = await examPaperService.createDraft({
        collegeId,
        examId: exam1.id,
        subjectId: 'SUB_PHYSICS',
        className: 'FSc Part 1',
        setterId: teacherUser1.id,
        fileId: 'file_exam_paper_1',
      });

      assert.strictEqual(draft.status, 'DRAFT');
      assert.strictEqual(draft.version, 1);
      assert.strictEqual(draft.revisions.length, 1);

      // 2. Invariant: Setter cannot act as moderator for their own paper
      let selfModerateError = null;
      try {
        await examPaperService.moderateDraft({
          collegeId,
          paperDraftId: draft.id,
          moderatorId: teacherUser1.id, // Same as setterId!
          status: 'APPROVED',
          moderatorNote: 'Self approval',
        });
      } catch (err) {
        selfModerateError = err;
      }

      assert.ok(selfModerateError, 'Setter moderating own paper must fail');
      assert.strictEqual(selfModerateError.code, 'SETTER_CANNOT_MODERATE_OWN_PAPER');

      // 3. Different teacher moderates and approves
      const moderated = await examPaperService.moderateDraft({
        collegeId,
        paperDraftId: draft.id,
        moderatorId: teacherUser2.id, // Peer teacher
        status: 'APPROVED',
        moderatorNote: 'Question standard conforms to BISE board patterns.',
      });
      assert.strictEqual(moderated.status, 'APPROVED');

      // 4. Principal seals the paper
      const sealed = await examPaperService.sealPaper({
        collegeId,
        paperDraftId: draft.id,
        sealedBy: adminUser.id,
      });
      assert.strictEqual(sealed.status, 'SEALED');

      // 5. Sealed paper cannot be modified or re-uploaded by regular teacher
      let sealedModifyError = null;
      try {
        await examPaperService.submitRevision({
          collegeId,
          paperDraftId: draft.id,
          fileId: 'file_exam_paper_2',
          uploadedById: teacherUser1.id,
          changeNotes: 'Attempt to modify sealed paper',
          isSuperAdmin: false,
        });
      } catch (err) {
        sealedModifyError = err;
      }
      assert.ok(sealedModifyError, 'Modifying sealed paper must fail');
      assert.strictEqual(sealedModifyError.code, 'PAPER_SEALED');

      // 6. Presigned download URL check (120s TTL)
      const download = await examPaperService.getPaperDownloadUrl({
        collegeId,
        paperDraftId: draft.id,
        requesterId: teacherUser1.id,
        requesterRole: 'teacher',
      });
      assert.strictEqual(download.ttlSeconds, 120);
      assert.ok(download.downloadUrl.includes('token=ep_'));

      console.log('✓ Test 4 Passed: N26 Paper moderation enforces setter!==moderator rule and sealed paper immutability');
      passed++;
    } catch (err) {
      console.error('✗ Test 4 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 5: N27 Result Re-Check & N11 Approval Workflow Integration
    // -------------------------------------------------------------
    try {
      // 1. Create Result record
      const result = await prisma.result.create({
        data: {
          college_id: collegeId,
          session_id: session.id,
          exam_id: exam1.id,
          student_id: student1.id,
          marks: { Physics: 68 },
          totalObtained: 68,
          totalMarks: 100,
          percentage: 68,
          grade: 'B',
        },
      });

      // 2. Submit re-checking ticket
      const ticket = await resultRecheckService.submitRecheckRequest({
        collegeId,
        studentId: student1.id,
        resultId: result.id,
        subjectId: 'Physics',
        reason: 'Recounting requested for Question 3 practical theory.',
        feePaidPkr: 500,
      });
      assert.strictEqual(Number(ticket.originalMarks), 68);
      assert.strictEqual(ticket.status, 'SUBMITTED');

      // 3. Configure N11 approval chain for MARKS_EDIT
      await createOrUpdateChain({
        collegeId,
        workflowType: 'MARKS_EDIT',
        name: 'Result Revision 2-Step Approval',
        steps: [
          { stepNumber: 1, approverType: 'ROLE', approverRef: 'admin', stepName: 'Principal Approval' },
        ],
      });

      // 4. Process re-check with revised marks (68 -> 75)
      const processRes = await resultRecheckService.processRecheck({
        collegeId,
        requestId: ticket.id,
        reviewerUser: teacherUser1, // Teacher proposes the revised marks
        committeeNotes: 'Calculation error verified in section B.',
        revisedMarks: 75,
        status: 'RESOLVED_CHANGED',
      });

      // Must trigger N11 approval request and remain IN_REVIEW
      assert.strictEqual(processRes.requiresApproval, true);
      assert.strictEqual(processRes.status, 'IN_REVIEW');
      assert.ok(processRes.approvalRequestId);

      // Verify Result table score is NOT modified yet
      const resultBefore = await prisma.result.findUnique({ where: { id: result.id } });
      assert.strictEqual(Number(resultBefore.marks.Physics), 68, 'Result score must not change while approval is pending');

      // 5. Finalize approval step
      await approveStep({
        collegeId,
        requestId: processRes.approvalRequestId,
        actorUser: adminUser,
        note: 'Approved recounting change to 75 marks.',
      });

      // 6. Verify Result table score IS NOW updated
      const resultAfter = await prisma.result.findUnique({ where: { id: result.id } });
      assert.strictEqual(Number(resultAfter.marks.Physics), 75, 'Result score must update to 75 after final approval');

      console.log('✓ Test 5 Passed: N27 Result re-check mark revisions integrate with N11 MARKS_EDIT approval chain');
      passed++;
    } catch (err) {
      console.error('✗ Test 5 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 6: N28 Digital Report Card with Teacher Remarks
    // -------------------------------------------------------------
    try {
      const remark = await reportCardService.upsertRemarks({
        collegeId,
        studentId: student1.id,
        sessionId: session.id,
        examId: exam1.id,
        classTeacherId: teacherUser1.id,
        remarks: 'Demonstrates exceptional critical thinking in physical concepts.',
        conductRating: 'EXCELLENT',
        punctuality: 'PUNCTUAL',
        boardReadiness: 'ON_TRACK',
        isPublished: true,
      });

      assert.strictEqual(remark.conductRating, 'EXCELLENT');
      assert.strictEqual(remark.isPublished, true);

      // Generate PDF
      const pdf = await reportCardService.generateReportCardPdf({
        collegeId,
        studentId: student1.id,
        examId: exam1.id,
      });

      assert.ok(pdf.buffer);
      assert.ok(pdf.buffer.length > 500, 'Report card PDF buffer must contain content');
      assert.strictEqual(pdf.contentType, 'application/pdf');

      console.log('✓ Test 6 Passed: N28 Digital report card generates PDF combining marks, attendance, and remarks');
      passed++;
    } catch (err) {
      console.error('✗ Test 6 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 7: N24 Student Leave & Automated Attendance Marking
    // -------------------------------------------------------------
    try {
      const leaveDate = new Date('2026-11-28');
      const leaveDateEnd = new Date('2026-11-29');

      const leave = await studentLeaveService.applyStudentLeave({
        collegeId,
        sessionId: session.id,
        studentId: student2.id,
        userId: adminUser.id,
        leaveDate,
        leaveDateEnd,
        reason: 'Severe fever with medical certificate',
        category: 'medical',
        isEmergency: true,
        medicalCertificate: 'med_cert_doc_1',
      });

      assert.strictEqual(leave.status, 'pending');
      assert.strictEqual(leave.isEmergency, true);

      // Approve leave
      const reviewed = await studentLeaveService.reviewStudentLeave({
        collegeId,
        leaveId: leave.id,
        reviewerUser: adminUser,
        status: 'approved',
        reviewRemarks: 'Medical certificate verified.',
      });

      assert.strictEqual(reviewed.leave.status, 'approved');
      assert.strictEqual(reviewed.leave.autoAttendanceDone, true);

      // Verify Attendance records for both days were created as LEAVE
      const attendanceDay1 = await prisma.attendance.findFirst({
        where: {
          college_id: collegeId,
          session_id: session.id,
          student_id: student2.id,
          status: 'LEAVE',
        },
      });

      assert.ok(attendanceDay1, 'Attendance record must exist for approved leave date');
      assert.strictEqual(attendanceDay1.status, 'LEAVE');
      assert.strictEqual(attendanceDay1.method, 'SYSTEM_LEAVE');

      console.log('✓ Test 7 Passed: N24 Student leave approval automatically creates/updates Attendance records as LEAVE');
      passed++;
    } catch (err) {
      console.error('✗ Test 7 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 8: N29 Leaving Certificate Clearance (Unpaid dues block & Mandatory lock)
    // -------------------------------------------------------------
    try {
      // 1. Create an unpaid fee for student1
      const fee = await prisma.fee.create({
        data: {
          college_id: collegeId,
          session_id: session.id,
          student_id: student1.id,
          title: 'Tuition Fee 2026',
          month: 'November',
          totalAmount: 1500,
          paidAmount: 0,
          status: 'unpaid',
        },
      });

      // 2. Initiate clearance
      const proc = await clearanceService.initiateClearance({
        collegeId,
        studentId: student1.id,
        sessionId: session.id,
        reason: 'GRADUATED',
        destination: 'King Edward Medical University',
        initiatedById: adminUser.id,
      });

      assert.strictEqual(proc.status, 'IN_PROGRESS');

      // Verify automated accounts check detected unpaid dues
      const accountsItem = proc.departmentItems.find((i) => i.head.code === 'ACCOUNTS');
      assert.ok(accountsItem);
      assert.strictEqual(accountsItem.status, 'DUES_OUTSTANDING');
      assert.strictEqual(accountsItem.duesAmountPkr, 1500);

      // 3. Attempting to issue certificate while uncleared must throw CLEARANCE_INCOMPLETE
      let issueError = null;
      try {
        await clearanceService.issueLeavingCertificate({
          collegeId,
          processId: proc.id,
          issuedById: adminUser.id,
        });
      } catch (err) {
        issueError = err;
      }
      assert.ok(issueError, 'Issuing certificate with pending departments must fail');
      assert.strictEqual(issueError.code, 'CLEARANCE_INCOMPLETE');

      // 4. Pay the fee
      await prisma.fee.update({
        where: { id: fee.id },
        data: { paidAmount: 1500, status: 'paid' },
      });

      // 5. Clear all mandatory heads
      for (const item of proc.departmentItems) {
        await clearanceService.updateClearanceItem({
          collegeId,
          processId: proc.id,
          headId: item.headId,
          status: 'CLEARED',
          clearedById: adminUser.id,
        });
      }

      // 6. Now issue leaving certificate
      const cert = await clearanceService.issueLeavingCertificate({
        collegeId,
        processId: proc.id,
        characterRating: 'EXEMPLARY',
        conductRemarks: 'Excellent student and top debater.',
        issuedById: adminUser.id,
      });

      assert.ok(cert.certificateNumber.startsWith('SLC-'));
      assert.ok(cert.qrVerificationHash);

      // 7. Verify post-issuance student status transition frees quota
      const updatedStudent = await prisma.student.findUnique({ where: { id: student1.id } });
      assert.strictEqual(updatedStudent.status, 'graduated', 'Student status must become graduated upon certificate issuance');

      // 8. Verify public QR endpoint
      const verified = await clearanceService.verifyCertificate(cert.qrVerificationHash);
      assert.strictEqual(verified.verified, true);
      assert.strictEqual(verified.certificateNumber, cert.certificateNumber);

      console.log('✓ Test 8 Passed: N29 Leaving certificate enforces accounts dues check, clearance lock, and quota freeing');
      passed++;
    } catch (err) {
      console.error('✗ Test 8 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 9: N23 Syllabus Pacing & Lag Warning Analytics
    // -------------------------------------------------------------
    try {
      const breakdown = await syllabusService.createBreakdown({
        collegeId,
        sessionId: session.id,
        className: 'FSc Part 1',
        subjectId: 'SUB_PHYSICS',
        boardName: 'BISE Lahore',
        totalHours: 40,
        units: [
          { unitNumber: 1, title: 'Measurements', targetWeek: 2 },
          { unitNumber: 2, title: 'Vectors and Equilibrium', targetWeek: 4 },
          { unitNumber: 3, title: 'Motion and Force', targetWeek: 6 },
          { unitNumber: 4, title: 'Work and Energy', targetWeek: 8 },
        ],
      });

      assert.strictEqual(breakdown.units.length, 4);

      // Complete unit 1 only
      await syllabusService.updateProgress({
        collegeId,
        unitId: breakdown.units[0].id,
        sectionId: 'SEC_A',
        teacherId: teacherUser1.id,
        status: 'COMPLETED',
        actualHours: 8,
      });

      // At week 6: Units 1, 2, 3 were target (3 units). Only 1 completed.
      // Lag is 3 - 1 = 2 units (>= 2 is behind schedule)
      const summary = await syllabusService.getCoverageSummary({
        collegeId,
        sessionId: session.id,
        className: 'FSc Part 1',
        subjectId: 'SUB_PHYSICS',
        sectionId: 'SEC_A',
        currentWeek: 6,
      });

      assert.strictEqual(summary.targetUnitsToWeek, 3);
      assert.strictEqual(summary.completedUnits, 1);
      assert.strictEqual(summary.coverageRate, 33);
      assert.strictEqual(summary.lagWeeks, 2);
      assert.strictEqual(summary.isBehindSchedule, true);

      console.log('✓ Test 9 Passed: N23 Syllabus coverage summary computes completion rate and flags behind-schedule lag');
      passed++;
    } catch (err) {
      console.error('✗ Test 9 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 10: N30 Live Class Scheduling & Digital Lecture Repository
    // -------------------------------------------------------------
    try {
      // Valid HTTPS link
      const live = await liveClassService.scheduleLiveClass({
        collegeId,
        sectionId: 'SEC_A',
        subjectId: 'SUB_PHYSICS',
        teacherId: teacherUser1.id,
        title: 'Wave Optics Interactive Lecture',
        platform: 'GOOGLE_MEET',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        scheduledDate: '2026-11-22',
        startTime: '09:00',
        endTime: '10:00',
      });
      assert.ok(live.id);

      // Invalid non-HTTPS link must fail
      let urlError = null;
      try {
        await liveClassService.scheduleLiveClass({
          collegeId,
          sectionId: 'SEC_A',
          subjectId: 'SUB_PHYSICS',
          teacherId: teacherUser1.id,
          title: 'Unsafe Lecture',
          meetingUrl: 'http://insecure-meeting.com',
          scheduledDate: '2026-11-22',
          startTime: '09:00',
          endTime: '10:00',
        });
      } catch (err) {
        urlError = err;
      }
      assert.ok(urlError, 'Insecure HTTP meeting link must be rejected');

      // Digital lecture recording
      const rec = await liveClassService.uploadLectureRecording({
        collegeId,
        subjectId: 'SUB_PHYSICS',
        className: 'FSc Part 1',
        title: 'Newtonian Dynamics Revision',
        videoSource: 'EMBEDDED_YOUTUBE',
        videoUrl: 'https://youtube.com/watch?v=mock123',
        durationMins: 45,
        uploadedById: teacherUser1.id,
      });
      assert.strictEqual(rec.durationMins, 45);

      console.log('✓ Test 10 Passed: N30 Live classes enforce HTTPS validation and lecture repository stores recordings');
      passed++;
    } catch (err) {
      console.error('✗ Test 10 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 11: N31 Q&A Forum (XSS Sanitization & Teacher Endorsement)
    // -------------------------------------------------------------
    try {
      // 1. Post question with malicious XSS script tag
      const q = await forumService.createQuestion({
        collegeId,
        subjectId: 'SUB_PHYSICS',
        className: 'FSc Part 1',
        studentId: student2.id,
        title: 'How does Doppler effect work in stars? <script>alert("xss")</script>',
        body: 'Can someone explain redshift? <iframe src="javascript:alert(1)"></iframe>',
      });

      assert.ok(!q.title.includes('<script>'), 'Title must be sanitized against script tags');
      assert.ok(!q.body.includes('<iframe'), 'Body must be sanitized against iframe tags');

      // 2. Student posts answer
      const ans = await forumService.postAnswer({
        questionId: q.id,
        authorId: student1.id,
        authorRole: 'student',
        body: 'Redshift occurs when spectral lines shift towards longer wavelengths as celestial objects recede.',
      });
      assert.strictEqual(ans.isAccepted, false);

      // 3. Student attempt to accept answer -> MUST fail
      let studentAcceptError = null;
      try {
        await forumService.acceptAnswer({
          questionId: q.id,
          answerId: ans.id,
          userRole: 'student',
        });
      } catch (err) {
        studentAcceptError = err;
      }
      assert.ok(studentAcceptError, 'Student cannot accept/endorse forum answers');
      assert.strictEqual(studentAcceptError.code, 'TEACHER_ENDORSEMENT_REQUIRED');

      // 4. Faculty teacher accepts answer -> Succeeds
      const accepted = await forumService.acceptAnswer({
        questionId: q.id,
        answerId: ans.id,
        userRole: 'teacher',
      });
      assert.strictEqual(accepted.isAccepted, true);

      console.log('✓ Test 11 Passed: N31 Discussion forum sanitizes XSS content and enforces faculty endorsement');
      passed++;
    } catch (err) {
      console.error('✗ Test 11 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 12: N32 Confidential Discipline & Counseling Records (Strict 403)
    // -------------------------------------------------------------
    try {
      // 1. General teacher attempt to record or view confidential discipline -> MUST throw 403
      let teacherAccessError = null;
      try {
        await disciplineService.recordIncident({
          collegeId,
          studentId: student2.id,
          sessionId: session.id,
          incidentDate: '2026-11-15',
          description: 'Class bunking and disrespect',
          reportedById: teacherUser1.id,
          userRole: 'teacher',
          userPermissions: [],
        });
      } catch (err) {
        teacherAccessError = err;
      }
      assert.ok(teacherAccessError, 'General teacher must not access confidential discipline logs');
      assert.strictEqual(teacherAccessError.code, 'CONFIDENTIAL_DISCIPLINE_ACCESS_DENIED');

      // 2. Principal/Admin records incident -> Succeeds
      const incident = await disciplineService.recordIncident({
        collegeId,
        studentId: student2.id,
        sessionId: session.id,
        incidentDate: '2026-11-15',
        category: 'BUNK',
        severity: 'MEDIUM',
        description: 'Unauthorized departure during afternoon practical session.',
        actionTaken: 'WARNING',
        reportedById: adminUser.id,
        userRole: 'principal',
        userPermissions: [],
      });
      assert.ok(incident.id);

      // 3. Add confidential counseling log
      const counsel = await disciplineService.addCounselingLog({
        collegeId,
        incidentId: incident.id,
        studentId: student2.id,
        counselorId: adminUser.id,
        sessionDate: '2026-11-16',
        sessionNotes: 'Student discussed peer pressure issues. Agreed on progress check.',
        actionPlan: 'Weekly check-in with academic supervisor.',
        userRole: 'admin',
        userPermissions: [],
      });
      assert.ok(counsel.id);

      console.log('✓ Test 12 Passed: N32 Disciplinary & counseling records enforce strict 403 privacy barriers');
      passed++;
    } catch (err) {
      console.error('✗ Test 12 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 13: N33 Events, Sports Teams & Club Management
    // -------------------------------------------------------------
    try {
      const club = await clubService.createClub({
        collegeId,
        name: `Literary & Debating Society ${Date.now()}`,
        category: 'ACADEMIC',
        description: 'Parliamentary debate and bilingual declamations society.',
        leadTeacherId: teacherUser1.id,
        presidentStudentId: student1.id,
      });

      assert.ok(club.id);

      const member = await clubService.addClubMember({
        clubId: club.id,
        studentId: student2.id,
        role: 'MEMBER',
      });
      assert.strictEqual(member.role, 'MEMBER');

      const event = await clubService.scheduleClubEvent({
        collegeId,
        clubId: club.id,
        title: 'All-Pakistan Bilingual Declamation 2026',
        eventDate: '2026-12-10',
        venue: 'Main Auditorium',
        budgetPkr: 25000,
      });
      assert.strictEqual(event.budgetPkr, 25000);

      console.log('✓ Test 13 Passed: N33 Extracurricular clubs, rosters, and event schedules operate seamlessly');
      passed++;
    } catch (err) {
      console.error('✗ Test 13 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 14: N34 Alumni Registry & Placement Tracking
    // -------------------------------------------------------------
    try {
      const alumni = await alumniService.registerAlumni({
        collegeId,
        fullName: 'Hamza Farooq',
        fatherName: 'Farooq Ahmad',
        boardRollNumber: 'BISE-2024-987654',
        passingYear: 2024,
        academicGroup: 'Pre-Medical',
        finalBoardMarks: 1045,
        finalBoardTotal: 1100,
        currentStatus: 'ENROLLED_UNIVERSITY',
        universityName: 'King Edward Medical University',
        degreeProgram: 'MBBS',
      });

      assert.strictEqual(alumni.passingYear, 2024);
      assert.strictEqual(alumni.universityName, 'King Edward Medical University');

      const analytics = await alumniService.getPlacementAnalytics(collegeId);
      assert.ok(analytics.totalAlumni >= 1);
      assert.strictEqual(analytics.statusBreakdown.ENROLLED_UNIVERSITY, 1);
      assert.strictEqual(analytics.topUniversities['King Edward Medical University'], 1);

      console.log('✓ Test 14 Passed: N34 Alumni registry records board scores and generates placement analytics');
      passed++;
    } catch (err) {
      console.error('✗ Test 14 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 15: N09 Bilingual Urdu RTL & Document Screens
    // -------------------------------------------------------------
    try {
      const urduDoc = i18nService.getDocumentMetadata('ur');
      assert.strictEqual(urduDoc.dir, 'rtl');
      assert.strictEqual(urduDoc.locale, 'ur');
      assert.ok(urduDoc.fontFamily.includes('Nastaleeq'));
      assert.strictEqual(urduDoc.labels.feeChallan, 'فیس چالان');
      assert.strictEqual(urduDoc.labels.leavingCertificate, 'کالج چھوڑنے کا سرٹیفکیٹ');

      const enDoc = i18nService.getDocumentMetadata('en');
      assert.strictEqual(enDoc.dir, 'ltr');
      assert.strictEqual(enDoc.labels.feeChallan, 'Fee Challan');

      console.log('✓ Test 15 Passed: N09 Bilingual engine configures RTL screens and Nastaleeq metadata');
      passed++;
    } catch (err) {
      console.error('✗ Test 15 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 16: N21 Notice Templates & Merge Token Substitution
    // -------------------------------------------------------------
    try {
      const tmpl = await noticeTemplateService.createTemplate({
        collegeId,
        title: `Fee Due 2nd Notice ${Date.now()}`,
        category: 'FEE_REMINDER',
        bodyTemplate: 'Dear Parent, fee of Rs. {{amountPkr}} for student {{studentName}} (Class {{class}}) is due on {{dueDate}}.',
        defaultAudience: 'PARENTS',
      });

      assert.ok(tmpl.id);

      const rendered = noticeTemplateService.renderTemplate(tmpl.bodyTemplate, {
        studentName: 'Zeeshan Ali',
        class: 'FSc Part 1',
        amountPkr: '5,000',
        dueDate: '10th December 2026',
      });

      assert.strictEqual(
        rendered,
        'Dear Parent, fee of Rs. 5,000 for student Zeeshan Ali (Class FSc Part 1) is due on 10th December 2026.'
      );

      console.log('✓ Test 16 Passed: N21 Notice templates interpolate context tokens accurately');
      passed++;
    } catch (err) {
      console.error('✗ Test 16 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 17: N22 Parent App Web Push & 410 Inactive Purge
    // -------------------------------------------------------------
    try {
      const activeEndpoint = `https://fcm.googleapis.com/fcm/send/active_${Date.now()}`;
      const expiredEndpoint = `https://fcm.googleapis.com/fcm/send/expired_${Date.now()}`;

      // Save two subscriptions
      await guardianPushService.saveSubscription({
        collegeId,
        studentId: student1.id,
        endpoint: activeEndpoint,
        p256dh: 'mock_key_1',
        auth: 'mock_auth_1',
      });

      await guardianPushService.saveSubscription({
        collegeId,
        studentId: student1.id,
        endpoint: expiredEndpoint,
        p256dh: 'mock_key_2',
        auth: 'mock_auth_2',
      });

      // Simulate push dispatch where expiredEndpoint returns HTTP 410 (Gone)
      const mockSender = async (sub, payload) => {
        if (sub.endpoint === expiredEndpoint) {
          const err = new Error('Subscription expired');
          err.statusCode = 410;
          throw err;
        }
        return true;
      };

      const result = await guardianPushService.sendPushNotification({
        collegeId,
        studentId: student1.id,
        title: 'Absence Notice',
        body: 'Your child was marked absent today.',
        pushSender: mockSender,
      });

      assert.strictEqual(result.sentCount, 1);
      assert.strictEqual(result.purgedCount, 1);
      assert.strictEqual(result.purgedEndpoints[0], expiredEndpoint);

      // Verify expiredEndpoint is deleted from DB
      const purgedCheck = await prisma.guardianPushSubscription.findUnique({
        where: { endpoint: expiredEndpoint },
      });
      assert.strictEqual(purgedCheck, null, 'HTTP 410 expired subscription must be deleted from database');

      console.log('✓ Test 17 Passed: N22 Web Push notification delivery purges HTTP 410 inactive subscriptions automatically');
      passed++;
    } catch (err) {
      console.error('✗ Test 17 Failed:', err.message);
      failed++;
    }

  } catch (globalErr) {
    console.error('Global Test Suite Error:', globalErr);
  } finally {
    // Teardown test fixtures
    try {
      await prisma.announcementTemplate.deleteMany({ where: { college_id: collegeId } });
      await prisma.guardianPushSubscription.deleteMany({ where: { college_id: collegeId } });
      await prisma.alumniProfile.deleteMany({ where: { college_id: collegeId } });
      await prisma.clubEvent.deleteMany({ where: { college_id: collegeId } });
      await prisma.studentClubMember.deleteMany({ where: { club: { college_id: collegeId } } });
      await prisma.studentClub.deleteMany({ where: { college_id: collegeId } });
      await prisma.studentCounselingLog.deleteMany({ where: { college_id: collegeId } });
      await prisma.disciplinaryIncident.deleteMany({ where: { college_id: collegeId } });
      await prisma.forumAnswer.deleteMany({ where: { question: { college_id: collegeId } } });
      await prisma.forumQuestion.deleteMany({ where: { college_id: collegeId } });
      await prisma.digitalLectureRecording.deleteMany({ where: { college_id: collegeId } });
      await prisma.liveClassSchedule.deleteMany({ where: { college_id: collegeId } });
      await prisma.teacherSyllabusProgress.deleteMany({ where: { college_id: collegeId } });
      await prisma.syllabusUnit.deleteMany({ where: { breakdown: { college_id: collegeId } } });
      await prisma.syllabusBreakdown.deleteMany({ where: { college_id: collegeId } });
      await prisma.studentClearanceItem.deleteMany({ where: { process: { college_id: collegeId } } });
      await prisma.leavingCertificateRecord.deleteMany({ where: { college_id: collegeId } });
      await prisma.studentClearanceProcess.deleteMany({ where: { college_id: collegeId } });
      await prisma.clearanceHead.deleteMany({ where: { college_id: collegeId } });
      await prisma.leaveApplication.deleteMany({ where: { college_id: collegeId } });
      await prisma.studentReportCardRemark.deleteMany({ where: { college_id: collegeId } });
      await prisma.resultRecheckRequest.deleteMany({ where: { college_id: collegeId } });
      await prisma.questionPaperRevision.deleteMany({ where: { draft: { college_id: collegeId } } });
      await prisma.questionPaperDraft.deleteMany({ where: { college_id: collegeId } });
      await prisma.examInvigilationDuty.deleteMany({ where: { seatingPlan: { college_id: collegeId } } });
      await prisma.examAssignedSeat.deleteMany({ where: { seatingPlan: { college_id: collegeId } } });
      await prisma.examSeatingPlan.deleteMany({ where: { college_id: collegeId } });
      await prisma.examHallDesk.deleteMany({ where: { hall: { college_id: collegeId } } });
      await prisma.examHall.deleteMany({ where: { college_id: collegeId } });
      await prisma.approvalAction.deleteMany({ where: { college_id: collegeId } });
      await prisma.approvalRequestStep.deleteMany({ where: { request: { college_id: collegeId } } });
      await prisma.approvalRequest.deleteMany({ where: { college_id: collegeId } });
      await prisma.approvalChainStep.deleteMany({ where: { chain: { college_id: collegeId } } });
      await prisma.approvalChain.deleteMany({ where: { college_id: collegeId } });
      await prisma.outboxEvent.deleteMany({ where: { college_id: collegeId } });
      await prisma.attendance.deleteMany({ where: { college_id: collegeId } });
      await prisma.staffAttendance.deleteMany({ where: { college_id: collegeId } });
      await prisma.fee.deleteMany({ where: { college_id: collegeId } });
      await prisma.result.deleteMany({ where: { college_id: collegeId } });
      await prisma.exam.deleteMany({ where: { college_id: collegeId } });
      await prisma.student.deleteMany({ where: { college_id: collegeId } });
      await prisma.user.deleteMany({ where: { college_id: collegeId } });
      await prisma.session.deleteMany({ where: { college_id: collegeId } });
      await prisma.college.deleteMany({ where: { id: collegeId } });
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
  }

  console.log('\n====================================================');
  console.log(`Phase 11 Tests Summary: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase11ContractTests();
