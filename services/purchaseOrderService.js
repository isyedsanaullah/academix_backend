'use strict';

const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();
const { checkAndCreateApprovalRequest } = require('./approvalService');

class PurchaseOrderService {
  /**
   * Register a new vendor.
   */
  async createVendor({ collegeId, name, phone, contactPerson = null, ntnNumber = null, bankName = null, iban = null }) {
    if (!collegeId || !name || !phone) {
      const err = new Error('collegeId, name, and phone are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    return await prisma.vendor.create({
      data: {
        college_id: collegeId,
        name,
        phone,
        contactPerson,
        ntnNumber,
        bankName,
        iban,
      },
    });
  }

  /**
   * Create a purchase order with line items.
   * Integrates with N11 Approval Workflow if threshold exceeded and chain exists.
   */
  async createPurchaseOrder({
    collegeId,
    campusId = null,
    vendorId,
    poNumber,
    items = [],
    orderDate = new Date(),
    deliveryDueDate = null,
    createdById,
    creatorUser = null,
    budgetId = null,
  }) {
    if (!collegeId || !vendorId || !poNumber || !createdById || !items.length) {
      const err = new Error('collegeId, vendorId, poNumber, createdById, and non-empty items are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, college_id: collegeId },
    });
    if (!vendor) {
      const err = new Error('Vendor not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Compute total amount
    const totalAmountPkr = items.reduce((sum, item) => {
      const qty = Number(item.quantity) || 1;
      const unit = Number(item.unitPricePkr) || 0;
      return sum + (qty * unit);
    }, 0);

    // Optional N41 budget check
    if (budgetId) {
      const budgetService = require('./budgetService');
      await budgetService.checkAndCommitBudget({
        collegeId,
        budgetId,
        amountPkr: totalAmountPkr,
        referenceType: 'PURCHASE_ORDER',
        referenceId: poNumber,
      });
    }

    // Create PO and items
    const po = await prisma.$transaction(async (tx) => {
      const createdPo = await tx.purchaseOrder.create({
        data: {
          college_id: collegeId,
          campus_id: campusId,
          poNumber,
          vendorId,
          status: 'DRAFT',
          totalAmountPkr,
          orderDate: new Date(orderDate),
          deliveryDueDate: deliveryDueDate ? new Date(deliveryDueDate) : null,
          createdById,
        },
      });

      for (const item of items) {
        const qty = Number(item.quantity) || 1;
        const unit = Number(item.unitPricePkr) || 0;
        await tx.purchaseOrderItem.create({
          data: {
            poId: createdPo.id,
            description: item.description,
            quantity: qty,
            unitPricePkr: unit,
            totalPricePkr: qty * unit,
          },
        });
      }

      return await tx.purchaseOrder.findUnique({
        where: { id: createdPo.id },
        include: { items: true, vendor: true },
      });
    });

    // Check if college has threshold or approval chain
    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { settings: true },
    });
    const threshold = (college && college.settings && college.settings.poApprovalThresholdPkr) 
      ? Number(college.settings.poApprovalThresholdPkr) 
      : 25000;

    let requiresApproval = false;
    let approvalRequestId = null;

    if (totalAmountPkr >= threshold) {
      try {
        const approvalRes = await checkAndCreateApprovalRequest({
          collegeId,
          campusId,
          workflowType: 'PURCHASE_ORDER',
          requesterUser: creatorUser || { id: createdById, role: 'accountant' },
          payload: {
            poId: po.id,
            poNumber,
            amount: totalAmountPkr,
            vendorName: vendor.name,
          },
        });

        if (approvalRes && approvalRes.requiresApproval) {
          requiresApproval = true;
          approvalRequestId = approvalRes.request.id;
          await prisma.purchaseOrder.update({
            where: { id: po.id },
            data: { status: 'IN_REVIEW' },
          });
        } else {
          // Direct execution
          await prisma.purchaseOrder.update({
            where: { id: po.id },
            data: { status: 'APPROVED' },
          });
        }
      } catch (err) {
        // If no active chain configured, keep as APPROVED
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'APPROVED' },
        });
      }
    } else {
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'APPROVED' },
      });
    }

    const refreshedPo = await prisma.purchaseOrder.findUnique({
      where: { id: po.id },
      include: { items: true, vendor: true },
    });

    return {
      po: refreshedPo,
      requiresApproval,
      approvalRequestId,
    };
  }

  /**
   * List purchase orders.
   */
  async listPurchaseOrders({ collegeId, status = null, vendorId = null }) {
    const where = { college_id: collegeId };
    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;

    return await prisma.purchaseOrder.findMany({
      where,
      include: { items: true, vendor: true },
      orderBy: { orderDate: 'desc' },
    });
  }
}

module.exports = new PurchaseOrderService();
