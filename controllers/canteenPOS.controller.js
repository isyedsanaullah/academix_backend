/**
 * canteenPOS.controller.js — Phase 7D
 * Point-of-Sale Checkout, Shifts, Stock & Meal Account Ledger:
 * - Single open shift constraint (one OPEN shift per cashier)
 * - Dynamic zero-drift shift close formula (Sales + Topups - Refunds)
 * - Race-condition-proof conditional stock decrement
 * - Daily spending limit with PKT day boundaries
 * - Cash-only student meal account topup
 * - Order void & cash drawer refund routing
 * - Cost price snapshots on line items for gross margin reporting
 */

const { getSystemClient } = require('../config/prismaManager');

// Helper to get PKT day bounds (UTC+5)
function getPktDayBounds(d = new Date()) {
  const pktMs = d.getTime() + 5 * 3600 * 1000;
  const pktDate = new Date(pktMs);
  const y = pktDate.getUTCFullYear();
  const m = pktDate.getUTCMonth();
  const day = pktDate.getUTCDate();

  // UTC times corresponding to 00:00:00 and 23:59:59.999 PKT
  const startOfDay = new Date(Date.UTC(y, m, day, -5, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(y, m, day + 1, -5, 0, 0, 0));
  return { startOfDay, endOfDay };
}

/**
 * POST /api/canteen/shifts/open
 */
async function openShift(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const cashierId = req.user.id;
    const { openingCashPkr = 0, notes } = req.body;

    const existingOpen = await prisma.cashierShift.findFirst({
      where: { college_id: collegeId, cashierId, status: 'OPEN' }
    });

    if (existingOpen) {
      return res.status(409).json({
        success: false,
        code: 'SHIFT_ALREADY_OPEN',
        message: 'Cashier already has an active open shift',
        shiftId: existingOpen.id
      });
    }

    const shift = await prisma.$transaction(async (tx) => {
      const s = await tx.cashierShift.create({
        data: {
          college_id: collegeId,
          cashierId,
          openingCashPkr: Number(openingCashPkr),
          status: 'OPEN',
          notes
        }
      });

      if (Number(openingCashPkr) > 0) {
        await tx.cashDrawerTransaction.create({
          data: {
            college_id: collegeId,
            shiftId: s.id,
            cashierId,
            type: 'FLOAT_ADJUST',
            amountPkr: Number(openingCashPkr),
            notes: 'Opening float'
          }
        });
      }

      return s;
    });

    return res.status(201).json({ success: true, shift });
  } catch (error) {
    console.error('[openShift] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to open cashier shift', error: error.message });
  }
}

/**
 * POST /api/canteen/shifts/:id/close
 */
async function closeShift(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const { id } = req.params;
    const { declaredClosingCashPkr, notes } = req.body;

    if (declaredClosingCashPkr === undefined || declaredClosingCashPkr === null) {
      return res.status(400).json({ success: false, message: 'declaredClosingCashPkr is required' });
    }

    const report = await prisma.$transaction(async (tx) => {
      const shift = await tx.cashierShift.findFirst({
        where: { id, college_id: collegeId, status: 'OPEN' }
      });

      if (!shift) {
        throw Object.assign(new Error('Open shift not found'), { status: 404 });
      }

      // Aggregate drawer movements dynamically
      const salesAgg = await tx.cashDrawerTransaction.aggregate({
        where: { shiftId: id, type: 'SALE' },
        _sum: { amountPkr: true }
      });
      const topupAgg = await tx.cashDrawerTransaction.aggregate({
        where: { shiftId: id, type: 'TOPUP' },
        _sum: { amountPkr: true }
      });
      const refundAgg = await tx.cashDrawerTransaction.aggregate({
        where: { shiftId: id, type: 'VOID_REFUND' },
        _sum: { amountPkr: true }
      });

      const systemCashSales = salesAgg._sum.amountPkr || 0;
      const systemCashTopups = topupAgg._sum.amountPkr || 0;
      const systemCashRefunds = Math.abs(refundAgg._sum.amountPkr || 0);

      const expectedClosing = shift.openingCashPkr + systemCashSales + systemCashTopups - systemCashRefunds;
      const declared = Number(declaredClosingCashPkr);
      const discrepancy = declared - expectedClosing;

      const updated = await tx.cashierShift.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          declaredClosingCashPkr: declared,
          expectedClosingCashPkr: expectedClosing,
          systemCashSalesPkr: systemCashSales,
          systemCashTopupsPkr: systemCashTopups,
          systemCashRefundsPkr: systemCashRefunds,
          discrepancyPkr: discrepancy,
          notes: notes || shift.notes
        }
      });

      return updated;
    });

    return res.json({ success: true, report });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[closeShift] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to close shift', error: error.message });
  }
}

