const bcrypt = require('bcryptjs');
const prismaManager = require('../config/prismaManager');
const getSystemClient = () => prismaManager.getSystemClient();
const { resolveFileUrl } = require('../services/fileResolver');
const { clearEntitlementCache } = require('../middleware/loadEntitlements');
const {
  uploadObject,
  generateObjectKey,
  sanitizeFilename,
  computeChecksum,
  toR2Reference
} = require('../services/storageService');
const { optimizeImage, MAX_IMAGE_FILE_SIZE } = require('../services/mediaOptimizer');
const { consume, getCollegeLimit } = require('../services/quota');

exports.getCollegeInfo = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: req.collegeId }
    });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });

    const contacts = await prisma.user.findMany({
      where: {
        college_id: req.collegeId,
        role: { in: ['admin', 'principal', 'registrar', 'accountant'] },
        isActive: true
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true
      }
    });

    const formattedContacts = contacts.map(c => ({
      ...c,
      _id: c.id
    }));

    // Resolve R2 reference for logo
    const resolvedLogo = await resolveFileUrl(college.logo, req.tenantClient || prisma, req.collegeId);

    res.json({
      success: true,
      data: {
        name: college.name,
        code: college.code,
        email: college.email,
        phone: college.phone,
        address: college.address,
        city: college.city,
        website: college.website,
        logo: resolvedLogo || college.logo,
        subscription: { plan: college.subscription?.plan },
        contacts: formattedContacts
      }
    });
  } catch (error) { next(error); }
};

const getKarachiMidnight = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return new Date(`${year}-${month}-${day}T00:00:00+05:00`);
};

exports.getDashboard = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantClient = req.tenantClient || prisma;
    const collegeId = req.collegeId;

    const [college, totalStudents, activeStudents, totalTeachers, totalEmployees] = await Promise.all([
      prisma.college.findUnique({ where: { id: collegeId } }),
      tenantClient.student.count({ where: { college_id: collegeId } }),
      tenantClient.student.count({ where: { college_id: collegeId, status: 'active' } }),
      prisma.user.count({ where: { college_id: collegeId, role: 'teacher' } }),
      prisma.user.count({ where: { college_id: collegeId, role: 'employee' } })
    ]);
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });

    const currentMonth = new Date().toISOString().slice(0, 7);
    const feeGroup = await tenantClient.fee.groupBy({
      by: ['status'],
      where: {
        college_id: collegeId,
        month: currentMonth
      },
      _count: {
        _all: true
      },
      _sum: {
        totalAmount: true,
        paidAmount: true
      }
    });

    const feeStats = feeGroup.map(g => ({
      _id: g.status,
      count: g._count._all,
      total: g._sum.totalAmount || 0,
      paid: g._sum.paidAmount || 0
    }));

    const todayKarachi = getKarachiMidnight();
    const tomorrowKarachi = new Date(todayKarachi);
    tomorrowKarachi.setDate(tomorrowKarachi.getDate() + 1);

    // Fetch all GateLogs today to compute currently inside metrics
    const gateLogsToday = await tenantClient.gateLog.findMany({
      where: { college_id: collegeId, date: todayKarachi },
      orderBy: { timestamp: 'asc' }
    });

    const latestStatePerPerson = {};
    for (const log of gateLogsToday) {
      latestStatePerPerson[log.personId] = {
        personType: log.personType,
        action: log.action
      };
    }

    const currentlyInsideStudents = Object.values(latestStatePerPerson).filter(
      p => p.personType === 'student' && p.action === 'entry'
    ).length;

    const currentlyInsideStaff = Object.values(latestStatePerPerson).filter(
      p => (p.personType === 'teacher' || p.personType === 'employee') && p.action === 'entry'
    ).length;

    const todayEntries = gateLogsToday.filter(l => l.action === 'entry').length;
    const todayExits = gateLogsToday.filter(l => l.action === 'exit').length;

    // Count external visitors logged today
    const todayVisitors = await tenantClient.visitorLog.count({
      where: {
        college_id: collegeId,
        entryTime: {
          gte: todayKarachi,
          lt: tomorrowKarachi
        }
      }
    });

    const attendanceGroup = await tenantClient.attendance.groupBy({
      by: ['status'],
      where: {
        college_id: collegeId,
        date: {
          gte: todayKarachi,
          lt: tomorrowKarachi
        }
      },
      _count: {
        _all: true
      }
    });

    const attendanceToday = attendanceGroup.map(g => ({
      _id: g.status,
      count: g._count._all
    }));

    // Resolve R2 logo reference
    const resolvedLogo = await resolveFileUrl(college.logo, tenantClient, collegeId);

    res.json({
      success: true,
      data: {
        college: {
          name: college.name,
          code: college.code,
          logo: resolvedLogo || college.logo,
          subscription: college.subscription,
          settings: college.settings
        },
        stats: { 
          totalStudents, 
          activeStudents, 
          totalTeachers, 
          totalEmployees,
          currentlyInsideStudents,
          currentlyInsideStaff,
          todayEntries,
          todayExits,
          todayVisitors
        },
        feeStats,
        attendanceToday
      }
    });
  } catch (error) { next(error); }
};

