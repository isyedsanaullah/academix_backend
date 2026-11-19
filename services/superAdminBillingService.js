'use strict';

const { getFrontendBaseUrl } = require('../config/env');
const { PLAN_PRICING } = require('../config/planConstants');
const { BANK_DETAILS } = require('../config/billingConfig');
const {
  computeSubscriptionSnapshot,
  transitionCollegeSubStatus,
} = require('./subscriptionStateService');
const { sendBillingDecisionEmail } = require('./mailService');

function mapLineItemsPaid(lineItems) {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.map((item) => ({
    ...item,
    status: item.itemType === 'PRORATION_CREDIT' ? 'APPLIED' : 'PAID',
  }));
}

/**
 * Super Admin Overview: all colleges with live subscription snapshot, locked subscription,
 * latest invoice, pending-review indicator, plus summary counts & filters.
 */
async function getBillingOverview(prisma, {
  status = 'ALL',
  invoiceStatus = 'ALL',
  planId = 'ALL',
  search = '',
  page = 1,
  limit = 50,
} = {}) {
  const colleges = await prisma.college.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      email: true,
      city: true,
      isActive: true,
      planId: true,
      billingCycle: true,
      subStatus: true,
      trialStartedAt: true,
      trialEndsAt: true,
      periodStart: true,
      periodEnd: true,
      forceReadOnly: true,
      readOnlyReason: true,
      activeSubscriptionId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const collegeIds = colleges.map((c) => c.id);
  const [subscriptions, invoices] = collegeIds.length > 0
    ? await Promise.all([
        prisma.collegeSubscription.findMany({
          where: { college_id: { in: collegeIds } },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.platformInvoice.findMany({
          where: { college_id: { in: collegeIds } },
          orderBy: { createdAt: 'desc' },
        }),
      ])
    : [[], []];

  const subById = new Map(subscriptions.map((s) => [s.id, s]));
  const subsByCollege = new Map();
  for (const s of subscriptions) {
    if (!subsByCollege.has(s.college_id)) subsByCollege.set(s.college_id, []);
    subsByCollege.get(s.college_id).push(s);
  }

  const invByCollege = new Map();
  for (const inv of invoices) {
    if (!invByCollege.has(inv.college_id)) invByCollege.set(inv.college_id, []);
    invByCollege.get(inv.college_id).push(inv);
  }

  const now = new Date();
  const statusCounts = {
    TRIAL: 0,
    PENDING_PAYMENT: 0,
    ACTIVE: 0,
    EXPIRED: 0,
    DEACTIVATED: 0,
  };
  let pendingReviewInvoicesCount = 0;
  let totalApprovedRevenuePkr = 0;

  for (const inv of invoices) {
    const st = String(inv.status || '').toUpperCase();
    if (st === 'PENDING_REVIEW') pendingReviewInvoicesCount++;
    if (st === 'APPROVED' || st === 'PAID') totalApprovedRevenuePkr += Number(inv.amount || 0);
  }

  const enriched = colleges.map((c) => {
    const snap = computeSubscriptionSnapshot(c, now);
    if (statusCounts[snap.effectiveSubStatus] !== undefined) {
      statusCounts[snap.effectiveSubStatus]++;
    }

    const colSubs = subsByCollege.get(c.id) || [];
    const activeSubscription =
      (c.activeSubscriptionId && subById.get(c.activeSubscriptionId)) ||
      colSubs.find((s) => s.status === 'ACTIVE') ||
      colSubs[0] ||
      null;

    const colInvoices = invByCollege.get(c.id) || [];
    const pendingReviewInvoice = colInvoices.find((i) => i.status === 'PENDING_REVIEW') || null;
    const latestNonVoidInvoice = colInvoices.find((i) => String(i.status || '').toUpperCase() !== 'VOID') || colInvoices[0] || null;

    return {
      college: {
        ...c,
        effectiveSubStatus: snap.effectiveSubStatus,
        daysRemaining: snap.daysRemaining,
        trialDaysRemaining: snap.trialDaysRemaining,
        isLocked: snap.isLocked,
        lockReason: snap.lockReason,
      },
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            planId: activeSubscription.planId,
            planName: activeSubscription.planName,
            planPricePkr: activeSubscription.planPricePkr,
            addonsSnapshot: activeSubscription.addonsSnapshot || [],
            totalPkr: activeSubscription.totalPkr,
            currency: activeSubscription.currency || 'PKR',
            billingCycle: activeSubscription.billingCycle,
            status: activeSubscription.status,
            startsAt: activeSubscription.startsAt,
            endsAt: activeSubscription.endsAt,
          }
        : null,
      latestInvoice: latestNonVoidInvoice
        ? {
            ...latestNonVoidInvoice,
            amount: Number(latestNonVoidInvoice.amount || 0),
          }
        : null,
      pendingReviewInvoice: pendingReviewInvoice
        ? { ...pendingReviewInvoice, amount: Number(pendingReviewInvoice.amount || 0) }
        : null,
      invoiceCount: colInvoices.length,
    };
  });

  // Filtering
  const statusFilter = String(status || 'ALL').toUpperCase();
  const invFilter = String(invoiceStatus || 'ALL').toUpperCase();
  const planFilter = String(planId || 'ALL').toLowerCase();
  const q = String(search || '').trim().toLowerCase();

  const filtered = enriched.filter((row) => {
    if (statusFilter !== 'ALL' && row.college.effectiveSubStatus !== statusFilter) return false;
    if (planFilter !== 'all' && String(row.college.planId || '').toLowerCase() !== planFilter) return false;
    if (invFilter !== 'ALL') {
      if (invFilter === 'NONE' && row.latestInvoice) return false;
      if (invFilter !== 'NONE' && String(row.latestInvoice?.status || '').toUpperCase() !== invFilter) return false;
    }
    if (q) {
      const hay = [
        row.college.name,
        row.college.code,
        row.college.email,
        row.college.city,
        row.latestInvoice?.invoiceNo,
        row.latestInvoice?.referenceNumber,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const total = filtered.length;
  const rows = filtered.slice((safePage - 1) * safeLimit, safePage * safeLimit);

  return {
    summary: {
      totalColleges: colleges.length,
      ...statusCounts,
      pendingReviewInvoicesCount,
      totalApprovedRevenuePkr,
    },
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    },
    rows,
  };
}

/**
 * Full invoice detail for Super Admin inspection (invoice, proof submissions,
 * linked subscription snapshot, college info, and billing history).
 */
async function getInvoiceBillingDetail(prisma, invoiceId) {
  const invoice = await prisma.platformInvoice.findUnique({
    where: { id: invoiceId },
  });
  if (!invoice) {
    const err = new Error('Invoice not found.');
    err.status = 404;
    err.code = 'INVOICE_NOT_FOUND';
    throw err;
  }

  const [college, subscription, submissions, collegeInvoices, auditLogs] = await Promise.all([
    prisma.college.findUnique({
      where: { id: invoice.college_id },
      select: {
        id: true,
        name: true,
        code: true,
        email: true,
        city: true,
        planId: true,
        billingCycle: true,
        subStatus: true,
        trialEndsAt: true,
        periodStart: true,
        periodEnd: true,
        activeSubscriptionId: true,
      },
    }),
    invoice.subscriptionId
      ? prisma.collegeSubscription.findUnique({ where: { id: invoice.subscriptionId } })
      : null,
    prisma.invoiceProofSubmission.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.platformInvoice.findMany({
      where: { college_id: invoice.college_id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.collegeEntitlementAudit.findMany({
      where: { college_id: invoice.college_id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);

  return {
    invoice: { ...invoice, amount: Number(invoice.amount || 0) },
    college: college
      ? { ...college, snapshot: computeSubscriptionSnapshot(college) }
      : null,
    subscription,
    submissions,
    collegeInvoices: collegeInvoices.map((i) => ({ ...i, amount: Number(i.amount || 0) })),
    auditLogs,
  };
}

async function notifyCollegeAdmins(prisma, { collegeId, title, message, link, emailPayload }) {
  const admins = await prisma.user.findMany({
    where: { college_id: collegeId, role: 'admin', isActive: true },
    select: { id: true, email: true },
  });

  if (admins.length > 0 && prisma.notification?.createMany) {
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        college_id: collegeId,
        recipient: a.id,
        title,
        message,
        type: 'system',
        link: link || '/admin/subscription',
      })),
    }).catch(() => {});
  }

  const targetEmail = admins[0]?.email || emailPayload?.fallbackEmail;
  if (targetEmail && emailPayload) {
    await sendBillingDecisionEmail(targetEmail, emailPayload).catch((e) => {
      console.error('[SuperAdminBilling] Decision email failed:', e.message);
    });
  }
}

/**
 * Approve an invoice payment (manual bank transfer):
 *  - Activates the linked CollegeSubscription (keeping locked prices intact!)
 *  - Sets startsAt = now, endsAt = now + term (handles late payments after dueDate cleanly)
 *  - Applies purchased add-ons to CollegeAddon for the term
 *  - Transitions College -> ACTIVE, sets activeSubscriptionId & period dates
 *  - Records CollegeEntitlementAudit + AuditLog
 */
async function approveBillingInvoice(prisma, {
  invoiceId,
  adminUserId,
  adminEmail = null,
  note = null,
  ipAddress = null,
}) {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.platformInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      const err = new Error('Invoice not found.');
      err.status = 404;
      err.code = 'INVOICE_NOT_FOUND';
      throw err;
    }

    const currentStatus = String(invoice.status || '').toUpperCase();
    if (currentStatus === 'APPROVED' || currentStatus === 'PAID') {
      const err = new Error('Invoice has already been approved.');
      err.status = 400;
      err.code = 'ALREADY_APPROVED';
      throw err;
    }
    if (currentStatus === 'VOID') {
      const err = new Error('Cannot approve a voided invoice.');
      err.status = 400;
      err.code = 'INVOICE_VOID';
      throw err;
    }

    const college = await tx.college.findUnique({ where: { id: invoice.college_id } });
    if (!college) {
      const err = new Error('College not found.');
      err.status = 404;
      err.code = 'COLLEGE_NOT_FOUND';
      throw err;
    }

    const billingCycle = String(invoice.billingCycle || 'MONTHLY').toUpperCase() === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
    const cycleDays = billingCycle === 'YEARLY' ? 365 : 30;
    const endsAt = new Date(now.getTime() + cycleDays * 86400000);
    const planId = invoice.planId || college.planId || 'standard';
    const reviewer = adminEmail || adminUserId || 'superAdmin';
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;

    // 1. Activate locked CollegeSubscription (supersede previous ACTIVE term)
    await tx.collegeSubscription.updateMany({
      where: {
        college_id: college.id,
        status: 'ACTIVE',
        ...(invoice.subscriptionId ? { id: { not: invoice.subscriptionId } } : {}),
      },
      data: { status: 'SUPERSEDED' },
    });

    let subscription = null;
    if (invoice.subscriptionId) {
      subscription = await tx.collegeSubscription.update({
        where: { id: invoice.subscriptionId },
        data: {
          status: 'ACTIVE',
          startsAt: now,
          endsAt,
          activatedAt: now,
        },
      });
    } else {
      const fallbackPlanPrice = billingCycle === 'YEARLY'
        ? (PLAN_PRICING[planId]?.yearly ?? Number(invoice.amount || 0))
        : (PLAN_PRICING[planId]?.monthly ?? Number(invoice.amount || 0));
      subscription = await tx.collegeSubscription.create({
        data: {
          college_id: college.id,
          status: 'ACTIVE',
          planId,
          planName: planId.charAt(0).toUpperCase() + planId.slice(1),
          planPricePkr: fallbackPlanPrice,
          addonsSnapshot: [],
          subtotalPkr: Number(invoice.amount || fallbackPlanPrice),
          prorationCreditPkr: 0,
          totalPkr: Number(invoice.amount || fallbackPlanPrice),
          currency: invoice.currency || 'PKR',
          billingCycle,
          startsAt: now,
          endsAt,
          activatedAt: now,
          createdBy: adminUserId || 'superAdmin',
        },
      });
    }

    // 2. Apply purchased add-ons snapshot to CollegeAddon for the new term
    const addonsList = Array.isArray(subscription.addonsSnapshot) ? subscription.addonsSnapshot : [];
    for (const addon of addonsList) {
      if (!addon?.addonType || !addon?.quantity || addon.quantity <= 0) continue;
      if (tx.collegeAddon?.create) {
        await tx.collegeAddon.create({
          data: {
            college_id: college.id,
            addonType: addon.addonType,
            quantity: Number(addon.quantity),
            status: 'ACTIVE',
            startsAt: now,
            expiresAt: endsAt,
            sourcePaymentId: invoice.id,
          },
        }).catch(() => {});
      }
    }

    // 3. Mark invoice & proof submissions APPROVED
    const updatedInvoice = await tx.platformInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'APPROVED',
        subscriptionId: subscription.id,
        paidAt: now,
        periodStart: now,
        periodEnd: endsAt,
        rejectionReason: null,
        reviewedAt: now,
        reviewedBy: reviewer,
        verifiedBy: reviewer,
        lineItems: mapLineItemsPaid(invoice.lineItems),
      },
    });

    await tx.invoiceProofSubmission.updateMany({
      where: { invoiceId: invoice.id, status: 'PENDING_REVIEW' },
      data: {
        status: 'APPROVED',
        reviewedBy: reviewer,
        reviewedAt: now,
      },
    });

    // 4. Transition College -> ACTIVE with activeSubscriptionId
    const updatedCollege = await transitionCollegeSubStatus(tx, {
      collegeId: college.id,
      toStatus: 'ACTIVE',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      reason: cleanNote || `Approved payment for invoice ${invoice.invoiceNo} (paid${invoice.dueDate && now > new Date(invoice.dueDate) ? ' after due date' : ''})`,
      auditAction: 'BILLING_INVOICE_APPROVED',
      paymentId: invoice.id,
      ipAddress,
      extraUpdates: {
        planId: subscription.planId,
        billingCycle,
        periodStart: now,
        periodEnd: endsAt,
        activeSubscriptionId: subscription.id,
      },
    });

    if (tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          college_id: college.id,
          user_id: String(adminUserId || 'superAdmin'),
          action: 'BILLING_INVOICE_APPROVED',
          resource: 'PlatformInvoice',
          resourceId: invoice.id,
          details: JSON.stringify({
            invoiceNo: invoice.invoiceNo,
            subscriptionId: subscription.id,
            planId: subscription.planId,
            billingCycle,
            lockedTotalPkr: subscription.totalPkr,
            endsAt,
            note: cleanNote,
          }),
          ipAddress,
        },
      }).catch(() => {});
    }

    return {
      invoice: { ...updatedInvoice, amount: Number(updatedInvoice.amount || 0) },
      subscription,
      college: updatedCollege,
    };
  });

  // Post-commit notification + email
  const baseUrl = getFrontendBaseUrl();
  await notifyCollegeAdmins(prisma, {
    collegeId: result.college.id,
    title: `Payment Approved: ${result.invoice.invoiceNo}`,
    message: `Your ${result.subscription.planName} (${result.subscription.billingCycle}) subscription is now ACTIVE until ${new Date(result.subscription.endsAt).toLocaleDateString('en-PK', { timeZone: 'Asia/Karachi' })}.`,
    link: '/admin/subscription',
    emailPayload: {
      fallbackEmail: result.college.email,
      collegeName: result.college.name,
      invoiceNo: result.invoice.invoiceNo,
      decision: 'APPROVED',
      amountPkr: Number(result.invoice.amount || result.subscription.totalPkr),
      planName: result.subscription.planName,
      billingCycle: result.subscription.billingCycle,
      periodEnd: result.subscription.endsAt,
      portalUrl: `${baseUrl}/admin/subscription`,
    },
  });

  return result;
}

