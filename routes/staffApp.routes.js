'use strict';

/**
 * staffApp.routes.js — Phase 9G (#N08)
 * Faculty & Staff Offline PWA Routes:
 * - Manifest & Service Worker isolated to /staff-app/ scope
 * - Read-only offline roster and timetable bundle
 * - Clear-Site-Data logout endpoint
 */

const express = require('express');
const router = express.Router();
const staffPwaService = require('../services/staffPwaService');
const { authMiddleware } = require('../middleware/auth');
const subscriptionGate = require('../middleware/subscriptionGate');

/**
 * GET /staff-app/manifest.json
 * Isolated manifest for faculty & staff
 */
router.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  return res.json({
    name: 'Academix Faculty & Staff Portal',
    short_name: 'Academix Staff',
    description: 'Faculty schedule, class rosters, and offline academic tools',
    start_url: '/staff-app/',
    scope: '/staff-app/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#2563eb',
    icons: [
      {
        src: '/icons/staff-192.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/icons/staff-512.png',
        sizes: '512x512',
        type: 'image/png'
      }
    ]
  });
});

/**
 * GET /staff-app/service-worker.js
 * Dedicated Service Worker scoped strictly to /staff-app/
 */
router.get('/service-worker.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/staff-app/');

  const swScript = `
// Academix Faculty PWA Service Worker (Scope: /staff-app/)
const CACHE_NAME = 'academix-staff-v1';
const OFFLINE_URL = '/staff-app/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([OFFLINE_URL]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests within /staff-app/
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).catch(() => caches.match(OFFLINE_URL));
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'PURGE_CACHE') {
    caches.delete(CACHE_NAME);
  }
});
`;
  return res.send(swScript);
});

/**
 * GET /api/staff-app/offline-data (or /staff-app/offline-data)
 * Fetches teacher timetable & assigned section rosters
 */
router.get('/offline-data', authMiddleware, subscriptionGate('faculty-student-pwa'), async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const bundle = await staffPwaService.getStaffOfflineBundle({
      collegeId,
      userId: req.user.id
    });
    return res.json({ success: true, data: bundle });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /api/staff-app/logout
 * Enforces purge of client offline storage via Clear-Site-Data
 */
router.post('/logout', (req, res) => {
  res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
  return res.json({
    success: true,
    message: 'Logged out successfully. Offline caches and storage purged.'
  });
});

module.exports = router;

