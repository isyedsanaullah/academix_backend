const { getSystemClient } = require('../config/prismaManager');
const { sendSubscriptionRequestEmail, sendContactDeveloperEmail } = require('../utils/emailService');

const VALID_PLANS = ['free', 'standard', 'premium'];
const VALID_STATUSES = ['new', 'contacted', 'in_review', 'approved', 'rejected', 'converted'];

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
  // Simple check for 10-15 digits, allowing spaces, dashes or plus
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
    // Destination email: syyedsanaullah@gmail.com
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
      // Don't fail the request response if the email sending fails (but log it)
      console.error('Subscription request saved but email notification failed:', emailErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Subscription request received! Our developer team will contact you shortly.',
      data: {
        id: request.id,
        status: request.status
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Submit a contact developer message
 * @route   POST /api/public/contact
 * @access  Public
 */
exports.submitContactForm = async (req, res, next) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    // 1. Validation
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
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }
    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: 'If provided, phone number must be valid' });
    }

    // 2. Email delivery to syyedsanaullah@gmail.com
    await sendContactDeveloperEmail('syyedsanaullah@gmail.com', {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone?.trim() || null,
      subject: subject.trim(),
      message: message.trim()
    });

    res.json({
      success: true,
      message: 'Your message has been sent successfully. Thank you for contacting us!'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get subscription requests list
 * @route   GET /api/super-admin/subscription-requests
 * @access  Private (superAdmin)
 */
exports.getSubscriptionRequests = async (req, res, next) => {
  try {
    const { search, plan, status, page = 1, limit = 10 } = req.query;
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
    if (status && VALID_STATUSES.includes(status.toLowerCase())) {
      andFilters.push({ status: status.toLowerCase() });
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skipNum = (pageNum - 1) * limitNum;

    const total = await prisma.subscriptionRequest.count({ where });
    const requests = await prisma.subscriptionRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: skipNum,
      take: limitNum
    });

    res.json({
      success: true,
      data: requests.map(r => ({ ...r, _id: r.id })), // Maintain _id mapping for compatibility
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single subscription request detail
 * @route   GET /api/super-admin/subscription-requests/:id
 * @access  Private (superAdmin)
 */
exports.getSubscriptionRequest = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const request = await prisma.subscriptionRequest.findUnique({
      where: { id: req.params.id }
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
 * @desc    Update a subscription request (status, notes)
 * @route   PUT /api/super-admin/subscription-requests/:id
 * @access  Private (superAdmin)
 */
exports.updateSubscriptionRequest = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const prisma = getSystemClient();

    // Retrieve original request
    const originalRequest = await prisma.subscriptionRequest.findUnique({
      where: { id: req.params.id }
    });

    if (!originalRequest) {
      return res.status(404).json({ success: false, message: 'Subscription request not found' });
    }

    const updateData = {};

    if (status) {
      if (!VALID_STATUSES.includes(status.toLowerCase())) {
        return res.status(400).json({ success: false, message: 'Invalid status value' });
      }
      updateData.status = status.toLowerCase();

      // If transitioning status to review or decision, tag review timestamps
      if (['approved', 'rejected', 'in_review', 'converted'].includes(status.toLowerCase())) {
        updateData.reviewedAt = new Date();
        updateData.reviewedBy = req.user.name || req.user.email;
      }
    }

    if (notes !== undefined) {
      updateData.notes = notes;
    }

    const updated = await prisma.subscriptionRequest.update({
      where: { id: req.params.id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Subscription request updated successfully',
      data: { ...updated, _id: updated.id }
    });
  } catch (error) {
    next(error);
  }
};
