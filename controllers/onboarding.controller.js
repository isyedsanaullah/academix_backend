const bcrypt = require('bcryptjs');
const { getSystemClient, getTenantClient } = require('../config/prismaManager');

// Helper for audit logs
const createAuditLog = async (prisma, { userId, collegeId, action, details, req }) => {
  try {
    await prisma.auditLog.create({
      data: {
        user_id: userId || 'system',
        college_id: collegeId || null,
        action,
        details,
        ipAddress: req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : null,
        userAgent: req ? req.headers['user-agent'] : null
      }
    });
  } catch (e) {
    console.error('AuditLog failure:', e.message);
  }
};

// ── Get Onboarding Progress & Draft Data ────────────────────────────────
exports.getOnboardingStatus = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: req.collegeId }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found.' });
    }

    res.json({
      success: true,
      data: {
        id: college.id,
        _id: college.id,
        name: college.name,
        code: college.code,
        email: college.email,
        phone: college.phone || '',
        address: college.address || '',
        city: college.city || '',
        logo: college.logo || '',
        website: college.website || '',
        subscription: college.subscription,
        settings: college.settings || {},
        onboardingStatus: college.onboardingStatus || 'in_progress',
        onboardingStep: college.onboardingStep || 1
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── Step 1: Save College Profile (Logo, Cover, Description, Location) ────
exports.saveStep1Profile = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const {
      name, code, logo, coverPhoto, tagline, about, establishedYear,
      phone, address, city, country = 'Pakistan', website, googleMap, socialLinks
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'College Name and Code are required.' });
    }

    const college = await prisma.college.findUnique({ where: { id: req.collegeId } });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College workspace not found.' });
    }

    const currentSettings = college.settings || {};
    const updatedSettings = {
      ...currentSettings,
      coverPhoto: coverPhoto || currentSettings.coverPhoto || '',
      tagline: tagline || currentSettings.tagline || '',
      about: about || currentSettings.about || '',
      establishedYear: establishedYear ? Number(establishedYear) : currentSettings.establishedYear || null,
      country: country || currentSettings.country || 'Pakistan',
      googleMap: googleMap || currentSettings.googleMap || '',
      socialLinks: socialLinks || currentSettings.socialLinks || {}
    };

    const updatedCollege = await prisma.college.update({
      where: { id: req.collegeId },
      data: {
        name,
        code: code.toUpperCase(),
        logo: logo || college.logo || '',
        phone: phone || college.phone || '',
        address: address || college.address || '',
        city: city || college.city || '',
        website: website || college.website || '',
        settings: updatedSettings,
        onboardingStatus: 'in_progress',
        onboardingStep: 2
      }
    });

    await createAuditLog(prisma, {
      userId: req.user.id,
      collegeId: req.collegeId,
      action: 'ONBOARDING_STEP1_SAVED',
      details: `Saved Step 1 profile for ${name}`,
      req
    });

    res.json({
      success: true,
      message: 'Step 1: College Profile saved successfully.',
      data: {
        id: updatedCollege.id,
        _id: updatedCollege.id,
        onboardingStep: updatedCollege.onboardingStep,
        onboardingStatus: updatedCollege.onboardingStatus,
        college: updatedCollege
      }
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'College Code is already in use by another college.' });
    }
    next(error);
  }
};

