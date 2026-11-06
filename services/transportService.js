'use strict';

const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

class TransportService {
  /**
   * Create a new transport route.
   */
  async createRoute({ collegeId, campusId = null, routeNumber, description = null, monthlyFarePkr }) {
    if (!collegeId || !routeNumber || monthlyFarePkr === undefined) {
      const err = new Error('collegeId, routeNumber, and monthlyFarePkr are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    return await prisma.transportRoute.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        routeNumber,
        description,
        monthlyFarePkr: Number(monthlyFarePkr),
      },
    });
  }

  /**
   * Add a stop to a route.
   */
  async addStop({ routeId, stopName, pickupTime, dropTime, stopOrder }) {
    return await prisma.transportStop.create({
      data: {
        routeId,
        stopName,
        pickupTime,
        dropTime,
        stopOrder: Number(stopOrder),
      },
    });
  }

  /**
   * Register a transport vehicle.
   */
  async addVehicle({
    collegeId,
    campusId = null,
    routeId = null,
    registrationNo,
    seatCapacity,
    driverName,
    driverPhone,
    conductorName = null,
    fitnessCertExpires = null,
  }) {
    return await prisma.transportVehicle.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        routeId,
        registrationNo,
        seatCapacity: Number(seatCapacity),
        driverName,
        driverPhone,
        conductorName,
        fitnessCertExpires: fitnessCertExpires ? new Date(fitnessCertExpires) : null,
      },
    });
  }

  /**
   * Allocate a student to a transport route & stop.
   * Enforces capacity and single active route allocation.
   */
  async allocateStudent({ collegeId, campusId = null, studentId, sessionId, routeId, stopId }) {
    if (!collegeId || !studentId || !sessionId || !routeId || !stopId) {
      const err = new Error('collegeId, studentId, sessionId, routeId, and stopId are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const route = await prisma.transportRoute.findFirst({
      where: { id: routeId, college_id: collegeId },
      include: {
        vehicles: { where: { isActive: true } },
      },
    });
    if (!route) {
      const err = new Error('Transport route not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Capacity calculation
    const totalCapacity = route.vehicles.reduce((sum, v) => sum + v.seatCapacity, 0);
    if (totalCapacity > 0) {
      const activeAllocations = await prisma.studentTransportAllocation.count({
        where: { routeId, isActive: true },
      });
      if (activeAllocations >= totalCapacity) {
        const err = new Error(`Route capacity exceeded (Allocated: ${activeAllocations}/${totalCapacity})`);
        err.code = 'ROUTE_CAPACITY_EXCEEDED';
        throw err;
      }
    }

    return await prisma.$transaction(async (tx) => {
      // Deactivate any existing active allocation for this student in this session
      await tx.studentTransportAllocation.updateMany({
        where: {
          college_id: collegeId,
          student_id: studentId,
          session_id: sessionId,
          isActive: true,
        },
        data: { isActive: false },
      });

      // Create new active allocation
      return await tx.studentTransportAllocation.create({
        data: {
          college_id: collegeId,
          campus_id: campusId,
          student_id: studentId,
          session_id: sessionId,
          routeId,
          stopId,
          isActive: true,
        },
        include: { route: true },
      });
    });
  }

  /**
   * Deallocate student from transport.
   */
  async deallocateStudent({ collegeId, allocationId }) {
    return await prisma.studentTransportAllocation.update({
      where: { id: allocationId },
      data: { isActive: false },
    });
  }

  /**
   * Integration with monthly fee generation:
   * Generates or attaches transport fee voucher line items for all active student allocations.
   */
  async applyTransportFeesToVoucher({ collegeId, sessionId, month, studentId = null }) {
    const where = {
      college_id: collegeId,
      session_id: sessionId,
      isActive: true,
    };
    if (studentId) where.student_id = studentId;

    const allocations = await prisma.studentTransportAllocation.findMany({
      where,
      include: { route: true },
    });

    const results = [];
    for (const alloc of allocations) {
      const fare = alloc.route.monthlyFarePkr;
      if (fare > 0) {
        // Create fee record for student
        const fee = await prisma.fee.create({
          data: {
            college_id: collegeId,
            session_id: sessionId,
            student_id: alloc.student_id,
            title: `Transport Fee - ${month} (${alloc.route.routeNumber})`,
            month,
            totalAmount: fare,
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

module.exports = new TransportService();