exports.getSettings = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: req.collegeId }
    });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });
    
    // Combine college.settings with top-level editable fields for profile
    const responseData = {
      ...(college.settings && typeof college.settings === 'object' ? college.settings : {}),
      logo: college.logo || '',
      website: college.website || '',
      phone: college.phone || '',
      email: college.email || '',
      address: college.address || '',
      city: college.city || ''
    };
    
    res.json({ success: true, data: responseData });
  } catch (error) { next(error); }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const body = req.body || {};
    
    const existingCollege = await prisma.college.findUnique({
      where: { id: req.collegeId }
    });
    if (!existingCollege) return res.status(404).json({ success: false, message: 'College not found' });

    // Extract direct college fields
    const { logo, website, phone, email, address, city, methodPrefs, ...settingsOnly } = body;
    
    const existingSettings = (existingCollege.settings && typeof existingCollege.settings === 'object') ? existingCollege.settings : {};
    const mergedSettings = { ...existingSettings, ...settingsOnly };

    const updateData = {
      settings: mergedSettings
    };
    
    if (logo !== undefined) updateData.logo = logo;
    if (website !== undefined) updateData.website = website;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;

    // Phase 9: If methodPrefs is provided, update subscription.methodPrefs
    if (methodPrefs && typeof methodPrefs === 'object') {
      const existingSub = (existingCollege.subscription && typeof existingCollege.subscription === 'object') ? existingCollege.subscription : {};
      updateData.subscription = {
        ...existingSub,
        methodPrefs
      };
    }

    const college = await prisma.college.update({
      where: { id: req.collegeId },
      data: updateData
    });

    clearEntitlementCache(req.collegeId);
    
    const responseData = {
      ...(college.settings && typeof college.settings === 'object' ? college.settings : {}),
      logo: college.logo || '',
      website: college.website || '',
      phone: college.phone || '',
      email: college.email || '',
      address: college.address || '',
      city: college.city || ''
    };
    
    res.json({ success: true, data: responseData });
  } catch (error) { next(error); }
};

exports.getStaff = async (req, res, next) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;
    const prisma = getSystemClient();

    const where = {
      college_id: req.collegeId,
      role: { in: ['teacher', 'employee', 'principal'] }
    };

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skipNum = (pageNum - 1) * limitNum;

    const total = await prisma.user.count({ where });
    const staff = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: skipNum,
      take: limitNum
    });

    const formattedStaff = staff.map(s => {
      const { password, ...sWithoutPassword } = s;
      return {
        ...sWithoutPassword,
        _id: s.id
      };
    });

    res.json({
      success: true,
      data: formattedStaff,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) { next(error); }
};

