// ─── Public Controller (Multi-DB with Prisma) ───────────────────
const { getSystemClient, getTenantClient } = require('../config/prismaManager');
const { verifyFirebaseToken } = require('../config/firebaseAdmin');
const { consume, getCollegeLimit } = require('../services/quota');

exports.getColleges = async (req, res, next) => {
  try {
    const systemDb = getSystemClient();
    const colleges = await systemDb.college.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        website: true,
        logo: true
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      success: true,
      data: colleges.map(c => ({
        ...c,
        _id: c.id
      }))
    });
  } catch (error) {
    next(error);
  }
};

exports.getCollegePage = async (req, res, next) => {
  try {
    const systemDb = getSystemClient();
    const param = req.params.code || req.params.codeOrSlug;

    const college = await systemDb.college.findFirst({
      where: {
        OR: [
          { code: param.toUpperCase() },
          { slug: param.toLowerCase() }
        ]
      }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    let season = null;
    let announcements = [];

    const connectionUrl = college.mongoUrl || process.env.DATABASE_URL;
    if (connectionUrl) {
      let tenantDb;
      try {
        tenantDb = getTenantClient(connectionUrl);
      } catch (err) {
        tenantDb = systemDb;
      }

      try {
        season = await tenantDb.admissionSeason.findFirst({
          where: {
            college_id: college.id,
            status: 'open'
          },
          orderBy: { createdAt: 'desc' }
        });
      } catch (e) {
        console.warn(`Tenant season lookup failed for college ${college.code}, falling back to system DB:`, e.message);
        try {
          season = await systemDb.admissionSeason.findFirst({
            where: {
              college_id: college.id,
              status: 'open'
            },
            orderBy: { createdAt: 'desc' }
          });
        } catch (sysErr) {
          season = null;
        }
      }

      try {
        const rawAnnouncements = await tenantDb.announcement.findMany({
          where: {
            college_id: college.id,
            isPublic: true
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        });

        announcements = rawAnnouncements.map(a => ({
          ...a,
          _id: a.id
        }));
      } catch (e) {
        console.warn(`Tenant announcements lookup failed for college ${college.code}, falling back to system DB:`, e.message);
        try {
          const rawAnnouncements = await systemDb.announcement.findMany({
            where: {
              college_id: college.id,
              isPublic: true
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          });

          announcements = rawAnnouncements.map(a => ({
            ...a,
            _id: a.id
          }));
        } catch (sysErr) {
          announcements = [];
        }
      }
    }

    res.json({
      success: true,
      data: {
        college: {
          _id: college.id,
          name: college.name,
          code: college.code,
          email: college.email,
          phone: college.phone,
          address: college.address,
          city: college.city,
          website: college.website,
          logo: college.logo,
          settings: college.settings
        },
        admissionSeason: season ? { ...season, _id: season.id } : null,
        announcements
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.submitApplication = async (req, res, next) => {
  try {
    const systemDb = getSystemClient();
    const param = req.params.code;

    const college = await systemDb.college.findFirst({
      where: {
        OR: [
          { code: param.toUpperCase() },
          { slug: param.toLowerCase() }
        ]
      }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const connectionUrl = college.mongoUrl || process.env.DATABASE_URL;
    if (!connectionUrl) {
      return res.status(400).json({ success: false, message: 'College not configured' });
    }

    const tenantDb = getTenantClient(connectionUrl);

    const season = await tenantDb.admissionSeason.findFirst({
      where: {
        college_id: college.id,
        status: 'open'
      }
    });

    if (!season) {
      return res.status(400).json({ success: false, message: 'Admissions are currently closed' });
    }
    if (new Date() > new Date(season.endDate)) {
      return res.status(400).json({ success: false, message: 'Deadline passed' });
    }

    const idToken = req.body.idToken;
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Google identity verification token is required' });
    }

    let firebaseUser;
    try {
      firebaseUser = await verifyFirebaseToken(idToken);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Identity verification failed: ' + err.message });
    }

    if (!firebaseUser.emailVerified) {
      return res.status(400).json({ success: false, message: 'Google email address is not verified' });
    }

    if (firebaseUser.email.toLowerCase() !== req.body.email.toLowerCase()) {
      return res.status(400).json({ success: false, message: 'Submitted email address does not match verified Google account' });
    }

    const existing = await tenantDb.application.findFirst({
      where: {
        college_id: college.id,
        email: firebaseUser.email.toLowerCase()
      }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Application already exists for this email' });
    }

    const existingUser = await systemDb.user.findUnique({
      where: { email: firebaseUser.email.toLowerCase() }
    });

    let user;
    if (existingUser) {
      // Update existing user with Google auth provider details if they aren't linked yet
      const updateData = {};
      if (!existingUser.firebaseUid) updateData.firebaseUid = firebaseUser.uid;
      if (existingUser.authProvider !== 'google') updateData.authProvider = 'google';
      if (!existingUser.emailVerified) updateData.emailVerified = true;

      if (Object.keys(updateData).length > 0) {
        user = await systemDb.user.update({
          where: { id: existingUser.id },
          data: updateData
        });
      } else {
        user = existingUser;
      }
    } else {
      user = await systemDb.user.create({
        data: {
          name: req.body.name,
          email: firebaseUser.email.toLowerCase(),
          firebaseUid: firebaseUser.uid,
          authProvider: 'google',
          emailVerified: true,
          role: 'student',
          college_id: college.id,
          phone: req.body.phone,
          isActive: false,
          avatar: firebaseUser.picture || ''
        }
      });
    }

    // Auto-generate application number
    const count = await tenantDb.application.count({
      where: { college_id: college.id }
    });
    const year = new Date().getFullYear();
    const applicationNumber = `APP-${year}-${String(count + 1).padStart(5, '0')}`;

    // Auto-calculate aggregate
    let sscAggregate = null;
    if (req.body.sscTotalMarks && req.body.sscObtainedMarks) {
      sscAggregate = Math.round((parseFloat(req.body.sscObtainedMarks) / parseFloat(req.body.sscTotalMarks)) * 10000) / 100;
    }

    const application = await tenantDb.application.create({
      data: {
        college_id: college.id,
        season_id: season.id,
        user_id: user.id,
        applicationNumber,
        name: req.body.name,
        fatherName: req.body.fatherName,
        cnic: req.body.cnic,
        dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : new Date(),
        gender: req.body.gender,
        phone: req.body.phone,
        email: req.body.email.toLowerCase(),
        address: req.body.address,
        city: req.body.city,
        guardianName: req.body.guardianName,
        guardianPhone: req.body.guardianPhone,
        guardianRelation: req.body.guardianRelation,
        sscBoard: req.body.sscBoard,
        sscYear: parseInt(req.body.sscYear) || 0,
        sscRollNumber: req.body.sscRollNumber,
        sscTotalMarks: parseFloat(req.body.sscTotalMarks) || 0,
        sscObtainedMarks: parseFloat(req.body.sscObtainedMarks) || 0,
        sscAggregate,
        sscResultStatus: req.body.sscResultStatus || 'declared',
        preferredClass: req.body.preferredClass || 'FSC Part 1',
        preferredGroup: req.body.preferredGroup,
        photo: req.body.photo || '',
        sscDMC: req.body.sscDMC || '',
        hopeCertificate: req.body.hopeCertificate || '',
        ninthDMC: req.body.ninthDMC || '',
        otherDocuments: req.body.otherDocuments || null,
        entryTestRequired: season.entryTestRequired || false,
        entryTestDate: season.entryTestDate,
        entryTestVenue: season.entryTestVenue,
        source: 'ONLINE',
        quota: req.body.quota || null,
        equivalenceBoard: req.body.equivalenceBoard || null,
        equivalenceMarks: req.body.equivalenceMarks ? parseFloat(req.body.equivalenceMarks) : null,
        meritScore: req.body.equivalenceMarks ? parseFloat(req.body.equivalenceMarks) : sscAggregate,
        status: 'submitted'
      }
    });

    // Atomically consume 1 application quota unit
    try {
      const currentYear = String(new Date().getFullYear());
      const limit = await getCollegeLimit(systemDb, college.id, 'applications');
      await consume(systemDb, college.id, 'applications', 1, limit, currentYear);
    } catch (quotaErr) {
      console.warn('Application quota consumption error:', quotaErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully!',
      data: {
        applicationNumber: application.applicationNumber,
        status: application.status,
        entryTestRequired: application.entryTestRequired,
        entryTestDate: application.entryTestDate
      }
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Duplicate application.' });
    }
    next(error);
  }
};

exports.checkStatus = async (req, res, next) => {
  try {
    const systemDb = getSystemClient();
    const colleges = await systemDb.college.findMany({
      where: { isActive: true }
    });

    for (const c of colleges) {
      try {
        const connectionUrl = c.mongoUrl || process.env.DATABASE_URL;
        if (!connectionUrl) continue;
        
        const tenantDb = getTenantClient(connectionUrl);
        const app = await tenantDb.application.findUnique({
          where: { applicationNumber: req.params.appNumber },
          select: {
            id: true,
            applicationNumber: true,
            name: true,
            status: true,
            entryTestRequired: true,
            entryTestDate: true,
            entryTestStatus: true,
            sscAggregate: true,
            rejectionReason: true,
            createdAt: true
          }
        });

        if (app) {
          return res.json({
            success: true,
            data: {
              ...app,
              _id: app.id
            }
          });
        }
      } catch (err) {
        console.error(`Status check failed for college ${c.name}:`, err.message);
      }
    }

    res.status(404).json({ success: false, message: 'Application not found' });
  } catch (error) {
    next(error);
  }
};
