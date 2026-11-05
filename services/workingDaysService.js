'use strict';

/**
 * workingDaysService.js — Phase 8B (#28)
 * Academic Calendar & Working Days Calculation Service
 * - Calculates effective working instruction days between date boundaries
 * - Accounts for weekly weekend off-days and AcademicCalendarEvent holidays
 * - Respects special working days (events with isWorkingDay = true override weekend)
 */

const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

/**
 * Normalizes date to UTC midnight YYYY-MM-DD
 */
function normalizeDate(d) {
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

/**
 * Calculates working days between two dates considering calendar events
 */
async function calculateWorkingDays({ collegeId, sessionId, startDate, endDate, campusId }) {
  const prisma = getPrisma();

  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);

  if (start > end) {
    throw Object.assign(new Error('startDate must be before or equal to endDate'), { status: 400 });
  }

  // Fetch relevant calendar events in the range
  const events = await prisma.academicCalendarEvent.findMany({
    where: {
      college_id: collegeId,
      session_id: sessionId,
      startDate: { lte: end },
      endDate: { gte: start },
      ...(campusId ? { OR: [{ campus_id: campusId }, { campus_id: null }] } : {})
    },
    orderBy: { startDate: 'asc' }
  });

  let totalCalendarDays = 0;
  let workingDaysCount = 0;
  let offDaysCount = 0;
  let holidayDaysCount = 0;
  const holidaysList = [];

  const cur = new Date(start.getTime());
  while (cur <= end) {
    totalCalendarDays++;
    const dayOfWeek = cur.getUTCDay(); // 0 = Sunday
    const isWeekend = dayOfWeek === 0; // Standard Sunday off-day

    // Find any calendar event matching current day
    const matchingEvents = events.filter(e => {
      const eStart = normalizeDate(e.startDate);
      const eEnd = normalizeDate(e.endDate);
      return cur >= eStart && cur <= eEnd;
    });

    const holidayEvent = matchingEvents.find(e => e.eventType === 'HOLIDAY' && !e.isWorkingDay);
    const forcedWorkingEvent = matchingEvents.find(e => e.isWorkingDay);

    if (forcedWorkingEvent) {
      // Special working day overrides weekend
      workingDaysCount++;
    } else if (holidayEvent) {
      holidayDaysCount++;
      holidaysList.push({
        date: cur.toISOString().split('T')[0],
        title: holidayEvent.title,
        eventType: holidayEvent.eventType
      });
    } else if (isWeekend) {
      offDaysCount++;
    } else {
      workingDaysCount++;
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
    totalCalendarDays,
    workingDaysCount,
    offDaysCount,
    holidayDaysCount,
    holidaysList,
    events
  };
}

/**
 * Check if a specific single calendar date is a working instruction day
 */
async function isInstructionDay({ collegeId, sessionId, date, campusId }) {
  const result = await calculateWorkingDays({
    collegeId,
    sessionId,
    startDate: date,
    endDate: date,
    campusId
  });
  return result.workingDaysCount === 1;
}

async function isWorkingDay(collegeId, date, options = {}) {
  const result = await calculateWorkingDays({
    collegeId,
    sessionId: options.sessionId,
    startDate: date,
    endDate: date,
    campusId: options.campusId
  });
  return result.workingDaysCount === 1;
}

module.exports = {
  calculateWorkingDays,
  isInstructionDay,
  isWorkingDay,
  normalizeDate
};
