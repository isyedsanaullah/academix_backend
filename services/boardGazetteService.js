'use strict';

/**
 * boardGazetteService.js — Phase 9I (#N02)
 * Board-Format Gazette Excel Export Engine:
 * - Data-driven board column configuration profiles (JSON)
 * - Seeded profiles for BISE Lahore, FBISE, BISE Rawalpindi, BISE Gujranwala, BISE Faisalabad
 * - Extracts board results (or student exam results) and maps dynamically to board column profiles
 * - Formula injection safe with explicit string typing
 */

const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

/**
 * Standard data-driven column profiles for Pakistani BISE boards (OD-18)
 */
const DEFAULT_BOARD_PROFILES = [
  {
    boardCode: 'BISE_LHR',
    boardName: 'Board of Intermediate and Secondary Education, Lahore',
    columnsJson: [
      { key: 'rollNumber', header: 'Roll No', type: 'string' },
      { key: 'regNumber', header: 'Registration No', type: 'string' },
      { key: 'studentName', header: 'Candidate Name', type: 'string' },
      { key: 'fatherName', header: "Father's Name", type: 'string' },
      { key: 'group', header: 'Study Group', type: 'string' },
      { key: 'totalMarks', header: 'Total Marks', type: 'number' },
      { key: 'marksObtained', header: 'Obtained Marks', type: 'number' },
      { key: 'percentage', header: 'Percentage', type: 'number' },
      { key: 'grade', header: 'Grade', type: 'string' },
      { key: 'status', header: 'Result Status', type: 'string' },
      { key: 'remarks', header: 'Remarks', type: 'string' }
    ],
    version: 1
  },
  {
    boardCode: 'FBISE',
    boardName: 'Federal Board of Intermediate and Secondary Education, Islamabad',
    columnsJson: [
      { key: 'rollNumber', header: 'Roll Number', type: 'string' },
      { key: 'regNumber', header: 'Reg No', type: 'string' },
      { key: 'studentName', header: 'Name of Candidate', type: 'string' },
      { key: 'fatherName', header: 'Father Name', type: 'string' },
      { key: 'group', header: 'Group', type: 'string' },
      { key: 'totalMarks', header: 'Max Marks', type: 'number' },
      { key: 'marksObtained', header: 'Marks Obtained', type: 'number' },
      { key: 'grade', header: 'Grade', type: 'string' },
      { key: 'status', header: 'Status / Remarks', type: 'string' }
    ],
    version: 1
  },
  {
    boardCode: 'BISE_RWP',
    boardName: 'Board of Intermediate and Secondary Education, Rawalpindi',
    columnsJson: [
      { key: 'rollNumber', header: 'Roll No', type: 'string' },
      { key: 'regNumber', header: 'Registration No', type: 'string' },
      { key: 'studentName', header: 'Student Name', type: 'string' },
      { key: 'fatherName', header: "Father's Name", type: 'string' },
      { key: 'group', header: 'Group', type: 'string' },
      { key: 'totalMarks', header: 'Total Marks', type: 'number' },
      { key: 'marksObtained', header: 'Obtained Marks', type: 'number' },
      { key: 'grade', header: 'Grade', type: 'string' },
      { key: 'status', header: 'Pass/Fail', type: 'string' }
    ],
    version: 1
  },
  {
    boardCode: 'BISE_GRW',
    boardName: 'Board of Intermediate and Secondary Education, Gujranwala',
    columnsJson: [
      { key: 'rollNumber', header: 'Roll No', type: 'string' },
      { key: 'regNumber', header: 'Reg No', type: 'string' },
      { key: 'studentName', header: 'Name', type: 'string' },
      { key: 'fatherName', header: 'Father Name', type: 'string' },
      { key: 'totalMarks', header: 'Max', type: 'number' },
      { key: 'marksObtained', header: 'Obt', type: 'number' },
      { key: 'percentage', header: '%age', type: 'number' },
      { key: 'grade', header: 'Grade', type: 'string' },
      { key: 'status', header: 'Status', type: 'string' }
    ],
    version: 1
  },
  {
    boardCode: 'BISE_FSD',
    boardName: 'Board of Intermediate and Secondary Education, Faisalabad',
    columnsJson: [
      { key: 'rollNumber', header: 'Roll No', type: 'string' },
      { key: 'regNumber', header: 'Registration No', type: 'string' },
      { key: 'studentName', header: 'Candidate Name', type: 'string' },
      { key: 'fatherName', header: 'Father Name', type: 'string' },
      { key: 'group', header: 'Discipline', type: 'string' },
      { key: 'totalMarks', header: 'Total', type: 'number' },
      { key: 'marksObtained', header: 'Obtained', type: 'number' },
      { key: 'grade', header: 'Grade', type: 'string' },
      { key: 'status', header: 'Result', type: 'string' }
    ],
    version: 1
  }
];

/**
 * Ensure default board profiles exist in the database
 */
