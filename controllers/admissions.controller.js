// ─── Admissions, Quotas, Equivalence, Leads & Merit Controller ───────────────
const { Prisma } = require('@prisma/client');

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

// ── 1. Desk Entry Application ─────────────────────────────────────────────────

exports.createDeskApplication = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id || 'registrar';
    const userName = req.user?.name || req.user?.email || 'Registrar';

    const season = await tenantDb.admissionSeason.findFirst({
      where: { college_id: req.collegeId, status: 'open' }
    }) || await tenantDb.admissionSeason.findFirst({
      where: { college_id: req.collegeId },
      orderBy: { createdAt: 'desc' }
    });

    if (!season) {
      return res.status(400).json({ success: false, message: 'No admission season configured' });
    }

    // Auto-generate application number matching public route format: APP-YYYY-XXXXX
    const count = await tenantDb.application.count({
      where: { college_id: req.collegeId }
    });
    const year = new Date().getFullYear();
    const applicationNumber = `APP-${year}-${String(count + 1).padStart(5, '0')}`;

    // Calculate SSC aggregate and merit score (use equivalenceMarks if foreign/non-Pakistani board)
    let sscAggregate = null;
    const sscTotal = parseFloat(req.body.sscTotalMarks) || 0;
    const sscObtained = parseFloat(req.body.sscObtainedMarks) || 0;
    if (sscTotal > 0 && sscObtained > 0) {
      sscAggregate = Math.round((sscObtained / sscTotal) * 10000) / 100;
    }

    const equivalenceMarks = req.body.equivalenceMarks != null ? parseFloat(req.body.equivalenceMarks) : null;
    // When equivalence marks are present, merit score takes equivalence marks
    const meritScore = equivalenceMarks != null ? equivalenceMarks : sscAggregate;

    const application = await tenantDb.application.create({
      data: {
        college_id: req.collegeId,
        season_id: season.id,
        applicationNumber,
        name: req.body.name,
        fatherName: req.body.fatherName,
        cnic: req.body.cnic || null,
        dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : new Date(),
        gender: req.body.gender || 'male',
        phone: req.body.phone,
        email: req.body.email ? req.body.email.toLowerCase() : `${applicationNumber.toLowerCase()}@desk.local`,
        address: req.body.address || 'Campus Desk Registration',
        city: req.body.city || null,
        guardianName: req.body.guardianName || null,
        guardianPhone: req.body.guardianPhone || null,
        guardianRelation: req.body.guardianRelation || null,
        sscBoard: req.body.sscBoard || req.body.equivalenceBoard || 'BISE',
        sscYear: parseInt(req.body.sscYear, 10) || year,
        sscRollNumber: req.body.sscRollNumber || null,
        sscTotalMarks: sscTotal,
        sscObtainedMarks: sscObtained,
        sscAggregate,
        sscResultStatus: req.body.sscResultStatus || 'declared',
        preferredClass: req.body.preferredClass || 'FSC Part 1',
        preferredGroup: req.body.preferredGroup || 'Pre-Medical',
        source: 'DESK',
        enteredBy: userName,
        quota: req.body.quota || null,
        equivalenceBoard: req.body.equivalenceBoard || null,
        equivalenceMarks,
        meritScore,
        status: req.body.status || 'submitted',
        docVerification: req.body.docVerification || {}
      }
    });

    res.status(201).json({
      success: true,
      message: 'Desk application created successfully',
      data: application
    });
  } catch (error) {
    next(error);
  }
};

// ── 2. Per-Document Verification ──────────────────────────────────────────────

exports.verifyDocument = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id, doc } = req.params;
    const { ok = true, note = '' } = req.body;
    const userName = req.user?.name || req.user?.email || 'Registrar';

    const app = await tenantDb.application.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const docVerification = (app.docVerification && typeof app.docVerification === 'object')
      ? { ...app.docVerification }
      : {};

    docVerification[doc] = {
      ok: !!ok,
      by: userName,
      at: new Date().toISOString(),
      note: note || ''
    };

    const updated = await tenantDb.application.update({
      where: { id },
      data: { docVerification }
    });

    res.json({
      success: true,
      message: `Document '${doc}' verification recorded`,
      docVerification: updated.docVerification
    });
  } catch (error) {
    next(error);
  }
};

// ── 3. Merit List Calculation & Generation ────────────────────────────────────

