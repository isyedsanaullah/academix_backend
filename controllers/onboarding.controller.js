'use strict';

const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const { getSystemClient } = require('../config/prismaManager');
const { logActivity } = require('../services/activityLog.service');
const { ACTIONS, CATEGORIES } = require('../config/activityConstants');
const { uploadObject, generateObjectKey, validateFileSignature } = require('../services/storageService');
const { send: sendMail } = require('../services/mailService');

// ─── Helper for audit logs ──────────────────────────────────────────────────
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

// ─── Phase 5: Helper to compute real onboarding state ──────────────────────
async function computeRealOnboardingState(prisma, tenantDb, college, user) {
  const collegeId = college.id;

  // 1. Verify Step: user email verified (or marked verified)
  const isVerifyDone = !!(user && (user.email_verified || user.isEmailVerified || user.emailVerified));

  // 2. Profile Step: name, city, phone or email, and logo/logo_key exist
  const hasName = !!(college.name && college.name.trim().length >= 2);
  const hasCity = !!(college.city && college.city.trim().length > 0);
  const hasContact = !!((college.phone && college.phone.trim().length > 0) || (college.email && college.email.trim().length > 0));
  const hasLogo = !!(college.logo || college.logo_key);
  const isProfileDone = hasName && hasCity && hasContact && hasLogo;

  // 3. Academic Step: at least 1 session and at least 1 class in DB
  const [sessionCount, classCount] = await Promise.all([
    tenantDb.session.count({ where: { college_id: collegeId } }).catch(() => 0),
    tenantDb.class.count({ where: { college_id: collegeId } }).catch(() => 0),
  ]);
  const isAcademicDone = sessionCount >= 1 && classCount >= 1;

  // 4. Staff Step: at least 1 staff created or marked done in state
  const existingState = (typeof college.onboarding_state === 'object' && college.onboarding_state !== null)
    ? college.onboarding_state
    : {};
  const stepsState = existingState.steps || {};

  const staffCount = await tenantDb.user.count({
    where: {
      college_id: collegeId,
      role: { in: ['principal', 'registrar', 'accountant', 'teacher', 'employee'] }
    }
  }).catch(() => 0);
  const isStaffDone = staffCount >= 1 || stepsState.staff === 'done';

  // 5. Students Step: at least 1 student or marked done in state
  const studentCount = await tenantDb.student.count({
    where: { college_id: collegeId }
  }).catch(() => 0);
  const isStudentsDone = studentCount >= 1 || stepsState.students === 'done';

  // 6. Review Step: college is active
  const isReviewDone = college.status === 'active';

  const steps = {
    verify: isVerifyDone ? 'done' : 'todo',
    profile: isProfileDone ? 'done' : 'todo',
    academic: isAcademicDone ? 'done' : 'todo',
    staff: isStaffDone ? 'done' : 'todo',
    students: isStudentsDone ? 'done' : 'todo',
    review: isReviewDone ? 'done' : 'todo',
  };

  // Determine appropriate currentStep
  let currentStep = existingState.currentStep || 'profile';
  if (steps.verify !== 'done') {
    currentStep = 'verify';
  } else if (!existingState.currentStep) {
    if (steps.profile !== 'done') currentStep = 'profile';
    else if (steps.academic !== 'done') currentStep = 'academic';
    else if (steps.staff !== 'done') currentStep = 'staff';
    else if (steps.students !== 'done') currentStep = 'students';
    else currentStep = 'review';
  }

  // Calculate completion percentage across 6 steps
  const doneCount = Object.values(steps).filter(s => s === 'done').length;
  const completionPercent = Math.round((doneCount / 6) * 100);

  const updatedState = {
    ...existingState,
    currentStep,
    steps,
    completionPercent,
    updatedAt: new Date().toISOString()
  };

  return {
    state: updatedState,
    academicSummary: {
      sessionCount,
      classCount,
      staffCount,
      studentCount
    }
  };
}

