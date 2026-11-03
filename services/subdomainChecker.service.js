'use strict';

/**
 * Subdomain Availability Checker Service
 * ────────────────────────────────────────
 * Checks if a college subdomain is live and reachable on Hostinger.
 * When it becomes active for the first time:
 *   1. Records subdomain_verified_at in DB
 *   2. Sends welcome email to the college admin
 *   3. (Optional) Adds Firebase authorized domain
 */

const { getSystemClient } = require('../config/prismaManager');
const mailService         = require('./mailService');
const { ROOT_DOMAIN }     = require('../config/env');

const DOMAIN = process.env.HOSTINGER_DOMAIN || ROOT_DOMAIN || 'collegeshub.org';

/**
 * Perform an HTTP HEAD check on https://{slug}.{domain}/
 * Returns true if the server responds (even with 4xx — it means DNS/hosting is up).
 * Returns false on network error (ENOTFOUND, ECONNREFUSED, timeout).
 */
async function isSubdomainReachable(slug) {
  const url = `https://${slug}.${DOMAIN}/`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    // Any HTTP response (200, 301, 404, etc.) means the server is reachable
    return res.status < 600;
  } catch {
    // Network error, DNS not found, timeout → not up yet
    return false;
  }
}

/**
 * Send the "Your college is live!" welcome email to the admin.
 */
async function sendSubdomainLiveEmail({ adminEmail, adminName, collegeName, slug }) {
  const subdomainUrl = `https://${slug}.${DOMAIN}`;
  const loginUrl     = `${subdomainUrl}/login`;

  const html = mailService.buildCollegeshubTemplate({
    title: `🎉 Your College Portal is Now Live!`,
    bodyHtml: `
      <p>Hi <strong>${adminName}</strong>,</p>
      <p>Great news! Your <strong>${collegeName}</strong> campus portal is now live and accessible at:</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${subdomainUrl}" style="font-size:18px;font-weight:700;color:#0A4D94;">${subdomainUrl}</a>
      </p>
      <p>You can now log in to your admin dashboard and continue setting up your college:</p>
      <ul>
        <li>Complete your college profile</li>
        <li>Set up academic structure (departments, programs, sections)</li>
        <li>Add students, faculty, and staff</li>
        <li>Configure timetables, fees, and more</li>
      </ul>
      <p style="margin-top:24px;">Your subdomain is active and secured with SSL. Share the link with your staff and students!</p>
    `,
    buttonText: 'Go to Admin Dashboard',
    buttonUrl: loginUrl,
  });

  await mailService.send({
    to: adminEmail,
    subject: `🎉 ${collegeName} portal is live — ${subdomainUrl}`,
    html,
    text: `Your college portal is now live at ${subdomainUrl}\n\nLog in: ${loginUrl}`,
  });
}

/**
 * Check if a specific college's subdomain is live.
 * If it just became live:
 *   - marks subdomain_verified_at in DB
 *   - sends welcome email to admin
 *
 * @param {string} collegeId
 * @returns {Promise<{active: boolean, justVerified: boolean, verifiedAt: Date|null, error?: string}>}
 */
async function checkAndVerifySubdomain(collegeId) {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: {
        id: true, name: true, slug: true,
        subdomain_verified_at: true,
        email: true,
      }
    });

    if (!college || !college.slug) {
      return { active: false, justVerified: false, verifiedAt: null, error: 'College or slug not found' };
    }

    // Already verified — just return current status
    if (college.subdomain_verified_at) {
      return {
        active: true,
        justVerified: false,
        verifiedAt: college.subdomain_verified_at,
        slug: college.slug,
      };
    }

    // Check if subdomain is reachable now
    const reachable = await isSubdomainReachable(college.slug);

    if (!reachable) {
      return { active: false, justVerified: false, verifiedAt: null, slug: college.slug };
    }

    // 🎉 Just became live! — record it
    const now = new Date();
    await prisma.college.update({
      where: { id: college.id },
      data: { subdomain_verified_at: now }
    });

    // Find admin user for the email
    let adminName  = 'Admin';
    let adminEmail = college.email; // fallback to college email
    try {
      const admin = await prisma.user.findFirst({
        where: { college_id: college.id, role: 'admin', isActive: true },
        select: { name: true, email: true },
        orderBy: { createdAt: 'asc' }
      });
      if (admin) {
        adminName  = admin.name;
        adminEmail = admin.email;
      }
    } catch {}

    // Send welcome email (non-blocking)
    sendSubdomainLiveEmail({
      adminEmail,
      adminName,
      collegeName: college.name,
      slug: college.slug,
    }).then(() => {
      console.log(`[SubdomainChecker] ✅ Welcome email sent to ${adminEmail} for ${college.slug}.${DOMAIN}`);
    }).catch(err => {
      console.error(`[SubdomainChecker] ❌ Welcome email failed:`, err.message);
    });

    console.log(`[SubdomainChecker] 🎉 Subdomain verified: ${college.slug}.${DOMAIN}`);

    return {
      active: true,
      justVerified: true,
      verifiedAt: now,
      slug: college.slug,
    };
  } catch (err) {
    console.error('[SubdomainChecker] Error:', err.message);
    return { active: false, justVerified: false, verifiedAt: null, error: err.message };
  }
}

module.exports = { checkAndVerifySubdomain, isSubdomainReachable };

