'use strict';

const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

class HostelService {
  /**
   * Register a new hostel building.
   */
  async createBuilding({ collegeId, campusId = null, name, gender, wardenId, totalRooms }) {
    if (!collegeId || !name || !gender || !wardenId) {
      const err = new Error('collegeId, name, gender, and wardenId are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    return await prisma.hostelBuilding.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        name,
        gender,
        wardenId,
        totalRooms: Number(totalRooms) || 1,
      },
    });
  }

  /**
   * Add a room to a building with specified bed capacity and monthly rent.
   */
  async addRoom({ buildingId, roomNumber, capacity = 3, monthlyRentPkr }) {
    return await prisma.hostelRoom.create({
      data: {
        buildingId,
        roomNumber,
        capacity: Number(capacity),
        monthlyRentPkr: Number(monthlyRentPkr),
      },
    });
  }

  /**
   * Allot a specific bed in a room to a student.
   * Enforces bed capacity limits and single room per student.
   */
  async allotBed({ collegeId, campusId = null, studentId, sessionId, roomId, bedNumber }) {
    if (!collegeId || !studentId || !sessionId || !roomId || bedNumber === undefined) {
      const err = new Error('collegeId, studentId, sessionId, roomId, and bedNumber are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const room = await prisma.hostelRoom.findUnique({
      where: { id: roomId },
      include: {
        building: true,
        allotments: { where: { isActive: true } },
      },
    });

    if (!room || room.building.college_id !== collegeId) {
      const err = new Error('Hostel room not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const bedNum = Number(bedNumber);
    if (bedNum < 1 || bedNum > room.capacity) {
      const err = new Error(`Invalid bed number. Room capacity is ${room.capacity}`);
      err.code = 'INVALID_BED_NUMBER';
      throw err;
    }

    // Check if bed is already occupied
    const bedOccupied = room.allotments.some((a) => a.bedNumber === bedNum);
    if (bedOccupied) {
      const err = new Error(`Bed ${bedNum} in room ${room.roomNumber} is already occupied`);
      err.code = 'BED_ALREADY_OCCUPIED';
      throw err;
    }

    return await prisma.$transaction(async (tx) => {
      // Deactivate any existing active hostel room allotment for this student in this session
      await tx.studentHostelAllotment.updateMany({
        where: {
          college_id: collegeId,
          student_id: studentId,
          session_id: sessionId,
          isActive: true,
        },
        data: { isActive: false, vacatedAt: new Date() },
      });

      // Allot new bed
      return await tx.studentHostelAllotment.create({
        data: {
          college_id: collegeId,
          campus_id: campusId,
          student_id: studentId,
          session_id: sessionId,
          roomId,
          bedNumber: bedNum,
          isActive: true,
        },
        include: { room: true },
      });
    });
  }

  /**
   * Vacate a student from hostel bed allotment.
   */
  async vacateBed({ collegeId, allotmentId }) {
    return await prisma.studentHostelAllotment.update({
      where: { id: allotmentId },
      data: {
        isActive: false,
        vacatedAt: new Date(),
      },
    });
  }

  /**
   * Mark daily night roll-call attendance (09:00 PM curfew).
   * Invariant: ABSENT status automatically enqueues HOSTEL_CURFEW_BREACH outbox event.
   */
  async markNightAttendance({ collegeId, buildingId, studentId, date, status, markedById, remarks = null }) {
    if (!collegeId || !buildingId || !studentId || !date || !status || !markedById) {
      const err = new Error('collegeId, buildingId, studentId, date, status, and markedById are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const attendanceDate = new Date(date);

    return await prisma.$transaction(async (tx) => {
      const record = await tx.hostelNightAttendance.upsert({
        where: {
          college_id_student_id_date: {
            college_id: collegeId,
            student_id: studentId,
            date: attendanceDate,
          },
        },
        create: {
          college_id: collegeId,
          buildingId,
          student_id: studentId,
          date: attendanceDate,
          status,
          markedById,
          remarks,
        },
        update: {
          buildingId,
          status,
          markedById,
          remarks,
        },
      });

      // If marked ABSENT (without authorized HOME_PASS), trigger emergency outbox alert
      if (status === 'ABSENT') {
        await tx.outboxEvent.create({
          data: {
            college_id: collegeId,
            eventType: 'HOSTEL_CURFEW_BREACH',
            payload: {
              studentId,
              buildingId,
              date: attendanceDate.toISOString().split('T')[0],
              status,
              remarks: remarks || 'Unexcused absence during night roll-call curfew inspection',
            },
          },
        });
      }

      return record;
    });
  }

  /**
   * Apply hostel fees to monthly fee vouchers.
   */
  async applyHostelFeesToVoucher({ collegeId, sessionId, month, studentId = null }) {
    const where = {
      college_id: collegeId,
      session_id: sessionId,
      isActive: true,
    };
    if (studentId) where.student_id = studentId;

    const allotments = await prisma.studentHostelAllotment.findMany({
      where,
      include: { room: true },
    });

    const results = [];
    for (const alloc of allotments) {
      const rent = alloc.room.monthlyRentPkr;
      if (rent > 0) {
        const fee = await prisma.fee.create({
          data: {
            college_id: collegeId,
            session_id: sessionId,
            student_id: alloc.student_id,
            title: `Hostel Fee - ${month} (Room ${alloc.room.roomNumber})`,
            month,
            totalAmount: rent,
            paidAmount: 0,
            status: 'unpaid',
          },
        });
        results.push(fee);
      }
    }

    return {
      appliedCount: results.length,
      totalPkr: results.reduce((sum, f) => sum + Number(f.totalAmount), 0),
      fees: results,
    };
  }
}

module.exports = new HostelService();