// ── Step 2: Academic Info (Programs, Admission Season, Session) ──────────
exports.saveStep2Academic = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { programs = [], admissionOpen = false, startDate, endDate, sessionTitle = '2026-2027' } = req.body;

    const college = await prisma.college.findUnique({ where: { id: req.collegeId } });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College workspace not found.' });
    }

    const currentSettings = college.settings || {};
    const updatedSettings = {
      ...currentSettings,
      programs: Array.isArray(programs) ? programs : currentSettings.programs || []
    };

    const updatedCollege = await prisma.college.update({
      where: { id: req.collegeId },
      data: {
        settings: updatedSettings,
        onboardingStatus: 'in_progress',
        onboardingStep: 3
      }
    });

    // Create session & admission season if connected to tenant DB
    const connectionUrl = college.mongoUrl || process.env.DATABASE_URL;
    if (connectionUrl) {
      try {
        const tenantDb = getTenantClient(connectionUrl);
        // Ensure default academic session
        const existingSession = await tenantDb.session.findFirst({
          where: { college_id: college.id, name: sessionTitle }
        });
        const session = existingSession || await tenantDb.session.create({
          data: {
            college_id: college.id,
            name: sessionTitle,
            startDate: new Date(startDate || '2026-09-01'),
            endDate: new Date(endDate || '2027-06-30'),
            isCurrent: true,
            status: 'active'
          }
        });

        // Optionally create open admission season
        if (admissionOpen) {
          await tenantDb.admissionSeason.create({
            data: {
              college_id: college.id,
              session_id: session.id,
              title: `${sessionTitle} Admissions`,
              startDate: new Date(),
              endDate: new Date(endDate || '2026-10-31'),
              availableGroups: programs.map(p => p.name || p),
              availableClasses: ['FSC Part 1'],
              status: 'open'
            }
          });
        }
      } catch (tErr) {
        console.error('Tenant DB setup for Step 2 error:', tErr.message);
      }
    }

    await createAuditLog(prisma, {
      userId: req.user.id,
      collegeId: req.collegeId,
      action: 'ONBOARDING_STEP2_SAVED',
      details: `Saved Step 2 academic info for ${college.name}`,
      req
    });

    res.json({
      success: true,
      message: 'Step 2: Academic Information saved successfully.',
      data: {
        id: updatedCollege.id,
        _id: updatedCollege.id,
        onboardingStep: updatedCollege.onboardingStep,
        onboardingStatus: updatedCollege.onboardingStatus
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── Step 3: Staff Accounts (Optional & Skippable) ───────────────────────
exports.saveStep3Staff = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { staffList = [], skip = false } = req.body;

    const college = await prisma.college.findUnique({ where: { id: req.collegeId } });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College workspace not found.' });
    }

    // Process staff users if provided
    if (!skip && Array.isArray(staffList) && staffList.length > 0) {
      for (const member of staffList) {
        if (member.email && member.password && member.name) {
          const cleanEmail = member.email.trim().toLowerCase();
          const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
          if (!existing) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(member.password, salt);
            await prisma.user.create({
              data: {
                name: member.name,
                email: cleanEmail,
                password: hashedPassword,
                role: member.role || 'employee',
                college_id: college.id,
                emailVerified: true,
                authProvider: 'local'
              }
            });
          }
        }
      }
    }

    const updatedCollege = await prisma.college.update({
      where: { id: req.collegeId },
      data: {
        onboardingStatus: 'in_progress',
        onboardingStep: 4
      }
    });

    await createAuditLog(prisma, {
      userId: req.user.id,
      collegeId: req.collegeId,
      action: skip ? 'ONBOARDING_STEP3_SKIPPED' : 'ONBOARDING_STEP3_SAVED',
      details: skip ? 'Skipped staff account setup' : `Created ${staffList.length} staff accounts`,
      req
    });

    res.json({
      success: true,
      message: skip ? 'Step 3 skipped.' : 'Step 3: Staff Accounts created successfully.',
      data: {
        id: updatedCollege.id,
        _id: updatedCollege.id,
        onboardingStep: updatedCollege.onboardingStep,
        onboardingStatus: updatedCollege.onboardingStatus
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── Step 4: Review & Complete Onboarding ────────────────────────────────
exports.completeOnboarding = async (req, res, next) => {
  try {
    const prisma = getSystemClient();

    const college = await prisma.college.findUnique({ where: { id: req.collegeId } });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College workspace not found.' });
    }

    const updatedCollege = await prisma.college.update({
      where: { id: req.collegeId },
      data: {
        onboardingStatus: 'completed',
        onboardingStep: 4,
        isActive: true
      }
    });

    // 1. Audit Log
    await createAuditLog(prisma, {
      userId: req.user.id,
      collegeId: req.collegeId,
      action: 'ONBOARDING_COMPLETED',
      details: `College ${college.name} (${college.code}) completed onboarding and published profile`,
      req
    });

    // 2. Notify Super Admin of successful onboarding completion
    try {
      const superAdmins = await prisma.user.findMany({
        where: { role: 'superAdmin' }
      });

      for (const sa of superAdmins) {
        await prisma.notification.create({
          data: {
            college_id: college.id,
            recipient: sa.id,
            title: '🎓 New College Registration Completed!',
            message: `${college.name} (${college.code}) has successfully completed their self-onboarding profile and is now active on Academix.`,
            type: 'system',
            link: '/super-admin/colleges'
          }
        });
      }
    } catch (nErr) {
      console.error('Super Admin notification creation error:', nErr.message);
    }

    res.json({
      success: true,
      message: '🎉 Congratulations! Your college profile is now live and fully activated.',
      data: {
        id: updatedCollege.id,
        _id: updatedCollege.id,
        onboardingStatus: updatedCollege.onboardingStatus,
        onboardingStep: updatedCollege.onboardingStep
      }
    });
  } catch (error) {
    next(error);
  }
};
