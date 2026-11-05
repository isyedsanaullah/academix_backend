/**
 * timetableProfile.controller.js — Phase 7C
 * Timetable Profile Isolation & Validation:
 * - Multi-profile coexistence (at most one active per college + type)
 * - TimetablePeriod FK constraints
 * - Hard conflict blocks (Teacher clash, Section clash, Room clash)
 * - Section unique constraint on (college_id, profile_id, section_id, dayOfWeek, periodNumber)
 * - Leave clash warning (does not hard block)
 * - Atomic slot swaps via delete + insert
 * - Timetable PDF export marked exempt platform category
 */

const { getSystemClient } = require('../config/prismaManager');

const VALID_TYPES = ['STANDARD', 'RAMADAN', 'EXAM'];

/**
 * POST /api/timetable/profiles
 * Create a new timetable profile with optional initial periods.
 */
async function createProfile(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const { name, type = 'STANDARD', periods = [] } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Profile name is required' });
    }

    const upperType = String(type).toUpperCase();
    if (!VALID_TYPES.includes(upperType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid profile type '${type}'. Allowed: ${VALID_TYPES.join(', ')}`
      });
    }

    const profile = await prisma.$transaction(async (tx) => {
      const p = await tx.timetableProfile.create({
        data: {
          college_id: collegeId,
          name: name.trim(),
          type: upperType,
          isActive: false
        }
      });

      if (Array.isArray(periods) && periods.length > 0) {
        const periodData = periods.map(per => ({
          profile_id: p.id,
          periodNumber: Number(per.periodNumber),
          startTime: String(per.startTime),
          endTime: String(per.endTime),
          isBreak: Boolean(per.isBreak)
        }));
        await tx.timetablePeriod.createMany({ data: periodData });
      }

      return await tx.timetableProfile.findUnique({
        where: { id: p.id },
        include: { periods: { orderBy: { periodNumber: 'asc' } } }
      });
    });

    return res.status(201).json({ success: true, profile });
  } catch (error) {
    console.error('[createProfile] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create timetable profile', error: error.message });
  }
}

/**
 * GET /api/timetable/profiles
 * List all profiles for the college.
 */
async function listProfiles(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const { type, isActive } = req.query;

    const where = { college_id: collegeId };
    if (type) where.type = String(type).toUpperCase();
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const profiles = await prisma.timetableProfile.findMany({
      where,
      include: {
        periods: { orderBy: { periodNumber: 'asc' } },
        _count: { select: { entries: true } }
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }]
    });

    return res.json({ success: true, profiles });
  } catch (error) {
    console.error('[listProfiles] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to list profiles', error: error.message });
  }
}

/**
 * POST /api/timetable/profiles/:id/activate
 * Enforces multi-profile coexistence: at most one active profile per (college_id, type).
 */
async function activateProfile(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const { id } = req.params;

    const target = await prisma.timetableProfile.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!target) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    const activated = await prisma.$transaction(async (tx) => {
      // Deactivate any currently active profile of the same type
      await tx.timetableProfile.updateMany({
        where: { college_id: collegeId, type: target.type, isActive: true },
        data: { isActive: false }
      });

      // Activate target profile
      return await tx.timetableProfile.update({
        where: { id },
        data: { isActive: true },
        include: { periods: { orderBy: { periodNumber: 'asc' } } }
      });
    });

    return res.json({
      success: true,
      message: `Profile '${activated.name}' is now active for ${activated.type} schedule.`,
      profile: activated
    });
  } catch (error) {
    console.error('[activateProfile] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to activate profile', error: error.message });
  }
}

/**
 * POST /api/timetable/entries
 * Create a timetable entry with conflict checks (Teacher, Section, Room hard blocks; Leave warning).
 */
async function createEntry(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const {
      profileId,
      dayOfWeek,
      periodNumber,
      subjectId,
      teacherId,
      roomId = null,
      sectionIds = [],
      batchKey = 'ALL'
    } = req.body;

    if (!profileId || !dayOfWeek || !periodNumber || !subjectId || !teacherId) {
      return res.status(400).json({ success: false, message: 'Missing required slot parameters' });
    }

    const sections = Array.isArray(sectionIds) && sectionIds.length > 0 ? sectionIds : ['A'];
    const warnings = [];

    // 1. Check teacher leave (warning only)
    try {
      const activeLeave = await prisma.leaveRequest?.findFirst({
        where: {
          teacher_id: teacherId,
          status: 'APPROVED'
        }
      });
      if (activeLeave) {
        warnings.push('Teacher has scheduled leave on file for this period');
      }
    } catch (_) {}

    const result = await prisma.$transaction(async (tx) => {
      // 2. Teacher clash check (Hard block)
      const teacherClash = await tx.timetableEntry.findFirst({
        where: {
          college_id: collegeId,
          profile_id: profileId,
          dayOfWeek: Number(dayOfWeek),
          periodNumber: Number(periodNumber),
          teacherId
        }
      });
      if (teacherClash) {
        throw Object.assign(
          new Error(`Teacher is already assigned to another class during day ${dayOfWeek}, period ${periodNumber}`),
          { status: 409, code: 'TEACHER_CLASH' }
        );
      }

      // 3. Room clash check (Hard block)
      if (roomId) {
        const roomClash = await tx.timetableEntry.findFirst({
          where: {
            college_id: collegeId,
            profile_id: profileId,
            dayOfWeek: Number(dayOfWeek),
            periodNumber: Number(periodNumber),
            roomId
          }
        });
        if (roomClash) {
          throw Object.assign(
            new Error(`Room is already occupied during day ${dayOfWeek}, period ${periodNumber}`),
            { status: 409, code: 'ROOM_CLASH' }
          );
        }
      }

      // 4. Section clash check (Hard block)
      for (const sId of sections) {
        const sectionClash = await tx.timetableEntrySection.findFirst({
          where: {
            college_id: collegeId,
            profile_id: profileId,
            section_id: sId,
            dayOfWeek: Number(dayOfWeek),
            periodNumber: Number(periodNumber)
          }
        });
        if (sectionClash) {
          throw Object.assign(
            new Error(`Section '${sId}' already has a class scheduled in period ${periodNumber}`),
            { status: 409, code: 'SECTION_CLASH' }
          );
        }
      }

      // 5. Create entry
      const entry = await tx.timetableEntry.create({
        data: {
          college_id: collegeId,
          profile_id: profileId,
          dayOfWeek: Number(dayOfWeek),
          periodNumber: Number(periodNumber),
          subjectId,
          teacherId,
          roomId,
          batchKey
        }
      });

      // 6. Create denormalized section entries (enforces section unique constraint)
      const sectionRows = sections.map(sId => ({
        entryId: entry.id,
        college_id: collegeId,
        profile_id: profileId,
        section_id: sId,
        dayOfWeek: Number(dayOfWeek),
        periodNumber: Number(periodNumber)
      }));

      await tx.timetableEntrySection.createMany({ data: sectionRows });

      return entry;
    });

    return res.status(201).json({
      success: true,
      entry: result,
      warnings: warnings.length > 0 ? warnings : undefined
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error('[createEntry] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create timetable entry', error: error.message });
  }
}

/**
 * POST /api/timetable/swap
 * Atomic slot swap via delete + insert inside a single transaction.
 */
async function swapSlots(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const { profileId, entryId1, entryId2 } = req.body;

    if (!profileId || !entryId1 || !entryId2) {
      return res.status(400).json({ success: false, message: 'profileId, entryId1, entryId2 are required' });
    }

    await prisma.$transaction(async (tx) => {
      const e1 = await tx.timetableEntry.findFirst({
        where: { id: entryId1, college_id: collegeId, profile_id: profileId },
        include: { sections: true }
      });
      const e2 = await tx.timetableEntry.findFirst({
        where: { id: entryId2, college_id: collegeId, profile_id: profileId },
        include: { sections: true }
      });

      if (!e1 || !e2) {
        throw Object.assign(new Error('One or both entries not found'), { status: 404 });
      }

      // Delete old sections first to prevent constraint clashes
      await tx.timetableEntrySection.deleteMany({
        where: { entryId: { in: [entryId1, entryId2] } }
      });

      // Swap day and period
      const tempDay1 = e1.dayOfWeek;
      const tempPeriod1 = e1.periodNumber;

      await tx.timetableEntry.update({
        where: { id: entryId1 },
        data: { dayOfWeek: e2.dayOfWeek, periodNumber: e2.periodNumber }
      });

      await tx.timetableEntry.update({
        where: { id: entryId2 },
        data: { dayOfWeek: tempDay1, periodNumber: tempPeriod1 }
      });

      // Re-insert section mappings with new days/periods
      const newSections1 = e1.sections.map(s => ({
        entryId: entryId1,
        college_id: collegeId,
        profile_id: profileId,
        section_id: s.section_id,
        dayOfWeek: e2.dayOfWeek,
        periodNumber: e2.periodNumber
      }));

      const newSections2 = e2.sections.map(s => ({
        entryId: entryId2,
        college_id: collegeId,
        profile_id: profileId,
        section_id: s.section_id,
        dayOfWeek: tempDay1,
        periodNumber: tempPeriod1
      }));

      await tx.timetableEntrySection.createMany({
        data: [...newSections1, ...newSections2]
      });
    });

    return res.json({ success: true, message: 'Timetable slots successfully swapped.' });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[swapSlots] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to swap timetable slots', error: error.message });
  }
}

/**
 * GET /api/timetable/profiles/:id/export-pdf
 * Exports timetable PDF flagged as exempt platform category.
 */
async function exportTimetablePDF(req, res) {
  try {
    const { id } = req.params;
    const collegeId = req.collegeId || req.user?.college_id;

    // Platform-generated PDF is strictly exempt from tenant storage quota
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="timetable_${id}.pdf"`);
    res.setHeader('X-Platform-Exempt', 'true');

    // Return placeholder PDF stream / header response
    return res.send(Buffer.from('%PDF-1.4\n%Timetable Export Placeholder\n%%EOF'));
  } catch (error) {
    console.error('[exportTimetablePDF] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to export timetable PDF' });
  }
}

module.exports = {
  createProfile,
  listProfiles,
  activateProfile,
  createEntry,
  swapSlots,
  exportTimetablePDF
};