exports.addStaff = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, employeeType } = req.body;
    const prisma = getSystemClient();

    if (!['teacher', 'employee', 'principal'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid staff role' });
    }

    const exists = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    if (exists) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password || `${role}@academix`, salt);

    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role,
        phone,
        college_id: req.collegeId,
        isActive: true,
        authProvider: 'local'
      }
    });

    // Create role-specific profile in TENANT DB
    if (role === 'teacher' && req.tenantClient) {
      await req.tenantClient.teacher.create({
        data: {
          user_id: user.id,
          college_id: req.collegeId,
          qualification: '',
          specialization: '',
          salary: 0,
          status: 'active'
        }
      });
    } else if (role === 'employee' && req.tenantClient) {
      await req.tenantClient.employee.create({
        data: {
          user_id: user.id,
          college_id: req.collegeId,
          department: employeeType || 'other',
          designation: '',
          salary: 0,
          status: 'active'
        }
      });
    }

    res.status(201).json({
      success: true,
      data: {
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) { next(error); }
};

/**
 * GET /api/college/branding
 * Retrieve branding configuration including logo, stamp, colors, and signatures
 */
exports.getBranding = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: req.collegeId }
    });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });

    const tenantDb = req.tenantClient;
    const settings = (college.settings && typeof college.settings === 'object') ? college.settings : {};
    const branding = (settings.branding && typeof settings.branding === 'object') ? settings.branding : {};

    const resolvedLogo = college.logo ? await resolveFileUrl(college.logo, tenantDb, req.collegeId) : null;
    const resolvedStamp = branding.stamp ? await resolveFileUrl(branding.stamp, tenantDb, req.collegeId) : null;

    const signatures = branding.signatures || {};
    const resolvedSignatures = {};
    for (const [role, ref] of Object.entries(signatures)) {
      resolvedSignatures[role] = ref ? await resolveFileUrl(ref, tenantDb, req.collegeId) : null;
    }

    res.json({
      success: true,
      data: {
        collegeId: college.id,
        name: college.name,
        code: college.code,
        logo: resolvedLogo || college.logo || '',
        logoRef: college.logo || '',
        stamp: resolvedStamp || branding.stamp || '',
        stampRef: branding.stamp || '',
        signatures: resolvedSignatures,
        signatureRefs: signatures,
        primaryColor: branding.primaryColor || '#1e3a8a',
        secondaryColor: branding.secondaryColor || '#3b82f6',
        accentColor: branding.accentColor || '#10b981',
        tagline: branding.tagline || '',
        motto: branding.motto || '',
        affiliation: branding.affiliation || '',
        letterheadHeader: branding.letterheadHeader || '',
        letterheadFooter: branding.letterheadFooter || '',
        fontFamily: branding.fontFamily || 'Inter, sans-serif'
      }
    });
  } catch (error) { next(error); }
};

/**
 * PUT /api/college/branding
 * Update branding configuration (colors, motto, tagline, letterhead)
 */
exports.updateBranding = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: req.collegeId }
    });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });

    const {
      logo,
      stamp,
      primaryColor,
      secondaryColor,
      accentColor,
      tagline,
      motto,
      affiliation,
      letterheadHeader,
      letterheadFooter,
      fontFamily,
      signatures
    } = req.body;

    const currentSettings = (college.settings && typeof college.settings === 'object') ? college.settings : {};
    const currentBranding = (currentSettings.branding && typeof currentSettings.branding === 'object') ? currentSettings.branding : {};

    const updatedBranding = {
      ...currentBranding,
      ...(primaryColor !== undefined && { primaryColor }),
      ...(secondaryColor !== undefined && { secondaryColor }),
      ...(accentColor !== undefined && { accentColor }),
      ...(tagline !== undefined && { tagline }),
      ...(motto !== undefined && { motto }),
      ...(affiliation !== undefined && { affiliation }),
      ...(letterheadHeader !== undefined && { letterheadHeader }),
      ...(letterheadFooter !== undefined && { letterheadFooter }),
      ...(fontFamily !== undefined && { fontFamily }),
      ...(stamp !== undefined && { stamp }),
      signatures: {
        ...(currentBranding.signatures || {}),
        ...(signatures || {})
      }
    };

    const updatePayload = {
      settings: {
        ...currentSettings,
        branding: updatedBranding
      }
    };

    if (logo !== undefined) {
      updatePayload.logo = logo;
    }

    const updatedCollege = await prisma.college.update({
      where: { id: req.collegeId },
      data: updatePayload
    });

    res.json({
      success: true,
      message: 'College branding updated successfully.',
      data: {
        logo: updatedCollege.logo,
        branding: updatedBranding
      }
    });
  } catch (error) { next(error); }
};

/**
 * POST /api/college/branding/signature/:role
 * Upload and process signature with near-white background removal
 */