exports.getMeritList = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, group, class: cls } = req.query;
    const sessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const where = {
      college_id: req.collegeId,
      status: { not: 'rejected' }
    };
    if (group && group !== 'all') where.preferredGroup = group;
    if (cls && cls !== 'all') where.preferredClass = cls;

    const applications = await tenantDb.application.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Fetch active Quota Rules and Scholarship Tiers
    const quotaRules = await tenantDb.quotaRule.findMany({
      where: { college_id: req.collegeId, isActive: true }
    });
    const quotaRuleMap = Object.fromEntries(quotaRules.map(q => [q.code, q]));

    const scholarshipTiers = await tenantDb.scholarshipTier.findMany({
      where: { college_id: req.collegeId, isActive: true },
      orderBy: { minPercent: 'desc' }
    });

    // Compute merit scores & match scholarship tier
    const evaluated = applications.map(app => {
      let score = app.meritScore;
      if (score == null) {
        if (app.equivalenceMarks != null) {
          score = app.equivalenceMarks;
        } else if (app.sscTotalMarks > 0) {
          score = Math.round((app.sscObtainedMarks / app.sscTotalMarks) * 10000) / 100;
        } else {
          score = 0;
        }
      }

      // Match scholarship tier
      const tier = scholarshipTiers.find(t =>
        score >= t.minPercent && (t.maxPercent == null || score <= t.maxPercent)
      );

      return {
        ...app,
        meritScore: score,
        scholarshipTier: tier ? { id: tier.id, name: tier.name, discountType: tier.discountType, discountValue: tier.discountValue } : null
      };
    });

    // Quota Allocation: Quota seats reserved first!
    const quotaReservedList = [];
    const openMeritCandidates = [];

    // Group quota applicants
    const quotaBuckets = {};
    for (const app of evaluated) {
      if (app.quota && quotaRuleMap[app.quota]) {
        if (!quotaBuckets[app.quota]) quotaBuckets[app.quota] = [];
        quotaBuckets[app.quota].push(app);
      } else {
        openMeritCandidates.push(app);
      }
    }

    // Allocate reserved quota seats in descending order of merit within each quota
    for (const [code, apps] of Object.entries(quotaBuckets)) {
      apps.sort((a, b) => b.meritScore - a.meritScore);
      const rule = quotaRuleMap[code];
      const maxSeats = rule.seats ?? 999;

      const allocated = apps.slice(0, maxSeats).map(a => ({
        ...a,
        quotaAllocated: true,
        quotaRuleName: rule.name
      }));
      quotaReservedList.push(...allocated);

      // Remaining candidates in this quota compete in open merit
      const unallocated = apps.slice(maxSeats).map(a => ({
        ...a,
        quotaAllocated: false
      }));
      openMeritCandidates.push(...unallocated);
    }

    // Sort open merit candidates strictly by merit score descending
    openMeritCandidates.sort((a, b) => b.meritScore - a.meritScore);

    // Final Merit List order: Quota reserved candidates first, then Open Merit candidates
    const finalMeritList = [
      ...quotaReservedList,
      ...openMeritCandidates.map(a => ({ ...a, quotaAllocated: false }))
    ];

    res.json({
      success: true,
      totalApplicants: evaluated.length,
      quotaReservedCount: quotaReservedList.length,
      openMeritCount: openMeritCandidates.length,
      data: finalMeritList
    });
  } catch (error) {
    next(error);
  }
};

// ── 4. Quota Rules CRUD ───────────────────────────────────────────────────────

exports.getQuotaRules = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const rules = await tenantDb.quotaRule.findMany({
      where: { college_id: req.collegeId },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ success: true, count: rules.length, data: rules });
  } catch (error) {
    next(error);
  }
};

exports.createQuotaRule = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const { code, name, seats, seatsPercent, discountType = 'none', discountValue = 0 } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'Quota code and name are required' });
    }

    const rule = await tenantDb.quotaRule.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId,
        code: code.toLowerCase().trim(),
        name: name.trim(),
        seats: seats != null ? parseInt(seats, 10) : null,
        seatsPercent: seatsPercent != null ? parseFloat(seatsPercent) : null,
        discountType,
        discountValue: new Prisma.Decimal(discountValue || 0),
        isActive: true
      }
    });

    res.status(201).json({ success: true, message: 'Quota rule created', data: rule });
  } catch (error) {
    next(error);
  }
};

exports.updateQuotaRule = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const data = { ...req.body };
    if (data.seats !== undefined) data.seats = data.seats != null ? parseInt(data.seats, 10) : null;
    if (data.seatsPercent !== undefined) data.seatsPercent = data.seatsPercent != null ? parseFloat(data.seatsPercent) : null;
    if (data.discountValue !== undefined) data.discountValue = new Prisma.Decimal(data.discountValue || 0);

    const rule = await tenantDb.quotaRule.update({
      where: { id },
      data
    });

    res.json({ success: true, message: 'Quota rule updated', data: rule });
  } catch (error) {
    next(error);
  }
};

exports.deleteQuotaRule = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    await tenantDb.quotaRule.deleteMany({
      where: { id, college_id: req.collegeId }
    });

    res.json({ success: true, message: 'Quota rule deleted' });
  } catch (error) {
    next(error);
  }
};

// ── 5. Scholarship Tiers CRUD ─────────────────────────────────────────────────

