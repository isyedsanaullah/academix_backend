const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Leaving Certificate & No-Dues Clearance Service (N29)
 */

const DEFAULT_CLEARANCE_HEADS = [
  { code: 'ACCOUNTS', name: 'Accounts Office', assignedRole: 'accountant', isMandatory: true, displayOrder: 1 },
  { code: 'LIBRARY', name: 'Central Library', assignedRole: 'librarian', isMandatory: true, displayOrder: 2 },
  { code: 'LAB_PHYSICS', name: 'Physics Laboratory', assignedRole: 'teacher', isMandatory: true, displayOrder: 3 },
  { code: 'LAB_CHEMISTRY', name: 'Chemistry Laboratory', assignedRole: 'teacher', isMandatory: true, displayOrder: 4 },
  { code: 'HOSTEL', name: 'Hostel Warden', assignedRole: 'employee', isMandatory: false, displayOrder: 5 },
  { code: 'SPORTS', name: 'Sports Department', assignedRole: 'teacher', isMandatory: false, displayOrder: 6 },
  { code: 'CANTEEN', name: 'Canteen Contractor', assignedRole: 'employee', isMandatory: false, displayOrder: 7 },
];

/**
 * Ensure default clearance heads exist for college
 */
async function seedDefaultHeads(collegeId, campusId = null) {
  const existing = await prisma.clearanceHead.findMany({
    where: { college_id: collegeId },
  });

  if (existing.length === 0) {
    await prisma.clearanceHead.createMany({
      data: DEFAULT_CLEARANCE_HEADS.map((h) => ({
        ...h,
        college_id: collegeId,
        campus_id: campusId,
        isActive: true,
      })),
    });
  }

  return await prisma.clearanceHead.findMany({
    where: { college_id: collegeId, isActive: true },
    orderBy: { displayOrder: 'asc' },
  });
}

/**
 * Initiate multi-department clearance for a student
 */
async function initiateClearance({
  collegeId,
  campusId = null,
  studentId,
  sessionId,
  reason = 'GRADUATED',
  destination = null,
  initiatedById,
}) {
  return await prisma.$transaction(async (tx) => {
    // 1. Verify student exists
    const student = await tx.student.findUnique({
      where: { id: studentId },
    });
    if (!student || student.college_id !== collegeId) {
      throw { statusCode: 404, code: 'STUDENT_NOT_FOUND', message: 'Student not found.' };
    }

    // 2. Ensure clearance heads exist
    let heads = await tx.clearanceHead.findMany({
      where: { college_id: collegeId, isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    if (heads.length === 0) {
      await tx.clearanceHead.createMany({
        data: DEFAULT_CLEARANCE_HEADS.map((h) => ({
          ...h,
          college_id: collegeId,
          campus_id: campusId,
          isActive: true,
        })),
      });
      heads = await tx.clearanceHead.findMany({
        where: { college_id: collegeId, isActive: true },
        orderBy: { displayOrder: 'asc' },
      });
    }

    // 3. Automated Accounts Check: inspect fee ledger for unpaid dues
    const unpaidFees = await tx.fee.findMany({
      where: {
        college_id: collegeId,
        student_id: studentId,
        status: { in: ['unpaid', 'partial', 'overdue'] },
      },
    });

    let totalUnpaidDues = 0;
    for (const f of unpaidFees) {
      const balance = Math.max(0, Number(f.totalAmount || 0) - Number(f.paidAmount || 0));
      totalUnpaidDues += balance;
    }

    // 4. Create clearance process record
    const process = await tx.studentClearanceProcess.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        student_id: studentId,
        session_id: sessionId || student.session_id,
        reason,
        destination,
        status: 'IN_PROGRESS',
        initiatedById,
      },
    });

    // 5. Create clearance items for each department head
    const itemsData = heads.map((head) => {
      const isAccounts = head.code === 'ACCOUNTS';
      const hasDues = isAccounts && totalUnpaidDues > 0;
      return {
        processId: process.id,
        headId: head.id,
        status: hasDues ? 'DUES_OUTSTANDING' : 'PENDING',
        duesAmountPkr: hasDues ? Math.round(totalUnpaidDues) : 0,
        remarks: hasDues ? `Automated check: Unpaid fees of Rs. ${totalUnpaidDues}` : null,
      };
    });

    await tx.studentClearanceItem.createMany({
      data: itemsData,
    });

    return await tx.studentClearanceProcess.findUnique({
      where: { id: process.id },
      include: {
        departmentItems: {
          include: { head: true },
        },
      },
    });
  });
}