// ─── GET /admin/onboarding (Phase 5 State Evaluation) ────────────────────────
exports.getOnboardingState = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient || prisma;
    const collegeId = req.collegeId;

    if (!collegeId) {
      return res.status(400).json({ success: false, message: 'Tenant college not resolved' });
    }

    const college = await prisma.college.findUnique({
      where: { id: collegeId }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const { state, academicSummary } = await computeRealOnboardingState(
      prisma,
      tenantDb,
      college,
      req.user
    );

    // Persist calculated state if it differed from stored state
    if (JSON.stringify(college.onboarding_state) !== JSON.stringify(state)) {
      await prisma.college.update({
        where: { id: collegeId },
        data: { onboarding_state: state }
      });
    }

    // Merge public profile columns with settings for front-end consumption
    const settings = (typeof college.settings === 'object' && college.settings !== null) ? college.settings : {};
    const formattedCollege = {
      id: college.id,
      _id: college.id,
      name: college.name,
      code: college.code,
      slug: college.slug || college.code.toLowerCase(),
      status: college.status,
      email: college.email,
      phone: college.phone || '',
      address: college.address || '',
      city: college.city || '',
      website: college.website || '',
      logo: college.logo || '',
      logo_key: college.logo_key || null,
      coverPhoto: college.cover_key ? college.cover_key : (settings.coverPhoto || ''),
      cover_key: college.cover_key || null,
      tagline: college.tagline || settings.tagline || '',
      about: college.about || settings.about || '',
      establishedYear: college.established_year || settings.establishedYear || null,
      affiliation: college.affiliation || settings.affiliation || '',
      socialLinks: college.social_links || settings.socialLinks || {},
      gallery: Array.isArray(college.gallery) ? college.gallery : [],
      settings,
      onboardingStatus: college.onboardingStatus,
      onboarding_state: state
    };

    res.json({
      success: true,
      data: {
        college: formattedCollege,
        currentStep: state.currentStep,
        steps: state.steps,
        completionPercent: state.completionPercent,
        academicSummary
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── PATCH /admin/onboarding/steps/:step (Phase 5 Step Handler) ──────────────
exports.updateOnboardingStep = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient || prisma;
    const collegeId = req.collegeId;
    const { step } = req.params;

    if (!collegeId) {
      return res.status(400).json({ success: false, message: 'Tenant college not resolved' });
    }

    const college = await prisma.college.findUnique({ where: { id: collegeId } });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const existingState = (typeof college.onboarding_state === 'object' && college.onboarding_state !== null)
      ? college.onboarding_state
      : {};
    const currentSteps = existingState.steps || {};

    // ── STEP: PROFILE ────────────────────────────────────────────────────────
    if (step === 'profile') {
      const {
        name,
        tagline,
        about,
        address,
        city,
        phone,
        email,
        website,
        socialLinks,
        establishedYear,
        affiliation,
        logo,
        logo_key,
        coverPhoto,
        cover_key,
        gallery
      } = req.body;

      // Validation
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'College name is required (min 2 characters)' });
      }
      if (name.trim().length > 100) {
        return res.status(400).json({ success: false, message: 'College name must not exceed 100 characters' });
      }
      if (tagline && tagline.length > 120) {
        return res.status(400).json({ success: false, message: 'Tagline must not exceed 120 characters' });
      }
      if (about && about.length > 1500) {
        return res.status(400).json({ success: false, message: 'About section must not exceed 1500 characters' });
      }
      if (establishedYear) {
        const year = Number(establishedYear);
        const currentYear = new Date().getFullYear();
        if (isNaN(year) || year < 1800 || year > currentYear) {
          return res.status(400).json({ success: false, message: `Established year must be between 1800 and ${currentYear}` });
        }
      }
      if (website && website.trim()) {
        try {
          const urlToTest = website.startsWith('http') ? website : `https://${website}`;
          new URL(urlToTest);
        } catch {
          return res.status(400).json({ success: false, message: 'Invalid website URL format' });
        }
      }

      // Update settings backward compatibility
      const currentSettings = college.settings || {};
      const updatedSettings = {
        ...currentSettings,
        tagline: tagline !== undefined ? tagline : currentSettings.tagline,
        about: about !== undefined ? about : currentSettings.about,
        establishedYear: establishedYear ? Number(establishedYear) : currentSettings.establishedYear,
        affiliation: affiliation !== undefined ? affiliation : currentSettings.affiliation,
        coverPhoto: coverPhoto || currentSettings.coverPhoto || '',
        socialLinks: socialLinks || currentSettings.socialLinks || {}
      };

      const updatedCollege = await prisma.college.update({
        where: { id: collegeId },
        data: {
          name: name.trim(),
          tagline: tagline !== undefined ? tagline.trim() : college.tagline,
          about: about !== undefined ? about.trim() : college.about,
          address: address !== undefined ? address.trim() : college.address,
          city: city !== undefined ? city.trim() : college.city,
          phone: phone !== undefined ? phone.trim() : college.phone,
          ...(email && email.trim() ? { email: email.trim().toLowerCase() } : {}),
          website: website !== undefined ? website.trim() : college.website,
          social_links: socialLinks || college.social_links,
          established_year: establishedYear ? Number(establishedYear) : college.established_year,
          affiliation: affiliation !== undefined ? affiliation.trim() : college.affiliation,
          logo: logo !== undefined ? logo : college.logo,
          logo_key: logo_key !== undefined ? logo_key : college.logo_key,
          cover_key: cover_key !== undefined ? cover_key : college.cover_key,
          gallery: Array.isArray(gallery) ? gallery : college.gallery,
          settings: updatedSettings
        }
      });

      const { state } = await computeRealOnboardingState(prisma, tenantDb, updatedCollege, req.user);
      if (state.steps.profile === 'done' && state.currentStep === 'profile') {
        state.currentStep = 'academic';
      }

      await prisma.college.update({
        where: { id: collegeId },
        data: { onboarding_state: state }
      });

      // Audit & Activity Log
      await createAuditLog(prisma, {
        userId: req.user.id,
        collegeId,
        action: 'ONBOARDING_PROFILE_UPDATED',
        details: `Updated college profile for ${updatedCollege.name}`,
        req
      });
      logActivity({
        college_id: collegeId,
        actorUser: req.user,
        action: ACTIONS.PROFILE_UPDATED || 'PROFILE_UPDATED',
        category: CATEGORIES.COLLEGE || 'College',
        resourceType: 'College',
        resourceId: collegeId,
        title: 'College Profile Updated',
        description: `College profile details and branding saved.`
      }).catch(e => console.error('Activity log error:', e.message));

      return res.json({
        success: true,
        message: 'College profile saved successfully',
        data: {
          college: updatedCollege,
          onboarding_state: state
        }
      });
    }

    // ── STEP: ACADEMIC ───────────────────────────────────────────────────────
    if (step === 'academic') {
      const { session, classes = [], preset = 'custom' } = req.body;

      if (!session || !session.name) {
        return res.status(400).json({ success: false, message: 'Academic session title is required' });
      }

      const sessionTitle = session.name.trim();
      const startDate = session.startDate ? new Date(session.startDate) : new Date();
      const endDate = session.endDate ? new Date(session.endDate) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      // 1. Find or create the academic session
      let existingSession = await tenantDb.session.findFirst({
        where: { college_id: collegeId, name: sessionTitle }
      });

      if (!existingSession) {
        // If this is the college's first session, mark as current
        const totalSessions = await tenantDb.session.count({ where: { college_id: collegeId } });
        existingSession = await tenantDb.session.create({
          data: {
            college_id: collegeId,
            name: sessionTitle,
            startDate,
            endDate,
            isCurrent: totalSessions === 0,
            status: 'active',
            createdBy: req.user.id
          }
        });
      }

      // 2. Create Classes, Groups, Sections & Subjects
      if (Array.isArray(classes) && classes.length > 0) {
        for (const clsItem of classes) {
          if (!clsItem.name || !clsItem.name.trim()) continue;

          const className = clsItem.name.trim();
          const groupsList = Array.isArray(clsItem.groups) ? clsItem.groups : [];

          // Find or create class
          let classRecord = await tenantDb.class.findFirst({
            where: {
              college_id: collegeId,
              session_id: existingSession.id,
              name: className
            }
          });

          if (!classRecord) {
            classRecord = await tenantDb.class.create({
              data: {
                college_id: collegeId,
                session_id: existingSession.id,
                name: className,
                groups: groupsList,
                isActive: true
              }
            });
          }

          // Create Groups if specified
          const createdGroupIds = {};
          for (const grpName of groupsList) {
            const cleanGrp = grpName.trim();
            if (!cleanGrp) continue;
            let groupRecord = await tenantDb.group.findFirst({
              where: {
                college_id: collegeId,
                class_id: classRecord.id,
                name: cleanGrp
              }
            });
            if (!groupRecord) {
              groupRecord = await tenantDb.group.create({
                data: {
                  college_id: collegeId,
                  class_id: classRecord.id,
                  name: cleanGrp,
                  isActive: true
                }
              });
            }
            createdGroupIds[cleanGrp] = groupRecord.id;
          }

          // Create Sections if provided
          const sections = Array.isArray(clsItem.sections) ? clsItem.sections : ['A'];
          for (const sec of sections) {
            const rawLetter = (typeof sec === 'string' ? sec : sec.code || 'A').toUpperCase().trim();
            const classSlug = className.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
            const secCode = `${classSlug}-${rawLetter}`;
            const secName = typeof sec === 'object' && sec.name ? sec.name.trim() : `${className} - ${rawLetter}`;

            const existingSec = await tenantDb.section.findFirst({
              where: {
                college_id: collegeId,
                session_id: existingSession.id,
                code: secCode
              }
            });

            if (!existingSec) {
              await tenantDb.section.create({
                data: {
                  college_id: collegeId,
                  session_id: existingSession.id,
                  class_id: classRecord.id,
                  code: secCode,
                  name: secName,
                  capacity: 50,
                  isActive: true
                }
              });
            }
          }

          // Create Subjects if provided
          if (Array.isArray(clsItem.subjects)) {
            for (const sub of clsItem.subjects) {
              const subName = (typeof sub === 'string' ? sub : sub.name || '').trim();
              if (!subName) continue;
              const subGroup = (typeof sub === 'object' && sub.group) ? sub.group : (groupsList[0] || 'Common');
              const subCode = (typeof sub === 'object' && sub.code) ? sub.code : subName.substring(0, 4).toUpperCase();

              const existingSub = await tenantDb.subject.findFirst({
                where: {
                  college_id: collegeId,
                  OR: [
                    { code: subCode },
                    { name: subName }
                  ]
                }
              });

              if (!existingSub) {
                await tenantDb.subject.create({
                  data: {
                    college_id: collegeId,
                    name: subName,
                    code: subCode,
                    class: 'Both',
                    group: subGroup,
                    isActive: true
                  }
                });
              }
            }
          }
        }
      }

      // Recompute onboarding state
      const { state, academicSummary } = await computeRealOnboardingState(prisma, tenantDb, college, req.user);
      if (state.steps.academic === 'done' && state.currentStep === 'academic') {
        state.currentStep = 'staff';
      }

      await prisma.college.update({
        where: { id: collegeId },
        data: { onboarding_state: state }
      });

      await createAuditLog(prisma, {
        userId: req.user.id,
        collegeId,
        action: 'ONBOARDING_ACADEMIC_SAVED',
        details: `Configured academic session ${sessionTitle} with preset ${preset}`,
        req
      });

      return res.json({
        success: true,
        message: 'Academic setup saved successfully',
        data: {
          session: existingSession,
          academicSummary,
          onboarding_state: state
        }
      });
    }

    // ── STEP: NAVIGATE ───────────────────────────────────────────────────────
    if (step === 'navigate') {
      const { targetStep } = req.body;
      const validSteps = ['verify', 'profile', 'academic', 'staff', 'students', 'review'];
      if (!validSteps.includes(targetStep)) {
        return res.status(400).json({ success: false, message: 'Invalid target step' });
      }

      const updatedState = {
        ...existingState,
        currentStep: targetStep,
        updatedAt: new Date().toISOString()
      };

      await prisma.college.update({
        where: { id: collegeId },
        data: { onboarding_state: updatedState }
      });

      return res.json({
        success: true,
        data: { onboarding_state: updatedState }
      });
    }

    // ── STEP: SKIP (for skippable steps) ─────────────────────────────────────
    if (step === 'skip') {
      const { skipStep } = req.body;
      if (!['staff', 'students'].includes(skipStep)) {
        return res.status(400).json({ success: false, message: 'Only staff and students steps can be skipped' });
      }

      const steps = {
        ...currentSteps,
        [skipStep]: 'done'
      };

      const nextStepMap = { staff: 'students', students: 'review' };
      const updatedState = {
        ...existingState,
        currentStep: nextStepMap[skipStep] || 'review',
        steps,
        updatedAt: new Date().toISOString()
      };

      await prisma.college.update({
        where: { id: collegeId },
        data: { onboarding_state: updatedState }
      });

      return res.json({
        success: true,
        message: `Step ${skipStep} skipped`,
        data: { onboarding_state: updatedState }
      });
    }

    return res.status(400).json({ success: false, message: `Unknown onboarding step: ${step}` });
  } catch (error) {
    next(error);
  }
};

