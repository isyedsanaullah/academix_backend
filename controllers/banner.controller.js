'use strict';

const { getSystemClient } = require('../config/prismaManager');
const bannerService = require('../services/bannerService');

/** GET /api/banners/active — returns active platform + tenant banners for logged-in user */
exports.getActiveBanners = async (req, res) => {
  try {
    const prisma = getSystemClient();
    const banners = await bannerService.getActiveBannersForUser(prisma, req.user);
    return res.status(200).json({ success: true, data: banners });
  } catch (err) {
    console.error('[Banners] getActiveBanners error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load active banners.' });
  }
};

// ── Super Admin Handlers (PLATFORM scope) ────────────────────────────────────
exports.listPlatformBanners = async (req, res) => {
  if (!req.user || req.user.role !== 'superAdmin') {
    return res.status(403).json({ success: false, message: 'Super Admin access required.' });
  }
  try {
    const prisma = getSystemClient();
    const data = await bannerService.listBanners(prisma, { scope: 'PLATFORM' });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.createPlatformBanner = async (req, res) => {
  if (!req.user || req.user.role !== 'superAdmin') {
    return res.status(403).json({ success: false, message: 'Super Admin access required.' });
  }
  try {
    const prisma = getSystemClient();
    const banner = await bannerService.createBanner(prisma, {
      scope: 'PLATFORM',
      body: req.body,
      user: req.user,
    });
    return res.status(201).json({ success: true, data: banner });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.updatePlatformBanner = async (req, res) => {
  if (!req.user || req.user.role !== 'superAdmin') {
    return res.status(403).json({ success: false, message: 'Super Admin access required.' });
  }
  try {
    const prisma = getSystemClient();
    const banner = await bannerService.updateBanner(prisma, {
      id: req.params.id,
      scope: 'PLATFORM',
      body: req.body,
    });
    return res.status(200).json({ success: true, data: banner });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.deletePlatformBanner = async (req, res) => {
  if (!req.user || req.user.role !== 'superAdmin') {
    return res.status(403).json({ success: false, message: 'Super Admin access required.' });
  }
  try {
    const prisma = getSystemClient();
    await bannerService.deleteBanner(prisma, { id: req.params.id, scope: 'PLATFORM' });
    return res.status(200).json({ success: true, message: 'Banner deleted.' });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ── College Admin Handlers (COLLEGE scope, strictly tenant-isolated) ─────────
exports.listCollegeBanners = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) return res.status(403).json({ success: false, message: 'No college context.' });
    const prisma = getSystemClient();
    const data = await bannerService.listBanners(prisma, { scope: 'COLLEGE', collegeId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.createCollegeBanner = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) return res.status(403).json({ success: false, message: 'No college context.' });
    const prisma = getSystemClient();
    const banner = await bannerService.createBanner(prisma, {
      scope: 'COLLEGE',
      collegeId,
      body: req.body,
      user: req.user,
    });
    return res.status(201).json({ success: true, data: banner });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.updateCollegeBanner = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) return res.status(403).json({ success: false, message: 'No college context.' });
    const prisma = getSystemClient();
    const banner = await bannerService.updateBanner(prisma, {
      id: req.params.id,
      scope: 'COLLEGE',
      collegeId,
      body: req.body,
    });
    return res.status(200).json({ success: true, data: banner });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

exports.deleteCollegeBanner = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) return res.status(403).json({ success: false, message: 'No college context.' });
    const prisma = getSystemClient();
    await bannerService.deleteBanner(prisma, { id: req.params.id, scope: 'COLLEGE', collegeId });
    return res.status(200).json({ success: true, message: 'Banner deleted.' });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