/**
 * Update clearance item status for a department
 */
async function updateClearanceItem({
  collegeId,
  processId,
  headId,
  status, // PENDING | CLEARED | DUES_OUTSTANDING
  duesAmountPkr = 0,
  remarks = null,
  clearedById,
}) {
  return await prisma.$transaction(async (tx) => {
    const item = await tx.studentClearanceItem.findUnique({
      where: {
        processId_headId: { processId, headId },
      },
      include: { head: true, process: true },
    });

    if (!item || item.process.college_id !== collegeId) {
      throw { statusCode: 404, code: 'CLEARANCE_ITEM_NOT_FOUND', message: 'Clearance item not found.' };
    }

    // If clearing Accounts department, verify open fees are actually resolved
    if (item.head.code === 'ACCOUNTS' && status === 'CLEARED') {
      const unpaidFees = await tx.fee.findMany({
        where: {
          college_id: collegeId,
          student_id: item.process.student_id,
          status: { in: ['unpaid', 'partial', 'overdue'] },
        },
      });

      const totalUnpaid = unpaidFees.reduce(
        (acc, f) => acc + Math.max(0, Number(f.totalAmount || 0) - Number(f.paidAmount || 0)),
        0
      );

      if (totalUnpaid > 0) {
        throw {
          statusCode: 422,
          code: 'ACCOUNTS_DUES_OUTSTANDING',
          message: `Cannot clear Accounts department while Rs. ${totalUnpaid} in unpaid fees remain on record.`,
          unpaidDues: totalUnpaid,
        };
      }
    }

    // Update item
    const updatedItem = await tx.studentClearanceItem.update({
      where: { id: item.id },
      data: {
        status,
        duesAmountPkr: parseInt(duesAmountPkr || 0, 10),
        remarks,
        clearedById,
        clearedAt: status === 'CLEARED' ? new Date() : null,
      },
    });

    // Check if all mandatory heads are now CLEARED
    const allItems = await tx.studentClearanceItem.findMany({
      where: { processId },
      include: { head: true },
    });

    const mandatoryUncleared = allItems.filter((i) => i.head.isMandatory && i.status !== 'CLEARED');
    const allMandatoryCleared = mandatoryUncleared.length === 0;

    if (allMandatoryCleared && item.process.status === 'IN_PROGRESS') {
      await tx.studentClearanceProcess.update({
        where: { id: processId },
        data: {
          status: 'CLEARED',
          completedAt: new Date(),
        },
      });
    }

    return updatedItem;
  });
}

/**
 * Issue Leaving Certificate (SLC)
 * Invariant: Must have zero uncleared mandatory heads.
 * Post-issuance: Student.status becomes 'transferred' or 'graduated', freeing seat quota.
 */
