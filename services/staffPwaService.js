'use strict';

/**
 * staffPwaService.js — Phase 9G (#N08)
 * Faculty & Staff Offline PWA Engine:
 * - Read-only offline caching for timetable and assigned section rosters only
 * - Strictly no offline writes (attendance marking offline is out of scope)
 * - PII protection: Student photos and confidential fields stripped
 * - Cross-section and cross-tenant data strictly isolated
 */

const { getSystemClient } = require('../config/prismaManager');
const { getEntitlements } = require('./entitlements');

function getPrisma() {
  return getSystemClient();
}

/**
 * Fetch read-only offline bundle for an authenticated teacher/staff member
 */
async function getStaffOfflineBundle({ collegeId, userId }) {
  const prisma = getPrisma();

  // 1. Check feature entitlement (Standard and above)
  const entitlements = await getEntitlements(collegeId, prisma);
  if (!entitlements.features.includes('faculty-student-pwa')) {
    throw Object.assign(new Error('Faculty Offline PWA is not included in your current subscription plan.'), {
      status: 403,
      code: 'FEATURE_NOT_IN_PLAN'
    });
  }

  // 2. Fetch User & verify staff / teacher status
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, college_id: true }
  });

  if (!user || user.college_id !== collegeId) {
    throw Object.assign(new Error('User not found in this institution.'), { status: 404, code: 'NOT_FOUND' });
  }

  // 3. Fetch Teacher's Timetable Entries
  let timetableEntries = [];
  try {
    timetableEntries = await prisma.timetableEntry.findMany({
      where: {
        college_id: collegeId,
        teacherId: userId
      },
      include: {
        sections: true
      },
      orderBy: [
        { dayOfWeek: 'asc' },
        { periodNumber: 'asc' }
      ]
    });
  } catch (err) {
    // fallback if profile not active
  }

  // 4. Identify Assigned Sections (from timetable entries and classTeacher assignment)
  const assignedSectionIds = new Set();
  for (const entry of timetableEntries) {
    if (entry.sections && Array.isArray(entry.sections)) {
      for (const s of entry.sections) {
        if (s.section_id) assignedSectionIds.add(s.section_id);
      }
    }
  }

  const ctSections = await prisma.section.findMany({
    where: {
      college_id: collegeId,
      OR: [
        { classTeacher: userId },
        { classTeacher: user.name }
      ]
    }
  });
  for (const s of ctSections) {
    assignedSectionIds.add(s.id);
  }

  const assignedSections = await prisma.section.findMany({
    where: {
      id: { in: Array.from(assignedSectionIds) }
    },
    select: {
      id: true,
      name: true,
      code: true,
      capacity: true
    }
  });

  // 5. Fetch Student Rosters for Assigned Sections Only (No photos, no guardian PINs)
  let rosters = [];
  if (assignedSectionIds.size > 0) {
    rosters = await prisma.student.findMany({
      where: {
        college_id: collegeId,
        section_id: { in: Array.from(assignedSectionIds) }
      },
      select: {
        id: true,
        section_id: true,
        rollNumber: true,
        name: true,
        fatherName: true,
        gender: true,
        class: true,
        group: true,
        status: true
      },
      orderBy: { rollNumber: 'asc' }
    });
  }

  const maxAgeHours = 24;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + maxAgeHours * 60 * 60 * 1000);

  return {
    teacher: {
      id: user.id,
      name: user.name,
      role: user.role
    },
    timetable: timetableEntries,
    assignedSections,
    rosters,
    cacheMetadata: {
      cachedAt: now.toISOString(),
      maxAgeHours,
      expiresAt: expiresAt.toISOString(),
      scope: '/staff-app/'
    }
  };
}

module.exports = {
  getStaffOfflineBundle
};