exports.getScholarshipTiers = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const tiers = await tenantDb.scholarshipTier.findMany({
      where: { college_id: req.collegeId },
      orderBy: { minPercent: 'desc' }
    });
    res.json({ success: true, count: tiers.length, data: tiers });
  } catch (error) {
    next(error);
  }
};

exports.createScholarshipTier = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const { name, minPercent, maxPercent, discountType = 'percent', discountValue = 0, appliesTo = ['tuition'] } = req.body;
    if (!name || minPercent == null) {
      return res.status(400).json({ success: false, message: 'Tier name and minimum percentage are required' });
    }

    const tier = await tenantDb.scholarshipTier.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId,
        name: name.trim(),
        minPercent: parseFloat(minPercent),
        maxPercent: maxPercent != null ? parseFloat(maxPercent) : null,
        discountType,
        discountValue: new Prisma.Decimal(discountValue || 0),
        appliesTo: Array.isArray(appliesTo) ? appliesTo : ['tuition'],
        isActive: true
      }
    });

    res.status(201).json({ success: true, message: 'Scholarship tier created', data: tier });
  } catch (error) {
    next(error);
  }
};

exports.deleteScholarshipTier = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    await tenantDb.scholarshipTier.deleteMany({
      where: { id, college_id: req.collegeId }
    });

    res.json({ success: true, message: 'Scholarship tier deleted' });
  } catch (error) {
    next(error);
  }
};

// ── 6. Enquiry Leads CRUD & Conversion ────────────────────────────────────────

exports.getEnquiryLeads = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { status, preferredGroup, search } = req.query;

    const where = { college_id: req.collegeId };
    if (status) where.status = status;
    if (preferredGroup) where.preferredGroup = preferredGroup;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } }
      ];
    }

    const leads = await tenantDb.enquiryLead.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, count: leads.length, data: leads });
  } catch (error) {
    next(error);
  }
};

exports.createEnquiryLead = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const { name, phone, source = 'walk-in', preferredGroup, assignedTo, testDate } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Lead name and phone number are required' });
    }

    const lead = await tenantDb.enquiryLead.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId,
        name: name.trim(),
        phone: phone.trim(),
        source,
        preferredGroup: preferredGroup || null,
        assignedTo: assignedTo || null,
        testDate: testDate ? new Date(testDate) : null,
        status: 'new'
      }
    });

    res.status(201).json({ success: true, message: 'Enquiry lead recorded', data: lead });
  } catch (error) {
    next(error);
  }
};

exports.updateEnquiryLead = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const lead = await tenantDb.enquiryLead.update({
      where: { id },
      data: req.body
    });

    res.json({ success: true, message: 'Enquiry lead updated', data: lead });
  } catch (error) {
    next(error);
  }
};

exports.convertLeadToApplication = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const userName = req.user?.name || req.user?.email || 'Registrar';

    const lead = await tenantDb.enquiryLead.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    if (lead.application_id) {
      return res.status(400).json({ success: false, message: 'Lead already converted to application' });
    }

    const season = await tenantDb.admissionSeason.findFirst({
      where: { college_id: req.collegeId, status: 'open' }
    }) || await tenantDb.admissionSeason.findFirst({
      where: { college_id: req.collegeId },
      orderBy: { createdAt: 'desc' }
    });

    const count = await tenantDb.application.count({ where: { college_id: req.collegeId } });
    const year = new Date().getFullYear();
    const applicationNumber = `APP-${year}-${String(count + 1).padStart(5, '0')}`;

    const application = await tenantDb.application.create({
      data: {
        college_id: req.collegeId,
        season_id: season?.id || lead.session_id || '',
        applicationNumber,
        name: lead.name,
        fatherName: req.body.fatherName || 'Not Provided',
        phone: lead.phone,
        email: req.body.email || `${applicationNumber.toLowerCase()}@lead.local`,
        address: req.body.address || 'Lead Conversion',
        preferredGroup: lead.preferredGroup || 'Pre-Medical',
        preferredClass: req.body.preferredClass || 'FSC Part 1',
        source: 'DESK',
        enteredBy: userName,
        sscBoard: req.body.sscBoard || 'BISE',
        sscYear: year,
        sscTotalMarks: parseFloat(req.body.sscTotalMarks) || 1100,
        sscObtainedMarks: parseFloat(req.body.sscObtainedMarks) || 850,
        dateOfBirth: new Date(),
        gender: 'male',
        status: 'submitted'
      }
    });

    const updatedLead = await tenantDb.enquiryLead.update({
      where: { id },
      data: {
        status: 'applied',
        application_id: application.id
      }
    });

    res.json({
      success: true,
      message: 'Lead successfully converted to Application',
      application,
      lead: updatedLead
    });
  } catch (error) {
    next(error);
  }
};