async function issueLeavingCertificate({
  collegeId,
  campusId = null,
  processId,
  characterRating = 'EXEMPLARY',
  conductRemarks = 'Satisfactory academic performance and good conduct throughout.',
  admissionDate,
  leavingDate,
  reasonForLeaving,
  issuedById,
}) {
  return await prisma.$transaction(async (tx) => {
    // 1. Fetch clearance process with items
    const process = await tx.studentClearanceProcess.findUnique({
      where: { id: processId },
      include: {
        departmentItems: {
          include: { head: true },
        },
      },
    });

    if (!process || process.college_id !== collegeId) {
      throw { statusCode: 404, code: 'PROCESS_NOT_FOUND', message: 'Clearance process not found.' };
    }

    if (process.status === 'CERTIFICATE_ISSUED') {
      throw { statusCode: 400, code: 'CERTIFICATE_ALREADY_ISSUED', message: 'Certificate has already been issued for this process.' };
    }

    // Invariant 3: Certificate Issue Lock
    const unclearedMandatory = process.departmentItems.filter((i) => i.head.isMandatory && i.status !== 'CLEARED');
    if (unclearedMandatory.length > 0) {
      const pendingNames = unclearedMandatory.map((i) => i.head.name).join(', ');
      throw {
        statusCode: 422,
        code: 'CLEARANCE_INCOMPLETE',
        message: `Leaving certificate cannot be issued. Mandatory departments uncleared: ${pendingNames}`,
        pendingDepartments: unclearedMandatory.map((i) => ({ code: i.head.code, name: i.head.name, status: i.status })),
      };
    }

    // 2. Generate sequential certificate number
    const year = new Date().getFullYear();
    const countTotal = await tx.leavingCertificateRecord.count({
      where: { college_id: collegeId },
    });
    const certificateNumber = `SLC-${year}-${String(countTotal + 1).padStart(5, '0')}`;

    // 3. Generate tamper-proof SHA-256 verification hash
    const rawPayload = `${collegeId}:${process.student_id}:${certificateNumber}:${Date.now()}`;
    const qrVerificationHash = crypto.createHash('sha256').update(rawPayload).digest('hex');

    // 4. Create certificate record
    const cert = await tx.leavingCertificateRecord.create({
      data: {
        college_id: collegeId,
        campus_id: campusId || process.campus_id,
        student_id: process.student_id,
        certificateNumber,
        characterRating,
        conductRemarks,
        admissionDate: new Date(admissionDate || Date.now() - 365 * 24 * 3600 * 1000),
        leavingDate: new Date(leavingDate || Date.now()),
        reasonForLeaving: reasonForLeaving || process.reason,
        qrVerificationHash,
        fileKey: `REPORTS/certificates/${certificateNumber}.pdf`,
        issuedById,
      },
    });

    // 5. Update process
    await tx.studentClearanceProcess.update({
      where: { id: processId },
      data: {
        status: 'CERTIFICATE_ISSUED',
        certificateId: cert.id,
      },
    });

    // Invariant 4: Post-Issuance Status Transition — frees student quota
    const newStatus = process.reason === 'GRADUATED' ? 'graduated' : 'transferred';
    await tx.student.update({
      where: { id: process.student_id },
      data: {
        status: newStatus,
      },
    });

    return cert;
  });
}

/**
 * Public certificate verification
 */
async function verifyCertificate(qrVerificationHash) {
  const cert = await prisma.leavingCertificateRecord.findUnique({
    where: { qrVerificationHash },
  });

  if (!cert) {
    throw { statusCode: 404, code: 'CERTIFICATE_NOT_FOUND', message: 'Certificate verification hash is invalid or unknown.' };
  }

  const student = await prisma.student.findUnique({
    where: { id: cert.student_id },
    select: { name: true, rollNumber: true, class: true, group: true },
  });

  const college = await prisma.college.findUnique({
    where: { id: cert.college_id },
    select: { name: true, address: true },
  });

  return {
    verified: true,
    certificateNumber: cert.certificateNumber,
    issuedAt: cert.issuedAt,
    characterRating: cert.characterRating,
    reasonForLeaving: cert.reasonForLeaving,
    student: {
      name: student?.name,
      rollNumber: student?.rollNumber,
      class: student?.class,
    },
    college: {
      name: college?.name,
    },
  };
}

module.exports = {
  seedDefaultHeads,
  initiateClearance,
  updateClearanceItem,
  issueLeavingCertificate,
  verifyCertificate,
};