/**
 * Reject an invoice payment proof with mandatory reason; college can re-upload.
 */
async function denyBillingInvoice(prisma, {
  invoiceId,
  adminUserId,
  adminEmail = null,
  reason,
  ipAddress = null,
}) {
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (cleanReason.length < 3) {
    const err = new Error('A denial reason of at least 3 characters is required.');
    err.status = 400;
    err.code = 'MISSING_DENIAL_REASON';
    throw err;
  }

  const now = new Date();
  const reviewer = adminEmail || adminUserId || 'superAdmin';

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.platformInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      const err = new Error('Invoice not found.');
      err.status = 404;
      err.code = 'INVOICE_NOT_FOUND';
      throw err;
    }

    const currentStatus = String(invoice.status || '').toUpperCase();
    if (currentStatus === 'APPROVED' || currentStatus === 'PAID') {
      const err = new Error('Cannot reject an already approved invoice.');
      err.status = 400;
      err.code = 'INVOICE_ALREADY_APPROVED';
      throw err;
    }
    if (currentStatus === 'VOID') {
      const err = new Error('Cannot reject a voided invoice.');
      err.status = 400;
      err.code = 'INVOICE_VOID';
      throw err;
    }

    const college = await tx.college.findUnique({
      where: { id: invoice.college_id },
      select: { id: true, name: true, email: true, subStatus: true },
    });

    const updatedInvoice = await tx.platformInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'REJECTED',
        rejectionReason: cleanReason,
        reviewedAt: now,
        reviewedBy: reviewer,
      },
    });

    await tx.invoiceProofSubmission.updateMany({
      where: { invoiceId: invoice.id, status: 'PENDING_REVIEW' },
      data: {
        status: 'REJECTED',
        rejectionReason: cleanReason,
        reviewedBy: reviewer,
        reviewedAt: now,
      },
    });

    if (tx.collegeEntitlementAudit?.create) {
      await tx.collegeEntitlementAudit.create({
        data: {
          college_id: invoice.college_id,
          actorUserId: String(adminUserId || 'superAdmin'),
          actorEmail: adminEmail || null,
          action: 'BILLING_INVOICE_REJECTED',
          beforeStateJson: { invoiceStatus: currentStatus, invoiceNo: invoice.invoiceNo },
          afterStateJson: { invoiceStatus: 'REJECTED', rejectionReason: cleanReason },
          reason: cleanReason,
          paymentId: invoice.id,
          ipAddress,
        },
      });
    }

    if (tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          college_id: invoice.college_id,
          user_id: String(adminUserId || 'superAdmin'),
          action: 'BILLING_INVOICE_REJECTED',
          resource: 'PlatformInvoice',
          resourceId: invoice.id,
          details: JSON.stringify({ invoiceNo: invoice.invoiceNo, reason: cleanReason }),
          ipAddress,
        },
      }).catch(() => {});
    }

    return {
      invoice: { ...updatedInvoice, amount: Number(updatedInvoice.amount || 0) },
      college,
    };
  });

  const baseUrl = getFrontendBaseUrl();
  await notifyCollegeAdmins(prisma, {
    collegeId: result.invoice.college_id,
    title: `Payment Proof Rejected: ${result.invoice.invoiceNo}`,
    message: `Reason: ${cleanReason}. Please re-upload a clear bank transfer receipt.`,
    link: '/admin/choose-plan',
    emailPayload: {
      fallbackEmail: result.college?.email,
      collegeName: result.college?.name,
      invoiceNo: result.invoice.invoiceNo,
      decision: 'REJECTED',
      amountPkr: Number(result.invoice.amount || 0),
      reason: cleanReason,
      portalUrl: `${baseUrl}/admin/choose-plan`,
    },
  });

  return result;
}

