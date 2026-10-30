'use strict';

const { getSystemClient } = require('../config/prismaManager');
const { sendSubscriptionRequestEmail, sendContactDeveloperEmail } = require('../utils/emailService');
const mailService = require('../services/mailService');
const {
  transitionRequestStatus,
  addRequestNote
} = require('../services/subscriptionRequestTransition');
const {
  checkSlugAvailability: serviceCheckSlug,
  approveAndProvisionCollege,
  resendCollegeInvite: serviceResendInvite,
  revokeCollegeInvite: serviceRevokeInvite,
  getCollegeInviteStatus: serviceGetInviteStatus
} = require('../services/collegeProvisioning');

const VALID_PLANS = ['free', 'basic', 'standard', 'premium', 'enterprise', 'ownership', 'custom', 'professional'];
const VALID_STATUSES = ['new', 'contacted', 'approved', 'rejected'];

/**
 * @desc    Get all active subscription plans for public display
 * @route   GET /api/public/subscription-plans
 * @access  Public
 */
exports.getSubscriptionPlans = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const plans = await prisma.subscription.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to validate email format
 */
const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

/**
 * Helper to validate phone format
 */
const isValidPhone = (phone) => {
  const re = /^\+?[0-9\s\-]{7,15}$/;
  return re.test(String(phone));
};

/**
 * @desc    Submit a new subscription request
 * @route   POST /api/public/subscription-request
 * @access  Public
 */