exports.uploadSignature = async (req, res, next) => {
  try {
    const { role } = req.params;
    const targetRole = (role || '').toLowerCase();
    const validRoles = ['principal', 'accountant', 'registrar', 'examinationhead', 'cashier', 'admin'];

    if (!validRoles.includes(targetRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid signature role '${role}'. Allowed: ${validRoles.join(', ')}`
      });
    }

    // Role-based authorization: admin or principal can upload any signature, otherwise user can only upload their own role's signature
    const userRole = (req.user?.role || '').toLowerCase();
    if (userRole !== 'admin' && userRole !== 'principal' && userRole !== targetRole) {
      return res.status(403).json({
        success: false,
        message: `You are not authorized to upload signatures for '${role}'.`
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No signature file uploaded.' });
    }

    if (req.file.size > MAX_IMAGE_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        code: 'FILE_TOO_LARGE',
        message: 'Signature image exceeds 5 MB limit'
      });
    }

    const collegeId = req.collegeId;
    const userId = req.user.id || req.user._id;
    const tenantDb = req.tenantClient;

    // Apply background removal (near-white to transparent) and keep PNG format
    const removeBg = req.query.removeBackground !== 'false' && req.body.removeBackground !== 'false';
    const opt = await optimizeImage(req.file.buffer, {
      entityType: 'Signature',
      category: 'signatures',
      removeBackground: removeBg,
      bgThreshold: 240
    });

    // Check storageBytes quota
    const sysDb = getSystemClient();
    const storageLimit = await getCollegeLimit(sysDb, collegeId, 'storageBytes');
    const quotaResult = await consume(sysDb, collegeId, 'storageBytes', opt.sizeBytes, storageLimit);
    if (!quotaResult.allowed) {
      return res.status(403).json({
        success: false,
        code: 'QUOTA_EXCEEDED',
        message: 'Quota exceeded for storageBytes',
        metric: 'storageBytes'
      });
    }

    const sanitizedName = sanitizeFilename(`signature_${targetRole}.png`);
    const objectKey = generateObjectKey(collegeId, 'signatures', targetRole, sanitizedName);
    const checksum = computeChecksum(opt.buffer);

    // Upload to R2
    await uploadObject({
      objectKey,
      body: opt.buffer,
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000, immutable'
    });

    // Create StoredFile record
    const storedFile = await tenantDb.storedFile.create({
      data: {
        college_id: collegeId,
        uploadedById: userId,
        objectKey,
        originalFilename: sanitizedName,
        contentType: 'image/png',
        sizeBytes: opt.sizeBytes,
        checksumSha256: checksum,
        category: 'signatures',
        entityType: 'Signature',
        entityId: targetRole,
        status: 'ready'
      }
    });

    const signatureRef = toR2Reference(storedFile.id);

    // Update College.settings.branding.signatures[targetRole]
    const college = await sysDb.college.findUnique({ where: { id: collegeId } });
    const currentSettings = (college?.settings && typeof college.settings === 'object') ? college.settings : {};
    const currentBranding = (currentSettings.branding && typeof currentSettings.branding === 'object') ? currentSettings.branding : {};
    const signatures = {
      ...(currentBranding.signatures || {}),
      [targetRole]: signatureRef
    };

    await sysDb.college.update({
      where: { id: collegeId },
      data: {
        settings: {
          ...currentSettings,
          branding: {
            ...currentBranding,
            signatures
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: `Signature for '${targetRole}' uploaded and processed successfully.`,
      data: {
        role: targetRole,
        signatureRef,
        fileId: storedFile.id,
        sizeBytes: opt.sizeBytes,
        format: 'png',
        backgroundRemoved: removeBg
      }
    });
  } catch (error) { next(error); }
};

// ══════════════════════════════════════════════════════════════════════════════
// COLLEGE PLATFORM INVOICES (Phase 12)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/college/invoices
 * College admins view their own platform billing invoices
 */
exports.getCollegeInvoices = async (req, res, next) => {
  try {
    const sysDb = getSystemClient();
    const collegeId = req.collegeId;

    const invoices = await sysDb.platformInvoice.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      count: invoices.length,
      data: invoices
    });
  } catch (error) { next(error); }
};

/**
 * GET /api/college/invoices/:id.pdf
 * College admin downloads their platform invoice or paid receipt PDF
 */
exports.downloadCollegeInvoicePDF = async (req, res, next) => {
  try {
    const { id } = req.params;
    const collegeId = req.collegeId;
    const sysDb = getSystemClient();

    const invoice = await sysDb.platformInvoice.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Platform invoice not found'
      });
    }

    const college = await sysDb.college.findUnique({ where: { id: collegeId } });
    const { generatePlatformInvoicePDF } = require('../services/documentTemplates');

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const isReceipt = req.query.receipt === 'true' && invoice.status === 'paid';

    const pdfDoc = await generatePlatformInvoicePDF({
      invoice,
      college,
      isPaid: invoice.status === 'paid' && isReceipt,
      verifyBaseUrl: baseUrl
    });

    const filename = isReceipt ? `receipt_${invoice.invoiceNo}.pdf` : `invoice_${invoice.invoiceNo}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) { next(error); }
};