/**
 * Super Admin manual Activate / Deactivate college subscription (writes audit log + state machine).
 */
async function manualToggleCollegeSubscription(prisma, {
  collegeId,
  action,
  reason = '',
  planId = null,
  billingCycle = null,
  adminUserId,
  adminEmail = null,
  ipAddress = null,
}) {
  const act = String(action || '').toUpperCase();
  if (!['ACTIVATE', 'DEACTIVATE'].includes(act)) {
    const err = new Error("Action must be 'ACTIVATE' or 'DEACTIVATE'.");
    err.status = 400;
    err.code = 'INVALID_ACTION';
    throw err;
  }

  const cleanReason = typeof reason === 'string' && reason.trim()
    ? reason.trim().slice(0, 500)
    : (act === 'ACTIVATE' ? 'Manually activated by Super Admin' : 'Manually deactivated by Super Admin');

  const now = new Date();

  return await prisma.$transaction(async (tx) => {
    const college = await tx.college.findUnique({ where: { id: collegeId } });
    if (!college) {
      const err = new Error('College not found.');
      err.status = 404;
      err.code = 'COLLEGE_NOT_FOUND';
      throw err;
    }

    if (act === 'DEACTIVATE') {
      if (tx.collegeSubscription?.updateMany) {
        await tx.collegeSubscription.updateMany({
          where: { college_id: college.id, status: 'ACTIVE' },
          data: {
            status: 'DEACTIVATED',
            deactivatedAt: now,
            deactivatedReason: cleanReason,
          },
        });
      }

      const updatedCollege = await transitionCollegeSubStatus(tx, {
        collegeId: college.id,
        toStatus: 'DEACTIVATED',
        actorUserId: adminUserId,
        actorEmail: adminEmail,
        reason: cleanReason,
        readOnlyReason: 'DEACTIVATED',
        auditAction: 'MANUAL_SUBSCRIPTION_DEACTIVATE',
        ipAddress,
      });

      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            college_id: college.id,
            user_id: String(adminUserId || 'superAdmin'),
            action: 'MANUAL_SUBSCRIPTION_DEACTIVATE',
            resource: 'College',
            resourceId: college.id,
            details: JSON.stringify({ reason: cleanReason }),
            ipAddress,
          },
        }).catch(() => {});
      }

      return { college: updatedCollege, action: 'DEACTIVATE' };
    }

    // ACTIVATE
    const resolvedPlanId = (planId || college.planId || 'standard').toLowerCase();
    const resolvedCycle = String(billingCycle || college.billingCycle || 'MONTHLY').toUpperCase() === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
    const cycleDays = resolvedCycle === 'YEARLY' ? 365 : 30;
    const endsAt = (college.periodEnd && new Date(college.periodEnd) > now && !planId && !billingCycle)
      ? new Date(college.periodEnd)
      : new Date(now.getTime() + cycleDays * 86400000);

    let activeSub = null;
    if (college.activeSubscriptionId) {
      const existing = await tx.collegeSubscription.findUnique({ where: { id: college.activeSubscriptionId } });
      if (existing && (!planId || existing.planId === resolvedPlanId) && (!billingCycle || existing.billingCycle === resolvedCycle)) {
        activeSub = await tx.collegeSubscription.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            startsAt: existing.startsAt || now,
            endsAt: existing.endsAt && new Date(existing.endsAt) > now ? existing.endsAt : endsAt,
            activatedAt: existing.activatedAt || now,
            deactivatedAt: null,
            deactivatedReason: null,
          },
        });
      }
    }

    if (!activeSub) {
      await tx.collegeSubscription.updateMany({
        where: { college_id: college.id, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED' },
      });
      const planPricePkr = resolvedCycle === 'YEARLY'
        ? (PLAN_PRICING[resolvedPlanId]?.yearly ?? 0)
        : (PLAN_PRICING[resolvedPlanId]?.monthly ?? 0);
      activeSub = await tx.collegeSubscription.create({
        data: {
          college_id: college.id,
          status: 'ACTIVE',
          planId: resolvedPlanId,
          planName: resolvedPlanId.charAt(0).toUpperCase() + resolvedPlanId.slice(1),
          planPricePkr,
          addonsSnapshot: [],
          subtotalPkr: planPricePkr,
          prorationCreditPkr: 0,
          totalPkr: planPricePkr,
          currency: 'PKR',
          billingCycle: resolvedCycle,
          startsAt: now,
          endsAt,
          activatedAt: now,
          createdBy: adminUserId || 'superAdmin',
        },
      });
    }

    const updatedCollege = await transitionCollegeSubStatus(tx, {
      collegeId: college.id,
      toStatus: 'ACTIVE',
      actorUserId: adminUserId,
      actorEmail: adminEmail,
      reason: cleanReason,
      auditAction: 'MANUAL_SUBSCRIPTION_ACTIVATE',
      ipAddress,
      extraUpdates: {
        planId: activeSub.planId,
        billingCycle: activeSub.billingCycle,
        periodStart: activeSub.startsAt || now,
        periodEnd: activeSub.endsAt || endsAt,
        activeSubscriptionId: activeSub.id,
      },
    });

    if (tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          college_id: college.id,
          user_id: String(adminUserId || 'superAdmin'),
          action: 'MANUAL_SUBSCRIPTION_ACTIVATE',
          resource: 'College',
          resourceId: college.id,
          details: JSON.stringify({
            subscriptionId: activeSub.id,
            planId: activeSub.planId,
            billingCycle: activeSub.billingCycle,
            lockedTotalPkr: activeSub.totalPkr,
            endsAt: activeSub.endsAt,
            reason: cleanReason,
          }),
          ipAddress,
        },
      }).catch(() => {});
    }

    return { college: updatedCollege, subscription: activeSub, action: 'ACTIVATE' };
  });
}

