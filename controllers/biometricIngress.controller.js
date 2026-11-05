const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/**
 * Register a new biometric device for a college
 * Generates an unguessable 32-byte hex secret, stores its SHA-256 hash, and returns secret once.
 */
exports.registerDevice = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { serialNumber, deviceName, location, campusId } = req.body;
    if (!serialNumber || !deviceName) {
      return res.status(400).json({ success: false, message: 'serialNumber and deviceName are required' });
    }

    // Global unique check on serialNumber
    const existing = await prisma.biometricDevice.findUnique({
      where: { serialNumber }
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'SERIAL_NUMBER_ALREADY_REGISTERED',
        message: 'A biometric device with this serial number already exists'
      });
    }

    const rawSecret = crypto.randomBytes(32).toString('hex');
    const pushSecretHash = hashSecret(rawSecret);

    const device = await prisma.biometricDevice.create({
      data: {
        college_id: req.collegeId,
        campus_id: campusId || null,
        serialNumber,
        deviceName,
        location: location || null,
        status: 'ACTIVE',
        pushSecretHash
      }
    });

    res.status(201).json({
      success: true,
      data: {
        id: device.id,
        serialNumber: device.serialNumber,
        deviceName: device.deviceName,
        location: device.location,
        status: device.status,
        deviceSecret: rawSecret // Shown ONCE on creation
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List registered devices for a college
 */
exports.getDevices = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const devices = await prisma.biometricDevice.findMany({
      where: { college_id: req.collegeId },
      select: {
        id: true,
        serialNumber: true,
        deviceName: true,
        location: true,
        status: true,
        lastSeenAt: true,
        createdAt: true
      }
    });
    res.json({ success: true, data: devices });
  } catch (error) {
    next(error);
  }
};

/**
 * Path B Punch Ingress Endpoint
 * POST /api/biometric/devices/:deviceId/punches
 * Header: Authorization: Bearer <deviceSecret>
 */
exports.ingestPunches = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { deviceId } = req.params;
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header'
      });
    }

    const token = authHeader.slice(7).trim();
    const tokenHash = hashSecret(token);

    const device = await prisma.biometricDevice.findUnique({
      where: { id: deviceId }
    });

    if (!device || device.status !== 'ACTIVE' || device.pushSecretHash !== tokenHash) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_DEVICE_CREDENTIALS',
        message: 'Invalid device ID or bearer token'
      });
    }

    const punches = Array.isArray(req.body.punches) ? req.body.punches : (Array.isArray(req.body) ? req.body : []);
    if (punches.length === 0) {
      return res.status(400).json({ success: false, message: 'Punches array cannot be empty' });
    }
    if (punches.length > 1000) {
      return res.status(422).json({
        success: false,
        code: 'BATCH_SIZE_EXCEEDED',
        message: 'Maximum 1,000 punches per batch push'
      });
    }

    const now = new Date();
    const maxFuture = new Date(now.getTime() + 5 * 60 * 1000); // now + 5 min
    const maxBackfill = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // now - 7 days

    // Validate times
    for (const p of punches) {
      const pTime = new Date(p.punchTime);
      if (isNaN(pTime.getTime())) {
        return res.status(422).json({ success: false, code: 'INVALID_PUNCH_TIME', message: 'Invalid punch timestamp' });
      }
      if (pTime > maxFuture) {
        return res.status(422).json({
          success: false,
          code: 'FUTURE_PUNCH_REJECTED',
          message: 'Punches timestamped more than 5 minutes in the future are rejected'
        });
      }
      if (pTime < maxBackfill) {
        return res.status(422).json({
          success: false,
          code: 'BACKFILL_WINDOW_EXCEEDED',
          message: 'Punches older than 7 days are rejected'
        });
      }
    }

    // Insert punches idempotently
    let accepted = 0;
    for (const p of punches) {
      const pTime = new Date(p.punchTime);
      try {
        await prisma.biometricPunchLog.create({
          data: {
            college_id: device.college_id,
            campus_id: device.campus_id,
            deviceId: device.id,
            deviceUserId: String(p.deviceUserId),
            punchTime: pTime,
            processed: false
          }
        });
        accepted++;
      } catch (err) {
        // Idempotent duplicate: unique compound key violation (P2002)
        if (err.code !== 'P2002') {
          console.error('Error inserting punch:', err.message);
        }
      }
    }

    // Update lastSeenAt
    await prisma.biometricDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: now }
    });

    res.json({
      success: true,
      message: `Received ${punches.length} punches (${accepted} new, ${punches.length - accepted} duplicate)`,
      data: { received: punches.length, accepted, duplicates: punches.length - accepted }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create or update identity map (deviceUserId -> STUDENT / STAFF)
 */
exports.createIdentityMap = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { deviceUserId, subjectType, subjectId, campusId } = req.body;
    if (!deviceUserId || !subjectType || !subjectId) {
      return res.status(400).json({ success: false, message: 'deviceUserId, subjectType, and subjectId are required' });
    }

    const mapping = await prisma.biometricIdentityMap.upsert({
      where: {
        college_id_deviceUserId: {
          college_id: req.collegeId,
          deviceUserId: String(deviceUserId)
        }
      },
      create: {
        college_id: req.collegeId,
        campus_id: campusId || null,
        deviceUserId: String(deviceUserId),
        subjectType,
        subjectId
      },
      update: {
        campus_id: campusId || null,
        subjectType,
        subjectId
      }
    });

    // Automatically re-drive unmapped punches for this deviceUserId
    const unmapped = await prisma.unmappedBiometricPunch.findMany({
      where: {
        college_id: req.collegeId,
        deviceUserId: String(deviceUserId),
        resolvedAt: null
      }
    });

    for (const u of unmapped) {
      try {
        await prisma.biometricPunchLog.create({
          data: {
            college_id: req.collegeId,
            campus_id: u.campus_id,
            deviceId: u.deviceId,
            deviceUserId: u.deviceUserId,
            punchTime: u.punchTime,
            processed: false
          }
        });
        await prisma.unmappedBiometricPunch.update({
          where: { id: u.id },
          data: { resolvedAt: new Date() }
        });
      } catch (err) {
        // If already in log, mark resolved
        if (err.code === 'P2002') {
          await prisma.unmappedBiometricPunch.update({
            where: { id: u.id },
            data: { resolvedAt: new Date() }
          });
        }
      }
    }

    res.json({ success: true, data: mapping, redrivenPunches: unmapped.length });
  } catch (error) {
    next(error);
  }
};

/**
 * Get unmapped punches
 */
exports.getUnmappedPunches = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const unmapped = await prisma.unmappedBiometricPunch.findMany({
      where: { college_id: req.collegeId, resolvedAt: null },
      orderBy: { punchTime: 'desc' },
      take: 200
    });
    res.json({ success: true, data: unmapped });
  } catch (error) {
    next(error);
  }
};