/**
 * POST /api/canteen/orders
 * Point-of-Sale checkout with conditional stock decrement and idempotency.
 */
async function createOrder(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const cashierId = req.user.id;
    const {
      clientOrderId,
      customerType = 'WALK_IN',
      paymentMethod = 'CASH',
      studentId = null,
      items = [],
      cashTendered = null,
      discountPkr = 0
    } = req.body;

    if (!clientOrderId) {
      return res.status(400).json({ success: false, message: 'clientOrderId is required for POS idempotency' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Items array must contain at least 1 item' });
    }

    // 1. Idempotency Check
    const existing = await prisma.canteenOrder.findUnique({
      where: {
        college_id_clientOrderId: { college_id: collegeId, clientOrderId }
      },
      include: { items: true }
    });
    if (existing) {
      return res.status(200).json({ success: true, order: existing, idempotentReplay: true });
    }

    // 2. Active Open Shift check
    const activeShift = await prisma.cashierShift.findFirst({
      where: { college_id: collegeId, cashierId, status: 'OPEN' }
    });
    if (!activeShift) {
      return res.status(422).json({
        success: false,
        code: 'NO_OPEN_SHIFT',
        message: 'Cashier must have an active open shift to ring sales'
      });
    }

    const orderResult = await prisma.$transaction(async (tx) => {
      // 3. Process line items and fetch current item prices / stock
      let subtotal = 0;
      const lineItemRecords = [];

      for (const itemInput of items) {
        const itemQty = Number(itemInput.quantity);
        if (itemQty <= 0) continue;

        // Atomic conditional stock decrement
        const stockResult = await tx.$executeRaw`
          UPDATE "CanteenItem"
          SET "stockQuantity" = "stockQuantity" - ${itemQty}
          WHERE id = ${itemInput.itemId} AND "stockQuantity" >= ${itemQty}
        `;

        if (stockResult !== 1) {
          throw Object.assign(
            new Error(`Insufficient stock for item '${itemInput.name || itemInput.itemId}'`),
            { status: 409, code: 'INSUFFICIENT_STOCK' }
          );
        }

        const dbItem = await tx.canteenItem.findUnique({
          where: { id: itemInput.itemId }
        });

        const lineTotal = dbItem.sellingPricePkr * itemQty;
        subtotal += lineTotal;

        lineItemRecords.push({
          item_id: dbItem.id,
          quantity: itemQty,
          unitPricePkr: dbItem.sellingPricePkr,
          costPricePkr: dbItem.costPricePkr, // margin snapshot
          subtotalPkr: lineTotal
        });
      }

      const total = Math.max(0, subtotal - Number(discountPkr));

      // 4. Handle Payment Method
      let change = 0;
      if (paymentMethod === 'CASH') {
        if (cashTendered !== null && Number(cashTendered) < total) {
          throw Object.assign(new Error('Cash tendered is less than order total'), { status: 400 });
        }
        change = cashTendered !== null ? Number(cashTendered) - total : 0;
      } else if (paymentMethod === 'WALLET' || paymentMethod === 'STUDENT_ACCOUNT') {
        if (!studentId) {
          throw Object.assign(new Error('studentId is required for meal account payment'), { status: 400 });
        }

        // Lock meal account FOR UPDATE
        const accounts = await tx.$queryRaw`
          SELECT id, "balancePkr", "dailySpendingLimitPkr"
          FROM "StudentMealAccount"
          WHERE student_id = ${studentId}
          FOR UPDATE
        `;
        const mealAcc = accounts[0];

        if (!mealAcc) {
          throw Object.assign(new Error('Student meal account not found'), { status: 404 });
        }

        if (mealAcc.balancePkr < total) {
          throw Object.assign(
            new Error(`Insufficient balance. Available: PKR ${mealAcc.balancePkr}, Required: PKR ${total}`),
            { status: 422, code: 'INSUFFICIENT_FUNDS' }
          );
        }

        // Daily limit check in PKT calendar day
        const { startOfDay, endOfDay } = getPktDayBounds();
        const txsToday = await tx.mealAccountTransaction.findMany({
          where: {
            student_id: studentId,
            createdAt: { gte: startOfDay, lt: endOfDay }
          }
        });

        let spentToday = 0;
        for (const t of txsToday) {
          if (t.type === 'PURCHASE') spentToday += Math.abs(t.amountPkr);
          if (t.type === 'REFUND') spentToday -= Math.abs(t.amountPkr);
        }

        if (spentToday + total > mealAcc.dailySpendingLimitPkr) {
          throw Object.assign(
            new Error(`Daily spending limit exceeded. Limit: PKR ${mealAcc.dailySpendingLimitPkr}, Spent: PKR ${spentToday}`),
            { status: 422, code: 'DAILY_SPENDING_LIMIT_EXCEEDED' }
          );
        }

        // Decrement balance
        const newBalance = mealAcc.balancePkr - total;
        await tx.studentMealAccount.update({
          where: { id: mealAcc.id },
          data: { balancePkr: newBalance }
        });

        // Record meal transaction
        await tx.mealAccountTransaction.create({
          data: {
            college_id: collegeId,
            student_id: studentId,
            type: 'PURCHASE',
            amountPkr: -total,
            balanceAfterPkr: newBalance,
            cashierId
          }
        });
      }

      // 5. Create Order
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const orderNumber = `ORD-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

      const order = await tx.canteenOrder.create({
        data: {
          college_id: collegeId,
          clientOrderId,
          orderNumber,
          student_id: studentId,
          customerType,
          paymentMethod,
          status: 'COMPLETED',
          subtotalPkr: subtotal,
          discountPkr: Number(discountPkr),
          totalPkr: total,
          cashTendered: cashTendered !== null ? Number(cashTendered) : null,
          changeGiven: change,
          cashierId,
          shiftId: activeShift.id,
          items: {
            create: lineItemRecords
          }
        },
        include: { items: true }
      });

      // 6. Record Cash Drawer Movement if Cash
      if (paymentMethod === 'CASH') {
        await tx.cashDrawerTransaction.create({
          data: {
            college_id: collegeId,
            shiftId: activeShift.id,
            cashierId,
            type: 'SALE',
            amountPkr: total,
            order_id: order.id,
            notes: `Cash sale ${orderNumber}`
          }
        });
      }

      return order;
    });

    return res.status(201).json({ success: true, order: orderResult });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error('[createOrder] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create order', error: error.message });
  }
}

/**
 * POST /api/canteen/accounts/:studentId/topup
 * Cash-only top-up for student meal accounts.
 */
async function topupStudentAccount(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const cashierId = req.user.id;
    const { studentId } = req.params;
    const { amountPkr, notes } = req.body;

    const amount = Number(amountPkr);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Top-up amount must be positive PKR integer' });
    }

    const activeShift = await prisma.cashierShift.findFirst({
      where: { college_id: collegeId, cashierId, status: 'OPEN' }
    });
    if (!activeShift) {
      return res.status(422).json({
        success: false,
        code: 'NO_OPEN_SHIFT',
        message: 'Active shift required for cash top-up'
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Upsert meal account
      const account = await tx.studentMealAccount.upsert({
        where: { student_id: studentId },
        update: { balancePkr: { increment: amount } },
        create: {
          college_id: collegeId,
          student_id: studentId,
          balancePkr: amount,
          status: 'ACTIVE'
        }
      });

      // Record meal account transaction
      await tx.mealAccountTransaction.create({
        data: {
          college_id: collegeId,
          student_id: studentId,
          type: 'TOPUP',
          amountPkr: amount,
          balanceAfterPkr: account.balancePkr,
          cashierId,
          notes
        }
      });

      // Record drawer inflow
      await tx.cashDrawerTransaction.create({
        data: {
          college_id: collegeId,
          shiftId: activeShift.id,
          cashierId,
          type: 'TOPUP',
          amountPkr: amount,
          notes: `Cash top-up for student ${studentId}`
        }
      });

      return account;
    });

    return res.json({
      success: true,
      message: `Account topped up by PKR ${amount}`,
      balancePkr: result.balancePkr
    });
  } catch (error) {
    console.error('[topupStudentAccount] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to top up account', error: error.message });
  }
}

/**
 * POST /api/canteen/orders/:id/void
 */
async function voidOrder(req, res) {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const cashierId = req.user.id;
    const { id } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.canteenOrder.findFirst({
        where: { id, college_id: collegeId },
        include: { items: true, shift: true }
      });

      if (!order) {
        throw Object.assign(new Error('Order not found'), { status: 404 });
      }

      if (order.status === 'VOIDED') {
        return { alreadyVoided: true, order };
      }

      // 1. Restore inventory
      for (const item of order.items) {
        await tx.canteenItem.update({
          where: { id: item.item_id },
          data: { stockQuantity: { increment: item.quantity } }
        });
      }

      // 2. Refund handling
      let voidShiftId = null;
      if (order.paymentMethod === 'CASH') {
        if (order.shift && order.shift.status === 'OPEN') {
          voidShiftId = order.shift.id;
        } else {
          // Disburse from current cashier's open shift
          const currentShift = await tx.cashierShift.findFirst({
            where: { college_id: collegeId, cashierId, status: 'OPEN' }
          });
          if (!currentShift) {
            throw Object.assign(
              new Error('No active open shift found to disburse cash refund'),
              { status: 422, code: 'NO_OPEN_SHIFT_FOR_CASH_REFUND' }
            );
          }
          voidShiftId = currentShift.id;
        }

        // Record negative cash movement (refund)
        await tx.cashDrawerTransaction.create({
          data: {
            college_id: collegeId,
            shiftId: voidShiftId,
            cashierId,
            type: 'VOID_REFUND',
            amountPkr: -order.totalPkr,
            order_id: order.id,
            notes: `Cash refund for voided order ${order.orderNumber}`
          }
        });
      } else if (order.paymentMethod === 'WALLET' || order.paymentMethod === 'STUDENT_ACCOUNT') {
        const acc = await tx.studentMealAccount.update({
          where: { student_id: order.student_id },
          data: { balancePkr: { increment: order.totalPkr } }
        });

        await tx.mealAccountTransaction.create({
          data: {
            college_id: collegeId,
            student_id: order.student_id,
            type: 'REFUND',
            amountPkr: order.totalPkr,
            balanceAfterPkr: acc.balancePkr,
            order_id: order.id,
            cashierId
          }
        });
      }

      // 3. Mark VOIDED
      const voided = await tx.canteenOrder.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidShiftId,
          voidedAt: new Date()
        }
      });

      return { voided };
    });

    return res.json({ success: true, message: 'Order voided successfully', ...result });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error('[voidOrder] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to void order', error: error.message });
  }
}

module.exports = {
  openShift,
  closeShift,
  createOrder,
  topupStudentAccount,
  voidOrder
};