async function getCollegeBillingHistory(prisma, collegeId) {
  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: {
      id: true,
      name: true,
      code: true,
      email: true,
      planId: true,
      billingCycle: true,
      subStatus: true,
      trialStartedAt: true,
      trialEndsAt: true,
      periodStart: true,
      periodEnd: true,
      activeSubscriptionId: true,
      isActive: true,
    },
  });
  if (!college) {
    const err = new Error('College not found.');
    err.status = 404;
    err.code = 'COLLEGE_NOT_FOUND';
    throw err;
  }

  const [subscriptions, invoices, submissions, auditLogs] = await Promise.all([
    prisma.collegeSubscription.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.platformInvoice.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.invoiceProofSubmission.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.collegeEntitlementAudit.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  return {
    college: { ...college, snapshot: computeSubscriptionSnapshot(college) },
    subscriptions,
    invoices: invoices.map((i) => ({ ...i, amount: Number(i.amount || 0) })),
    submissions,
    auditLogs,
    bankDetails: BANK_DETAILS,
  };
}

async function getBillingAuditLogs(prisma, { collegeId = null, action = null, page = 1, limit = 50 } = {}) {
  const where = {};
  if (collegeId) where.college_id = collegeId;
  if (action && action !== 'ALL') where.action = action;

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

  const [logs, total] = await Promise.all([
    prisma.collegeEntitlementAudit.findMany({
      where,
      include: {
        college: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    }),
    prisma.collegeEntitlementAudit.count({ where }),
  ]);

  return {
    logs,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

module.exports = {
  getBillingOverview,
  getInvoiceBillingDetail,
  approveBillingInvoice,
  denyBillingInvoice,
  manualToggleCollegeSubscription,
  getCollegeBillingHistory,
  getBillingAuditLogs,
};