// ─── POST /admin/onboarding/upload (Phase 5 Media Upload) ─────────────────────
exports.uploadOnboardingMedia = async (req, res, next) => {
  try {
    const collegeId = req.collegeId;
    if (!collegeId) {
      return res.status(400).json({ success: false, message: 'College tenant not identified' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file provided' });
    }

    const { type = 'logo' } = req.body; // 'logo' | 'cover' | 'gallery'
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file format. Only JPG, PNG, and WebP images are allowed.'
      });
    }

    // Magic bytes signature verification
    const sigCheck = validateFileSignature(req.file.buffer, req.file.mimetype);
    if (!sigCheck.valid) {
      return res.status(400).json({ success: false, message: sigCheck.error });
    }

    // Size limit check
    const sizeLimits = {
      logo: 1 * 1024 * 1024,      // 1 MB
      cover: 3 * 1024 * 1024,     // 3 MB
      gallery: 2 * 1024 * 1024    // 2 MB
    };
    const maxLimit = sizeLimits[type] || sizeLimits.logo;

    if (req.file.size > maxLimit) {
      const maxMb = maxLimit / (1024 * 1024);
      return res.status(400).json({
        success: false,
        message: `${type.toUpperCase()} image size exceeds the maximum limit of ${maxMb} MB`
      });
    }

    // Resize and optimize with Sharp
    let sharpInstance = sharp(req.file.buffer);
    if (type === 'logo') {
      sharpInstance = sharpInstance.resize(512, 512, { fit: 'inside', withoutEnlargement: true });
    } else if (type === 'cover' || type === 'gallery') {
      sharpInstance = sharpInstance.resize(1600, null, { fit: 'inside', withoutEnlargement: true });
    }

    // Convert to webp with high quality
    const optimizedBuffer = await sharpInstance.webp({ quality: 85 }).toBuffer();
    const objectKey = generateObjectKey(collegeId, 'college', type, `${Date.now()}_${type}.webp`);

    // Upload to R2 storage
    await uploadObject({
      objectKey,
      body: optimizedBuffer,
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable'
    });

    const publicUrl = `/api/files/download-key?key=${encodeURIComponent(objectKey)}`;

    res.json({
      success: true,
      message: `${type} uploaded successfully`,
      data: {
        objectKey,
        url: publicUrl,
        contentType: 'image/webp',
        sizeBytes: optimizedBuffer.length
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── Legacy Controllers (Preserved for backwards compatibility) ──────────────

exports.getOnboardingStatus = async (req, res, next) => {
  return exports.getOnboardingState(req, res, next);
};

exports.saveStep1Profile = async (req, res, next) => {
  req.params = { step: 'profile' };
  return exports.updateOnboardingStep(req, res, next);
};

exports.saveStep2Academic = async (req, res, next) => {
  req.params = { step: 'academic' };
  return exports.updateOnboardingStep(req, res, next);
};

exports.saveStep3Staff = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { staffList = [], skip = false } = req.body;

    const college = await prisma.college.findUnique({ where: { id: req.collegeId } });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College workspace not found.' });
    }

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

    const existingState = college.onboarding_state || {};
    const updatedState = {
      ...existingState,
      currentStep: 'students',
      steps: {
        ...(existingState.steps || {}),
        staff: 'done'
      },
      updatedAt: new Date().toISOString()
    };

    const updatedCollege = await prisma.college.update({
      where: { id: req.collegeId },
      data: {
        onboarding_state: updatedState,
        onboardingStep: 4
      }
    });

    res.json({
      success: true,
      message: skip ? 'Step 3 skipped.' : 'Step 3: Staff Accounts created successfully.',
      data: {
        college: updatedCollege,
        onboarding_state: updatedState
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── Phase 7: GET /admin/onboarding/review ──────────────────────────────────
exports.getReviewChecklist = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient || prisma;
    const collegeId = req.collegeId;

    const [college, adminUser, sessionCount, classCount, staffCount, studentCount] = await Promise.all([
      prisma.college.findUnique({
        where: { id: collegeId },
        select: {
          id: true,
          name: true,
          code: true,
          slug: true,
          status: true,
          logo: true,
          logo_key: true,
          coverPhoto: true,
          cover_key: true,
          about: true,
          tagline: true,
          address: true,
          city: true,
          phone: true,
          email: true,
          gallery: true,
          onboarding_state: true,
          activated_at: true
        }
      }),
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, name: true, email: true, emailVerified: true }
      }),
      tenantDb.session.count({ where: { college_id: collegeId } }).catch(() => 0),
      tenantDb.class.count({ where: { college_id: collegeId } }).catch(() => 0),
      tenantDb.user.count({
        where: {
          college_id: collegeId,
          role: { in: ['principal', 'registrar', 'accountant', 'teacher', 'employee'] }
        }
      }).catch(() => 0),
      tenantDb.student.count({ where: { college_id: collegeId } }).catch(() => 0)
    ]);

    if (!college) {
      return res.status(404).json({ success: false, message: 'College workspace not found.' });
    }

    const hasName = Boolean(college.name && college.name.trim().length >= 2);
    const hasCity = Boolean(college.city && college.city.trim().length > 0);
    const hasContact = Boolean((college.phone && college.phone.trim().length > 0) || (college.email && college.email.trim().length > 0));
    const hasLogo = Boolean(college.logo || college.logo_key);

    const isEmailVerified = Boolean(adminUser?.emailVerified);
    const isProfileCompleted = hasName && hasCity && hasContact && hasLogo;
    const hasSessions = sessionCount >= 1;
    const hasClasses = classCount >= 1;

    const missingRequired = [];
    if (!isEmailVerified) missingRequired.push('Administrator email verification');
    if (!hasName) missingRequired.push('Institution name');
    if (!hasCity) missingRequired.push('Campus location/city');
    if (!hasContact) missingRequired.push('Public phone or email contact');
    if (!hasLogo) missingRequired.push('Official institution logo');
    if (!hasSessions) missingRequired.push('At least one academic session');
    if (!hasClasses) missingRequired.push('At least one academic class');

    const canLaunch = missingRequired.length === 0;

    const required = {
      emailVerified: isEmailVerified,
      profileCompleted: isProfileCompleted,
      hasSessions,
      hasClasses,
      sessionCount,
      classCount,
      hasName,
      hasCity,
      hasContact,
      hasLogo
    };

    const optional = {
      hasCoverPhoto: Boolean(college.coverPhoto || college.cover_key),
      hasAbout: Boolean(college.about && college.about.trim().length >= 20),
      hasTagline: Boolean(college.tagline && college.tagline.trim().length > 0),
      galleryCount: Array.isArray(college.gallery) ? college.gallery.length : 0,
      staffCount,
      studentCount,
      allOptionalDone: Boolean(
        (college.coverPhoto || college.cover_key) &&
        (college.about && college.about.trim().length >= 20) &&
        staffCount >= 1 &&
        studentCount >= 1
      )
    };

    res.json({
      success: true,
      data: {
        canLaunch,
        missingRequired,
        required,
        optional,
        college: {
          id: college.id,
          name: college.name,
          slug: college.slug || college.code.toLowerCase(),
          code: college.code,
          status: college.status,
          logo: college.logo,
          city: college.city
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── Phase 7: POST /admin/onboarding/launch ─────────────────────────────────
exports.launchCollegeWorkspace = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient || prisma;
    const collegeId = req.collegeId;

    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: {
        id: true,
        name: true,
        code: true,
        slug: true,
        status: true,
        logo: true,
        logo_key: true,
        city: true,
        phone: true,
        email: true,
        onboarding_state: true,
        activated_at: true
      }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College workspace not found.' });
    }

    // Idempotent: already active
    if (college.status === 'active') {
      return res.json({
        success: true,
        message: 'College workspace is already active.',
        data: { college, alreadyActive: true }
      });
    }

    // 1. Strict Server Re-Check of Required Launch Checklist
    const [adminUser, sessionCount, classCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, email: true, name: true, emailVerified: true }
      }),
      tenantDb.session.count({ where: { college_id: collegeId } }).catch(() => 0),
      tenantDb.class.count({ where: { college_id: collegeId } }).catch(() => 0)
    ]);

    const hasName = Boolean(college.name && college.name.trim().length >= 2);
    const hasCity = Boolean(college.city && college.city.trim().length > 0);
    const hasContact = Boolean((college.phone && college.phone.trim().length > 0) || (college.email && college.email.trim().length > 0));
    const hasLogo = Boolean(college.logo || college.logo_key);

    const isEmailVerified = Boolean(adminUser?.emailVerified);
    const isProfileCompleted = hasName && hasCity && hasContact && hasLogo;
    const hasSessions = sessionCount >= 1;
    const hasClasses = classCount >= 1;

    const missingRequired = [];
    if (!isEmailVerified) missingRequired.push('Administrator email verification');
    if (!hasName) missingRequired.push('Institution name');
    if (!hasCity) missingRequired.push('Campus location/city');
    if (!hasContact) missingRequired.push('Public phone or email contact');
    if (!hasLogo) missingRequired.push('Official institution logo');
    if (!hasSessions) missingRequired.push('At least one academic session');
    if (!hasClasses) missingRequired.push('At least one academic class');

    if (missingRequired.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot launch college: missing required setup items.',
        missingRequired
      });
    }

    // 2. Atomic Transition to Active Status
    const existingState = (typeof college.onboarding_state === 'object' && college.onboarding_state !== null)
      ? college.onboarding_state
      : {};

    const updatedState = {
      ...existingState,
      currentStep: 'review',
      steps: {
        verify: 'done',
        profile: 'done',
        academic: 'done',
        staff: 'done',
        students: 'done',
        review: 'done'
      },
      isCompleted: true,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const updatedCollege = await prisma.college.update({
      where: { id: collegeId },
      data: {
        status: 'active',
        isActive: true,
        onboardingStatus: 'completed',
        onboardingStep: 6,
        activated_at: college.activated_at || new Date(),
        onboarding_state: updatedState
      }
    });

    // 3. Audit & Activity Logging
    await createAuditLog(prisma, {
      userId: req.user.id,
      collegeId,
      action: 'COLLEGE_LAUNCHED',
      details: `College ${college.name} (${college.code}) launched successfully and transitioned to active status.`,
      req
    });

    logActivity({
      college_id: collegeId,
      actorUser: req.user,
      action: ACTIONS.COLLEGE_LAUNCHED || 'COLLEGE_LAUNCHED',
      category: CATEGORIES.COLLEGE || 'College',
      resourceType: 'College',
      resourceId: collegeId,
      title: 'College Workspace Launched',
      description: `${college.name} completed onboarding and launched active workspace.`
    }).catch(e => console.error('Activity log error:', e.message));

    // 4. In-App Notification & Announcement for Super Admins
    try {
      const superAdmins = await prisma.user.findMany({
        where: { role: 'superAdmin' },
        select: { id: true, email: true }
      });

      for (const sa of superAdmins) {
        await prisma.notification.create({
          data: {
            college_id: collegeId,
            recipient: sa.id,
            title: 'College Workspace Launched',
            message: `${college.name} (${college.slug || college.code}) has completed setup and is now active!`,
            type: 'system',
            link: '/super-admin/colleges'
          }
        }).catch(() => {});
      }

      await prisma.announcement.create({
        data: {
          college_id: collegeId,
          title: `Workspace Launched: ${college.name}`,
          content: `${college.name} has completed onboarding setup and published their active college profile.`,
          category: 'Administration',
          audience: 'All Users',
          priority: 'High',
          status: 'Published',
          createdBy: req.user.id
        }
      }).catch(() => {});
    } catch (notifyErr) {
      console.error('Super admin notification error:', notifyErr.message);
    }

    // 5. Branded Welcome Email to the College Admin
    const rootDomain = process.env.ROOT_DOMAIN || 'collegeshub.org';
    const slug = (college.slug || college.code).toLowerCase();
    const isDev = process.env.NODE_ENV === 'development';
    const tenantUrl = isDev ? `http://${slug}.localhost:3000` : `https://${slug}.${rootDomain}`;
    const adminUrl = `${tenantUrl}/admin`;

    const welcomeHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff;">
        <div style="margin-bottom: 24px; text-align: center;">
          <h2 style="color: #0A4D94; margin: 0;">Colleges<span style="color: #299A49;">hub</span><span style="color: #299A49; font-size: 14px;">.org</span></h2>
          <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Campus Management Platform</p>
        </div>
        <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; background: #f8fafc;">
          <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">🎉 Congratulations, ${college.name}!</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            Your college workspace on Collegeshub has been officially launched and is now <strong>active</strong>!
          </p>
          <div style="margin: 20px 0; padding: 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;"><strong>What's now live:</strong></p>
            <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #334155; line-height: 1.6;">
              <li>Your public college portal is live at <a href="${tenantUrl}" style="color: #0A4D94; font-weight: bold;">${tenantUrl}</a></li>
              <li>Teachers, staff members, and students can now log in securely.</li>
              <li>Your administrative management tools are fully operational.</li>
            </ul>
          </div>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${adminUrl}" style="background-color: #0A4D94; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
              Access Admin Dashboard
            </a>
          </div>
          <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin-bottom: 0;">
            Need assistance or have questions? Our support team is always here to help at <a href="mailto:support@collegeshub.org" style="color: #0A4D94;">support@collegeshub.org</a>.
          </p>
        </div>
      </div>
    `;

    await sendMail({
      to: req.user.email,
      subject: `🎉 Congratulations! ${college.name} is now live on Collegeshub`,
      html: welcomeHtml,
      text: `Congratulations! ${college.name} is now live on Collegeshub. Access your administrative dashboard at: ${adminUrl}`
    }).catch(e => console.error('Welcome email dispatch notice:', e.message));

    res.json({
      success: true,
      message: '🎉 Congratulations! Your college workspace is now active and live.',
      data: {
        college: updatedCollege,
        tenantUrl,
        adminUrl
      }
    });
  } catch (error) {
    next(error);
  }
};

// Aliased for backwards compatibility
exports.completeOnboarding = exports.launchCollegeWorkspace;
