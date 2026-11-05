// ─── IP Allow-list Service (Phase 10: N15 Campus IP Allow-Listing) ─────
const ipaddr = require('ipaddr.js');
const { getSystemClient } = require('../config/prismaManager');

/**
 * Normalizes an IP string (extracting IPv4 from IPv4-mapped IPv6 if present)
 */
function normalizeIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return '';
  const trimmed = rawIp.trim();
  try {
    let addr = ipaddr.parse(trimmed);
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
      addr = addr.toIPv4Address();
    }
    return addr.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Validates and normalizes an IP or CIDR block
 * @returns {string} normalized CIDR representation (e.g. '192.168.1.0/24' or '10.0.0.1/32')
 */
function parseAndValidateCidr(cidrString) {
  if (!cidrString || typeof cidrString !== 'string') {
    throw new Error('CIDR string must be a non-empty string');
  }
  const clean = cidrString.trim();

  // If already contains prefix length
  if (clean.includes('/')) {
    try {
      const parsed = ipaddr.parseCIDR(clean);
      return `${parsed[0].toString()}/${parsed[1]}`;
    } catch {
      throw new Error(`Invalid CIDR subnet representation: ${clean}`);
    }
  }

  // Single IP: parse as IPv4 (/32) or IPv6 (/128)
  try {
    let addr = ipaddr.parse(clean);
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
      addr = addr.toIPv4Address();
    }
    const prefix = addr.kind() === 'ipv4' ? 32 : 128;
    return `${addr.toString()}/${prefix}`;
  } catch {
    throw new Error(`Invalid IP address or CIDR: ${clean}`);
  }
}

/**
 * Checks whether clientIp matches any CIDR rule in rules
 */
function isIpAllowed(rawClientIp, rules) {
  if (!rules || rules.length === 0) {
    // If no rules configured, allow by default
    return true;
  }

  let clientAddr;
  try {
    clientAddr = ipaddr.parse(normalizeIp(rawClientIp));
  } catch {
    return false;
  }

  for (const rule of rules) {
    if (!rule.isActive) continue;
    try {
      let cidrStr = rule.cidr;
      if (!cidrStr.includes('/')) {
        const prefix = clientAddr.kind() === 'ipv4' ? 32 : 128;
        cidrStr = `${cidrStr}/${prefix}`;
      }
      const parsedCidr = ipaddr.parseCIDR(cidrStr);

      // Only match if same address family
      if (clientAddr.kind() === parsedCidr[0].kind()) {
        if (clientAddr.match(parsedCidr)) {
          return true;
        }
      }
    } catch {
      // Ignore invalid rule format in loop
      continue;
    }
  }

  return false;
}

/**
 * Checks if currentIp would be locked out by candidateRules
 * @returns {boolean} true if saver would be locked out
 */
function wouldLockOutSaver(currentIp, candidateRules) {
  if (!currentIp) return false;
  const activeRules = (candidateRules || []).filter(r => r.isActive !== false);
  if (activeRules.length === 0) return true; // Empty active rules in ENFORCE mode locks out everyone
  return !isIpAllowed(currentIp, activeRules);
}

/**
 * Retrieves allowlist rules for a college
 */
async function getCollegeRules(collegeId, campusId = null) {
  const prisma = getSystemClient();
  const where = { college_id: collegeId };
  if (campusId) {
    where.campus_id = campusId;
  }
  return await prisma.ipAllowlistRule.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Creates an allowlist rule
 */
async function createRule(collegeId, { label, cidr, campus_id = null, createdBy, currentIp = null }) {
  const prisma = getSystemClient();

  if (!label || typeof label !== 'string' || !label.trim()) {
    const err = new Error('Label is required');
    err.statusCode = 422;
    throw err;
  }

  let normalizedCidr;
  try {
    normalizedCidr = parseAndValidateCidr(cidr);
  } catch (parseErr) {
    const err = new Error(parseErr.message);
    err.statusCode = 422;
    throw err;
  }

  // Check college mode
  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: { id: true, ipAllowlistMode: true }
  });
  if (!college) {
    const err = new Error('College not found');
    err.statusCode = 404;
    throw err;
  }

  // If already ENFORCE and currentIp provided, verify saver won't be locked out
  if (college.ipAllowlistMode === 'ENFORCE' && currentIp) {
    const existingRules = await prisma.ipAllowlistRule.findMany({
      where: { college_id: collegeId, isActive: true }
    });
    const candidateRules = [...existingRules, { cidr: normalizedCidr, isActive: true }];
    if (wouldLockOutSaver(currentIp, candidateRules)) {
      const err = new Error('Rule rejected: your current IP would be blocked under ENFORCE mode');
      err.code = 'WOULD_LOCK_OUT_SAVER';
      err.statusCode = 409;
      throw err;
    }
  }

  return await prisma.ipAllowlistRule.create({
    data: {
      college_id: collegeId,
      campus_id: campus_id || null,
      label: label.trim(),
      cidr: normalizedCidr,
      isActive: true,
      createdBy: createdBy || 'admin'
    }
  });
}

