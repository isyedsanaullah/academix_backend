const { getSystemClient } = require('../config/prismaManager');

/**
 * Generate a unique Card ID / QR Code for a member in a college.
 * Format: {COLLEGE_CODE}-{TYPE}{YY}-{SEQUENCE_4}
 * Example: FYZ-STU26-0001, FYZ-TCH26-0005, FYZ-EMP26-0012
 *
 * @param {Object} tenantDb - Prisma client for tenant DB
 * @param {string} collegeId - UUID of the college
 * @param {'student' | 'teacher' | 'employee' | 'admin'} personType
 * @returns {Promise<string>} Unique Card ID string
 */
async function generateCardId(tenantDb, collegeId, personType) {
  const prisma = getSystemClient();

  // 1. Fetch college code
  let collegeCode = 'CLG';
  if (collegeId) {
    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { code: true, name: true }
    });
    if (college?.code) {
      collegeCode = college.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    } else if (college?.name) {
      collegeCode = college.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    }
  }

  // 2. Type prefix & 2-digit year
  const typeMap = {
    student: 'STU',
    teacher: 'TCH',
    employee: 'EMP',
    admin: 'ADM'
  };
  const typePrefix = typeMap[personType] || 'MEM';
  const yy = String(new Date().getFullYear()).slice(-2);

  // 3. Estimate sequence count
  let count = 0;
  try {
    if (personType === 'student') {
      count = await tenantDb.student.count({ where: { college_id: collegeId } });
    } else if (personType === 'teacher') {
      count = await tenantDb.teacher.count({ where: { college_id: collegeId } });
    } else if (personType === 'employee') {
      count = await tenantDb.employee.count({ where: { college_id: collegeId } });
    } else {
      count = await prisma.user.count({ where: { college_id: collegeId } });
    }
  } catch (err) {
    console.warn('⚠️ Error estimating sequence count for card ID:', err.message);
  }

  // 4. Generate candidate & check collision
  let sequence = count + 1;
  let cardId = '';
  let isUnique = false;
  let attempts = 0;

  while (!isUnique && attempts < 50) {
    const seqStr = String(sequence).padStart(4, '0');
    cardId = `${collegeCode}-${typePrefix}${yy}-${seqStr}`;

    // Check collision across models
    let existing = null;
    if (personType === 'student') {
      existing = await tenantDb.student.findFirst({
        where: { college_id: collegeId, OR: [{ qrCode: cardId }, { rollNumber: cardId }] }
      });
    } else if (personType === 'teacher') {
      existing = await tenantDb.teacher.findFirst({
        where: { college_id: collegeId, qrCode: cardId }
      });
    } else {
      existing = await prisma.user.findFirst({
        where: { college_id: collegeId, qrCode: cardId }
      });
    }

    if (!existing) {
      isUnique = true;
    } else {
      sequence++;
      attempts++;
    }
  }

  return cardId;
}

module.exports = { generateCardId };