exports.submitSubscriptionRequest = async (req, res, next) => {
  try {
    const { collegeName, adminEmail, phone, selectedPlan, studentCount, message, preferredContact } = req.body;

    // 1. Validation
    if (!collegeName?.trim()) {
      return res.status(400).json({ success: false, message: 'College name is required' });
    }
    if (!adminEmail?.trim() || !isValidEmail(adminEmail)) {
      return res.status(400).json({ success: false, message: 'A valid administrator email is required' });
    }
    if (!phone?.trim() || !isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: 'A valid contact phone number is required' });
    }
    if (!selectedPlan || !VALID_PLANS.includes(selectedPlan.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Invalid subscription plan selected' });
    }
    
    const parsedStudents = parseInt(studentCount, 10);
    if (isNaN(parsedStudents) || parsedStudents <= 0) {
      return res.status(400).json({ success: false, message: 'Student count must be a positive number' });
    }

    const prisma = getSystemClient();

    // 2. Duplicate protection (check last 15 minutes)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentRequest = await prisma.subscriptionRequest.findFirst({
      where: {
        adminEmail: adminEmail.toLowerCase(),
        createdAt: { gte: fifteenMinutesAgo }
      }
    });

    if (recentRequest) {
      return res.status(429).json({
        success: false,
        message: 'A subscription request from this email was already submitted recently. Please wait a few minutes before trying again.'
      });
    }

    // 3. Save to database
    const request = await prisma.subscriptionRequest.create({
      data: {
        collegeName: collegeName.trim(),
        adminEmail: adminEmail.toLowerCase().trim(),
        phone: phone.trim(),
        selectedPlan: selectedPlan.toLowerCase(),
        studentCount: parsedStudents,
        message: message?.trim() || null,
        notes: preferredContact ? `Preferred Contact: ${preferredContact}` : null,
        status: 'new'
      }
    });

    // 4. Send Email Notification
    try {
      await sendSubscriptionRequestEmail('syyedsanaullah@gmail.com', {
        collegeName: request.collegeName,
        adminEmail: request.adminEmail,
        phone: request.phone,
        selectedPlan: request.selectedPlan,
        studentCount: request.studentCount,
        message: request.message,
        timestamp: request.createdAt
      });
    } catch (emailErr) {
      console.error('Subscription request saved but email notification failed:', emailErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Subscription request submitted successfully! We will contact you soon.',
      data: {
        id: request.id,
        collegeName: request.collegeName,
        adminEmail: request.adminEmail,
        status: request.status
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Submit a contact form message
 * @route   POST /api/public/contact
 * @access  Public
 */
exports.submitContactForm = async (req, res, next) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!email?.trim() || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }
    if (!subject?.trim()) {
      return res.status(400).json({ success: false, message: 'Subject is required' });
    }
    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    await sendContactDeveloperEmail({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone?.trim() || null,
      subject: subject.trim(),
      message: message.trim()
    });

    res.status(200).json({
      success: true,
      message: 'Your message has been sent successfully. Thank you for contacting us!'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get subscription requests list with filters and status counts
 * @route   GET /api/super-admin/subscription-requests
 * @access  Private (superAdmin)
 */
exports.getSubscriptionRequests = async (req, res, next) => {
  try {
    const { search, plan, status, startDate, endDate, page = 1, limit = 10 } = req.query;
    const prisma = getSystemClient();
    const where = {};
    const andFilters = [];

    // Search filter
    if (search?.trim()) {
      andFilters.push({
        OR: [
          { collegeName: { contains: search.trim(), mode: 'insensitive' } },
          { adminEmail: { contains: search.trim(), mode: 'insensitive' } },
          { phone: { contains: search.trim(), mode: 'insensitive' } }
        ]
      });
    }

    // Plan filter
    if (plan && VALID_PLANS.includes(plan.toLowerCase())) {
      andFilters.push({ selectedPlan: plan.toLowerCase() });
    }

    // Status filter
    if (status && status !== 'all' && VALID_STATUSES.includes(status.toLowerCase())) {
      andFilters.push({ status: status.toLowerCase() });
    }

    // Date range filter
    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) {
        const eDate = new Date(endDate);
        eDate.setHours(23, 59, 59, 999);
        dateFilter.lte = eDate;
      }
      andFilters.push({ createdAt: dateFilter });
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skipNum = (pageNum - 1) * limitNum;

    // Parallel execution for counts and items
    const [total, requests, countAll, countNew, countContacted, countApproved, countRejected] = await Promise.all([
      prisma.subscriptionRequest.count({ where }),
      prisma.subscriptionRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipNum,
        take: limitNum,
        include: {
          events: {
            orderBy: { created_at: 'desc' },
            take: 3
          }
        }
      }),
      prisma.subscriptionRequest.count(),
      prisma.subscriptionRequest.count({ where: { status: 'new' } }),
      prisma.subscriptionRequest.count({ where: { status: 'contacted' } }),
      prisma.subscriptionRequest.count({ where: { status: 'approved' } }),
      prisma.subscriptionRequest.count({ where: { status: 'rejected' } })
    ]);

    res.json({
      success: true,
      data: requests.map(r => ({ ...r, _id: r.id })),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum) || 1
      },
      counts: {
        all: countAll,
        new: countNew,
        contacted: countContacted,
        approved: countApproved,
        rejected: countRejected
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single subscription request detail with full timeline
 * @route   GET /api/super-admin/subscription-requests/:id
 * @access  Private (superAdmin)
 */
exports.getSubscriptionRequest = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const request = await prisma.subscriptionRequest.findUnique({
      where: { id: req.params.id },
      include: {
        events: {
          orderBy: { created_at: 'desc' }
        }
      }
    });

    if (!request) {
      return res.status(404).json({ success: false, message: 'Subscription request not found' });
    }

    res.json({
      success: true,
      data: { ...request, _id: request.id }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark subscription request as contacted (or re-open from rejected)
 * @route   PATCH /api/super-admin/subscription-requests/:id/contact
 * @access  Private (superAdmin)
 */
exports.markContacted = async (req, res, next) => {
  try {
    const { note } = req.body;
    const result = await transitionRequestStatus({
      requestId: req.params.id,
      targetStatus: 'contacted',
      actorUser: req.user,
      note
    });

    res.json({
      success: true,
      message: result.idempotent 
        ? 'Request is already in contacted state.' 
        : 'Subscription request marked as contacted.',
      data: { ...result.request, _id: result.request.id },
      event: result.event
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * @desc    Reject a subscription request with required reason (5-500 chars)
 * @route   PATCH /api/super-admin/subscription-requests/:id/reject
 * @access  Private (superAdmin)
 */
exports.rejectSubscriptionRequest = async (req, res, next) => {
  try {
    const { reason, notifyRequester = false } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required and must be between 5 and 500 characters.'
      });
    }

    const result = await transitionRequestStatus({
      requestId: req.params.id,
      targetStatus: 'rejected',
      actorUser: req.user,
      rejectionReason: reason.trim()
    });

    // Optional notification email to requester
    let emailStatus = null;
    if (notifyRequester && result.request.adminEmail) {
      const subject = `Update regarding your Collegeshub subscription request for ${result.request.collegeName}`;
      const bodyHtml = `
        <p>Dear Administrator,</p>
        <p>Thank you for your interest in Collegeshub for <strong>${result.request.collegeName}</strong>.</p>
        <p>After careful review of your application, we are unable to approve your subscription request at this time.</p>
        <div style="background:rgba(255,255,255,0.04);border-left:4px solid #ef4444;padding:12px 16px;margin:20px 0;border-radius:4px;">
          <p style="margin:0;color:#cbd5e1;font-size:13px;">${reason.trim()}</p>
        </div>
        <p>If you believe this decision was made in error or if your requirements have changed, please feel free to submit a revised request or contact our admissions team.</p>
      `;

      const html = mailService.buildCollegeshubTemplate({
        title: 'Subscription Request Status Update',
        bodyHtml,
        footerNote: 'Collegeshub Admissions & Platform Operations'
      });

      const text = mailService.toPlainText({
        title: 'Subscription Request Status Update',
        bodyText: `Dear Administrator,\n\nThank you for your interest in Collegeshub for ${result.request.collegeName}.\n\nAfter review, we are unable to approve your request at this time.\nReason: ${reason.trim()}\n\nBest regards,\nCollegeshub Team`
      });

      const sendResult = await mailService.send({
        to: result.request.adminEmail,
        subject,
        html,
        text
      });

      emailStatus = sendResult.success ? 'sent' : `failed: ${sendResult.error}`;
    }

    res.json({
      success: true,
      message: 'Subscription request rejected.',
      data: { ...result.request, _id: result.request.id },
      event: result.event,
      emailStatus
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * @desc    Add an internal note to subscription request
 * @route   POST /api/super-admin/subscription-requests/:id/notes
 * @access  Private (superAdmin)
 */
exports.addSubscriptionRequestNote = async (req, res, next) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, message: 'Note text cannot be empty' });
    }

    const result = await addRequestNote({
      requestId: req.params.id,
      note: note.trim(),
      actorUser: req.user
    });

    res.json({
      success: true,
      message: 'Note added to subscription request.',
      data: { ...result.request, _id: result.request.id },
      event: result.event
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * @desc    Legacy update handler (maintained for backward compatibility)
 * @route   PUT /api/super-admin/subscription-requests/:id
 * @access  Private (superAdmin)
 */
exports.updateSubscriptionRequest = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    if (status) {
      const result = await transitionRequestStatus({
        requestId: req.params.id,
        targetStatus: status.toLowerCase(),
        actorUser: req.user,
        note: notes
      });
      return res.json({
        success: true,
        message: 'Subscription request updated successfully',
        data: { ...result.request, _id: result.request.id }
      });
    }

    if (notes) {
      const result = await addRequestNote({
        requestId: req.params.id,
        note: notes,
        actorUser: req.user
      });
      return res.json({
        success: true,
        message: 'Subscription request notes updated',
        data: { ...result.request, _id: result.request.id }
      });
    }

    res.json({ success: true, message: 'No changes provided' });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * @desc    Check slug availability for college provisioning
 * @route   GET /api/super-admin/slugs/check
 * @access  Private (superAdmin)
 */
exports.checkSlug = async (req, res, next) => {
  try {
    const { slug } = req.query;
    const result = await serviceCheckSlug(slug);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Approve subscription request and provision college with invite
 * @route   POST /api/super-admin/subscription-requests/:id/approve
 * @access  Private (superAdmin)
 */
exports.approveSubscriptionRequest = async (req, res, next) => {
  try {
    const {
      collegeName,
      slug,
      adminEmail,
      plan,
      features,
      startsAt,
      expiresAt
    } = req.body;

    const result = await approveAndProvisionCollege({
      requestId: req.params.id,
      collegeName,
      slug,
      adminEmail,
      plan,
      features,
      startsAt,
      expiresAt,
      actorUser: req.user
    });

    res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * @desc    Resend invite email to college admin
 * @route   POST /api/super-admin/colleges/:id/invite/resend
 * @access  Private (superAdmin)
 */
exports.resendCollegeInvite = async (req, res, next) => {
  try {
    const result = await serviceResendInvite({
      collegeId: req.params.id,
      actorUser: req.user
    });
    res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * @desc    Revoke active invite link for a college
 * @route   POST /api/super-admin/colleges/:id/invite/revoke
 * @access  Private (superAdmin)
 */
exports.revokeCollegeInvite = async (req, res, next) => {
  try {
    const result = await serviceRevokeInvite({
      collegeId: req.params.id
    });
    res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * @desc    Get current invite status for a college
 * @route   GET /api/super-admin/colleges/:id/invite
 * @access  Private (superAdmin)
 */
exports.getCollegeInviteStatus = async (req, res, next) => {
  try {
    const result = await serviceGetInviteStatus(req.params.id);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};
