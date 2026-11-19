'use strict';

const VALID_VARIANTS = ['info', 'success', 'warning', 'urgent'];
const PLATFORM_AUDIENCES = ['ALL_USERS', 'ROLE_PANEL'];
const COLLEGE_AUDIENCES = ['ALL_COLLEGE_USERS', 'ADMINISTRATION_ONLY', 'TEACHERS_AND_STUDENTS'];
const VALID_PANEL_ROLES = ['superAdmin', 'admin', 'principal', 'registrar', 'accountant', 'employee', 'teacher', 'student'];

const ADMINISTRATION_ROLES = new Set(['admin', 'principal', 'registrar', 'accountant', 'employee']);
const ACADEMIC_USER_ROLES = new Set(['teacher', 'student']);

function sanitizeCtaUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 300);
  if (!trimmed) return null;
  if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function normalizeBannerPayload(body = {}, scope = 'PLATFORM') {
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 600) : '';
  if (message.length < 2) {
    const err = new Error('Banner message must be at least 2 characters.');
    err.status = 400;
    err.code = 'INVALID_BANNER_MESSAGE';
    throw err;
  }

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 140) : null;
  const variant = VALID_VARIANTS.includes(body.variant) ? body.variant : 'info';
  const ctaLabel = typeof body.ctaLabel === 'string' && body.ctaLabel.trim() ? body.ctaLabel.trim().slice(0, 60) : null;
  const ctaUrl = sanitizeCtaUrl(body.ctaUrl);
  if (body.ctaUrl && String(body.ctaUrl).trim() && !ctaUrl) {
    const err = new Error('CTA URL must start with /, http://, or https://.');
    err.status = 400;
    err.code = 'INVALID_CTA_URL';
    throw err;
  }

  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  const endsAt = body.endsAt ? new Date(body.endsAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) {
    const err = new Error('Invalid startsAt date.');
    err.status = 400;
    throw err;
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    const err = new Error('Invalid endsAt date.');
    err.status = 400;
    throw err;
  }

  let targetAudience = String(body.targetAudience || (scope === 'PLATFORM' ? 'ALL_USERS' : 'ALL_COLLEGE_USERS')).trim();
  let targetRoles = [];

  if (scope === 'PLATFORM') {
    if (!PLATFORM_AUDIENCES.includes(targetAudience)) {
      const err = new Error(`Invalid platform targetAudience. Allowed: ${PLATFORM_AUDIENCES.join(', ')}`);
      err.status = 400;
      throw err;
    }
    if (targetAudience === 'ROLE_PANEL') {
      const incomingRoles = Array.isArray(body.targetRoles) ? body.targetRoles : [];
      targetRoles = incomingRoles.map((r) => String(r).trim()).filter((r) => VALID_PANEL_ROLES.includes(r));
      if (targetRoles.length === 0) {
        const err = new Error('Select at least one target role panel.');
        err.status = 400;
        throw err;
      }
    }
  } else {
    if (!COLLEGE_AUDIENCES.includes(targetAudience)) {
      const err = new Error(`Invalid college targetAudience. Allowed: ${COLLEGE_AUDIENCES.join(', ')}`);
      err.status = 400;
      throw err;
    }
  }

  return {
    title,
    message,
    variant,
    ctaLabel,
    ctaUrl,
    targetAudience,
    targetRoles,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    startsAt,
    endsAt,
  };
}

function isBannerVisibleToUser(banner, user, now = new Date()) {
  if (!banner || !banner.isActive) return false;
  if (banner.startsAt && new Date(banner.startsAt) > now) return false;
  if (banner.endsAt && new Date(banner.endsAt) < now) return false;

  const role = String(user?.role || '').trim();
  const userCollegeId = user?.college_id || null;

  if (banner.scope === 'PLATFORM') {
    if (banner.targetAudience === 'ALL_USERS') return true;
    if (banner.targetAudience === 'ROLE_PANEL') {
      const roles = Array.isArray(banner.targetRoles) ? banner.targetRoles : [];
      return roles.includes(role);
    }
    return false;
  }

  if (banner.scope === 'COLLEGE') {
    if (!userCollegeId || banner.college_id !== userCollegeId) return false;
    if (banner.targetAudience === 'ALL_COLLEGE_USERS') return true;
    if (banner.targetAudience === 'ADMINISTRATION_ONLY') return ADMINISTRATION_ROLES.has(role);
    if (banner.targetAudience === 'TEACHERS_AND_STUDENTS') return ACADEMIC_USER_ROLES.has(role);
    return false;
  }

  return false;
}