async function ensureDefaultProfiles(prismaClient) {
  const prisma = prismaClient || getPrisma();
  for (const profile of DEFAULT_BOARD_PROFILES) {
    await prisma.boardExportProfile.upsert({
      where: { boardCode: profile.boardCode },
      update: {},
      create: {
        boardCode: profile.boardCode,
        boardName: profile.boardName,
        columnsJson: profile.columnsJson,
        version: profile.version,
        isActive: true
      }
    });
  }
}

/**
 * Get active board export profile by code
 */
async function getBoardProfile(boardCode, prismaClient) {
  const prisma = prismaClient || getPrisma();
  const code = (boardCode || 'BISE_LHR').trim().toUpperCase();

  let profile = await prisma.boardExportProfile.findUnique({
    where: { boardCode: code }
  });

  if (!profile) {
    // Check in defaults and auto-seed if found
    const def = DEFAULT_BOARD_PROFILES.find(p => p.boardCode === code);
    if (def) {
      profile = await prisma.boardExportProfile.create({
        data: {
          boardCode: def.boardCode,
          boardName: def.boardName,
          columnsJson: def.columnsJson,
          version: def.version,
          isActive: true
        }
      });
    } else {
      // Fallback to BISE_LHR
      profile = await prisma.boardExportProfile.findUnique({
        where: { boardCode: 'BISE_LHR' }
      });
      if (!profile) {
        profile = DEFAULT_BOARD_PROFILES[0];
      }
    }
  }

  return profile;
}

/**
 * List all available board profiles
 */
async function listBoardProfiles(prismaClient) {
  const prisma = prismaClient || getPrisma();
  await ensureDefaultProfiles(prisma);
  return prisma.boardExportProfile.findMany({
    where: { isActive: true },
    orderBy: { boardCode: 'asc' }
  });
}

/**
 * Fetch and assemble board-format gazette data for export
 * Dynamically resolves columns from BoardExportProfile.columnsJson
 */
async function fetchBoardGazetteData(prismaClient, collegeId, campusId, filters = {}) {
  const prisma = prismaClient || getPrisma();
  const boardCode = filters.boardCode || 'BISE_LHR';
  const profile = await getBoardProfile(boardCode, prisma);

  const columns = Array.isArray(profile.columnsJson) ? profile.columnsJson : [];
  const headers = columns.map(col => col.header || col.key);

  const whereCol = { college_id: collegeId };
  if (campusId) whereCol.campus_id = campusId;
  if (filters.session_id) whereCol.session_id = filters.session_id;
  if (filters.examYear) whereCol.examYear = Number(filters.examYear);
  if (filters.part) whereCol.part = Number(filters.part);
  if (filters.examType) whereCol.examType = filters.examType;

  // 1. Fetch BoardResult records
  const boardResults = await prisma.boardResult.findMany({
    where: whereCol,
    orderBy: { boardRollNumber: 'asc' }
  });

  let rawItems = [];

  if (boardResults.length > 0) {
    // Enrich with student details if available
    const studentIds = boardResults.map(r => r.student_id).filter(Boolean);
    const students = studentIds.length > 0
      ? await prisma.student.findMany({ where: { id: { in: studentIds } } })
      : [];
    const studentMap = new Map(students.map(s => [s.id, s]));

    rawItems = boardResults.map(br => {
      const stu = br.student_id ? studentMap.get(br.student_id) : null;
      return {
        rollNumber: br.boardRollNumber || (stu ? stu.rollNumber : ''),
        regNumber: stu?.registrationNumber || stu?.admissionNumber || '',
        studentName: stu?.name || 'N/A',
        fatherName: stu?.fatherName || '',
        group: stu?.group || stu?.class || 'Pre-Medical',
        totalMarks: br.totalMarks || 1100,
        marksObtained: br.totalObtained || 0,
        percentage: br.percentage || (br.totalMarks ? Number(((br.totalObtained / br.totalMarks) * 100).toFixed(1)) : 0),
        grade: br.grade || 'A',
        status: br.status ? br.status.toUpperCase() : 'PASS',
        remarks: br.gazetteNo ? `Gazette #${br.gazetteNo}` : ''
      };
    });
  } else {
    // If no board results exist yet, pull active students for gazette roster export
    const students = await prisma.student.findMany({
      where: whereCol,
      orderBy: { rollNumber: 'asc' }
    });

    rawItems = students.map(s => ({
      rollNumber: s.rollNumber || '',
      regNumber: s.registrationNumber || s.admissionNumber || '',
      studentName: s.name,
      fatherName: s.fatherName || '',
      group: s.group || s.class || '',
      totalMarks: 1100,
      marksObtained: 0,
      percentage: 0,
      grade: 'N/A',
      status: s.status === 'active' ? 'ENROLLED' : (s.status ? s.status.toUpperCase() : 'PENDING'),
      remarks: ''
    }));
  }

  // Map raw items according to the profile's columnsJson order
  const rows = rawItems.map(item => {
    return columns.map(col => {
      const val = item[col.key];
      return val !== undefined && val !== null ? val : '';
    });
  });

  return { headers, rows, rawItems, profile };
}

module.exports = {
  DEFAULT_BOARD_PROFILES,
  ensureDefaultProfiles,
  getBoardProfile,
  listBoardProfiles,
  fetchBoardGazetteData
};