/**
 * Deletes an allowlist rule
 */
async function deleteRule(collegeId, ruleId, currentIp = null) {
  const prisma = getSystemClient();

  const rule = await prisma.ipAllowlistRule.findFirst({
    where: { id: ruleId, college_id: collegeId }
  });
  if (!rule) {
    const err = new Error('Rule not found');
    err.statusCode = 404;
    throw err;
  }

  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: { ipAllowlistMode: true }
  });

  if (college?.ipAllowlistMode === 'ENFORCE' && currentIp) {
    const remainingRules = await prisma.ipAllowlistRule.findMany({
      where: { college_id: collegeId, id: { not: ruleId }, isActive: true }
    });
    if (wouldLockOutSaver(currentIp, remainingRules)) {
      const err = new Error('Cannot delete rule: your current IP would be locked out under ENFORCE mode');
      err.code = 'WOULD_LOCK_OUT_SAVER';
      err.statusCode = 409;
      throw err;
    }
  }

  return await prisma.ipAllowlistRule.delete({
    where: { id: ruleId }
  });
}

/**
 * Updates allowlist mode (OFF, LOG_ONLY, ENFORCE)
 */
async function setAllowlistMode(collegeId, newMode, currentIp = null) {
  const prisma = getSystemClient();
  const validModes = ['OFF', 'LOG_ONLY', 'ENFORCE'];

  if (!validModes.includes(newMode)) {
    const err = new Error(`Invalid allowlist mode. Must be one of: ${validModes.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }

  if (newMode === 'ENFORCE') {
    const activeRules = await prisma.ipAllowlistRule.findMany({
      where: { college_id: collegeId, isActive: true }
    });

    if (activeRules.length === 0) {
      const err = new Error('Cannot enable ENFORCE mode with zero active rules; this would lock out all users');
      err.code = 'WOULD_LOCK_OUT_SAVER';
      err.statusCode = 409;
      throw err;
    }

    if (currentIp && wouldLockOutSaver(currentIp, activeRules)) {
      const err = new Error('Cannot enable ENFORCE mode: your current IP is not allowed by any active rule');
      err.code = 'WOULD_LOCK_OUT_SAVER';
      err.statusCode = 409;
      throw err;
    }
  }

  return await prisma.college.update({
    where: { id: collegeId },
    data: { ipAllowlistMode: newMode }
  });
}

/**
 * Records an IP allowlist violation (deduplicated by dayKey)
 */
async function recordViolation({ college_id, campus_id = null, userId = null, ip, path, mode }) {
  const prisma = getSystemClient();
  const cleanIp = normalizeIp(ip) || '0.0.0.0';
  const dayKey = new Date().toISOString().slice(0, 10);
  const targetUser = userId || 'unauthenticated';

  try {
    return await prisma.ipAllowlistViolation.upsert({
      where: {
        college_id_userId_ip_dayKey: {
          college_id,
          userId: targetUser,
          ip: cleanIp,
          dayKey
        }
      },
      update: {
        path: path || '/',
        mode: mode || 'LOG_ONLY'
      },
      create: {
        college_id,
        campus_id: campus_id || null,
        userId: targetUser,
        ip: cleanIp,
        path: path || '/',
        mode: mode || 'LOG_ONLY',
        dayKey
      }
    });
  } catch (err) {
    console.warn(`[IpAllowlist] Failed to record violation: ${err.message}`);
    return null;
  }
}

/**
 * Gets violation summary and audit log
 */
async function getViolationsSummary(collegeId, { page = 1, limit = 50 } = {}) {
  const prisma = getSystemClient();
  const skip = (Math.max(1, page) - 1) * limit;

  const [violations, total] = await Promise.all([
    prisma.ipAllowlistViolation.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.ipAllowlistViolation.count({
      where: { college_id: collegeId }
    })
  ]);

  return {
    violations,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Purges violations older than retentionDays
 */
async function purgeOldViolations(retentionDays = 30) {
  const prisma = getSystemClient();
  const cutoff = new Date(Date.now() - retentionDays * 86400000);
  const result = await prisma.ipAllowlistViolation.deleteMany({
    where: { createdAt: { lt: cutoff } }
  });
  return result.count;
}

module.exports = {
  normalizeIp,
  parseAndValidateCidr,
  isIpAllowed,
  wouldLockOutSaver,
  getCollegeRules,
  createRule,
  deleteRule,
  setAllowlistMode,
  recordViolation,
  getViolationsSummary,
  purgeOldViolations
};