async function getActiveBannersForUser(prisma, user, now = new Date()) {
  if (!user) return [];
  const orFilters = [{ scope: 'PLATFORM', isActive: true }];
  if (user.college_id && user.role !== 'superAdmin') {
    orFilters.push({ scope: 'COLLEGE', college_id: user.college_id, isActive: true });
  }

  const rows = await prisma.announcementBanner.findMany({
    where: { OR: orFilters },
    orderBy: [{ scope: 'asc' }, { createdAt: 'desc' }],
  });

  return rows.filter((b) => isBannerVisibleToUser(b, user, now));
}

async function listBanners(prisma, { scope, collegeId = null }) {
  const where = scope === 'PLATFORM'
    ? { scope: 'PLATFORM' }
    : { scope: 'COLLEGE', college_id: collegeId };

  return prisma.announcementBanner.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

async function createBanner(prisma, { scope, collegeId = null, body, user }) {
  const clean = normalizeBannerPayload(body, scope);
  return prisma.announcementBanner.create({
    data: {
      scope,
      college_id: scope === 'COLLEGE' ? collegeId : null,
      ...clean,
      createdBy: String(user?.id || user?._id || 'system'),
      createdByEmail: user?.email || null,
    },
  });
}

async function updateBanner(prisma, { id, scope, collegeId = null, body }) {
  const existing = await prisma.announcementBanner.findUnique({ where: { id } });
  if (!existing || existing.scope !== scope || (scope === 'COLLEGE' && existing.college_id !== collegeId)) {
    const err = new Error('Banner not found.');
    err.status = 404;
    err.code = 'BANNER_NOT_FOUND';
    throw err;
  }

  // Allow lightweight active toggle or full payload update
  const merged = {
    title: body.title !== undefined ? body.title : existing.title,
    message: body.message !== undefined ? body.message : existing.message,
    variant: body.variant !== undefined ? body.variant : existing.variant,
    ctaLabel: body.ctaLabel !== undefined ? body.ctaLabel : existing.ctaLabel,
    ctaUrl: body.ctaUrl !== undefined ? body.ctaUrl : existing.ctaUrl,
    targetAudience: body.targetAudience !== undefined ? body.targetAudience : existing.targetAudience,
    targetRoles: body.targetRoles !== undefined ? body.targetRoles : existing.targetRoles,
    isActive: body.isActive !== undefined ? body.isActive : existing.isActive,
    startsAt: body.startsAt !== undefined ? body.startsAt : existing.startsAt,
    endsAt: body.endsAt !== undefined ? body.endsAt : existing.endsAt,
  };

  const clean = normalizeBannerPayload(merged, scope);
  return prisma.announcementBanner.update({
    where: { id },
    data: clean,
  });
}

async function deleteBanner(prisma, { id, scope, collegeId = null }) {
  const existing = await prisma.announcementBanner.findUnique({ where: { id } });
  if (!existing || existing.scope !== scope || (scope === 'COLLEGE' && existing.college_id !== collegeId)) {
    const err = new Error('Banner not found.');
    err.status = 404;
    err.code = 'BANNER_NOT_FOUND';
    throw err;
  }
  await prisma.announcementBanner.delete({ where: { id } });
  return { deleted: true, id };
}

module.exports = {
  VALID_VARIANTS,
  PLATFORM_AUDIENCES,
  COLLEGE_AUDIENCES,
  VALID_PANEL_ROLES,
  getActiveBannersForUser,
  isBannerVisibleToUser,
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
};

