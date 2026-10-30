'use strict';

/**
 * Academix Email Service
 * ─────────────────────────────────────────────────────────────────────
 * Provider-agnostic email delivery layer built on Nodemailer.
 *
 * Configure via environment variables:
 *   EMAIL_PROVIDER  = gmail | smtp | sendgrid | ses | mailgun | resend
 *   EMAIL_USER      = sender address / API key username
 *   EMAIL_PASS      = app password / API key / secret
 *   EMAIL_HOST      = required for EMAIL_PROVIDER=smtp
 *   EMAIL_PORT      = required for EMAIL_PROVIDER=smtp (default 587)
 *   EMAIL_FROM_NAME = display name (default "Academix")
 *
 * Adding a new provider in production:
 *   1. Set EMAIL_PROVIDER to the provider name.
 *   2. Set the corresponding credentials in .env.
 *   3. No application code changes required.
 * ─────────────────────────────────────────────────────────────────────
 */

const nodemailer = require('nodemailer');

// ── Transport Factory ──────────────────────────────────────────────────
const createTransporter = () => {
  const provider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();

  switch (provider) {
    // Generic SMTP (covers Mailgun SMTP, custom MX, etc.)
    case 'smtp':
      return nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || '587', 10),
        secure: process.env.EMAIL_SECURE === 'true',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });

    // SendGrid (via SMTP relay — no extra package needed)
    case 'sendgrid':
      return nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        secure: false,
        auth: { user: 'apikey', pass: process.env.EMAIL_PASS }
      });

    // AWS SES (SMTP relay — use SES SMTP credentials, not API keys)
    case 'ses':
      return nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'email-smtp.us-east-1.amazonaws.com',
        port: 587,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });

    // Mailgun (via SMTP relay)
    case 'mailgun':
      return nodemailer.createTransport({
        host: 'smtp.mailgun.org',
        port: 587,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });

    // Resend (via SMTP relay)
    case 'resend':
      return nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 587,
        secure: false,
        auth: { user: 'resend', pass: process.env.EMAIL_PASS }
      });

    // Gmail (default — requires an App Password, not the account password)
    case 'gmail':
    default:
      return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // Use STARTTLS on port 587
        family: 4,     // Force IPv4 to prevent ENETUNREACH errors on cloud hosts like Render
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        },
        tls: {
          rejectUnauthorized: false
        },
        connectionTimeout: 20000,
        greetingTimeout: 20000,
        socketTimeout: 20000
      });
  }
};

// ── Shared sender address ──────────────────────────────────────────────
const fromAddress = () => {
  const name = process.env.EMAIL_FROM_NAME || 'Academix';
  return `"${name}" <${process.env.EMAIL_USER}>`;
};

// ── Helpers ────────────────────────────────────────────────────────────
const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// ── Plan styling map ───────────────────────────────────────────────────
const PLAN_STYLES = {
  basic:      { label: 'Basic',      color: '#64748b', bg: '#1e293b' },
  standard:   { label: 'Standard',   color: '#6366f1', bg: '#1e1b4b' },
  premium:    { label: 'Premium',    color: '#f59e0b', bg: '#1c1408' },
  enterprise: { label: 'Enterprise', color: '#10b981', bg: '#052e1e' },
};

// ── Email Templates ────────────────────────────────────────────────────

/** Shared HTML wrapper */
const wrapHtml = (body) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Academix</title>
</head>
<body style="margin:0;padding:0;background:#04070d;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#04070d;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <!-- Logo Header -->
        <tr>
          <td align="center" style="padding-bottom:32px;">
            <div style="display:inline-flex;align-items:center;gap:10px;">
              <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:inline-block;text-align:center;line-height:40px;font-size:20px;">🎓</div>
              <div style="display:inline-block;vertical-align:middle;margin-left:10px;">
                <div style="color:#fff;font-size:20px;font-weight:800;line-height:1;">Academix</div>
                <div style="color:#475569;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Education Management</div>
              </div>
            </div>
          </td>
        </tr>
        <!-- Card -->
        <tr>
          <td style="background:#0d1117;border-radius:20px;border:1px solid rgba(255,255,255,0.07);padding:40px 36px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td align="center" style="padding-top:24px;">
            <p style="color:#1e293b;font-size:11px;margin:0;">
              © ${new Date().getFullYear()} Academix — Enterprise College Management System
            </p>
            <p style="color:#1e293b;font-size:10px;margin:4px 0 0;">
              If you didn't expect this email, you can safely ignore it.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ── Invitation Email ───────────────────────────────────────────────────
const buildInvitationHtml = ({ inviteUrl, planId, expiresAt }) => {
  const plan = PLAN_STYLES[planId?.toLowerCase()] || PLAN_STYLES.basic;
  const expiryStr = expiresAt
    ? new Date(expiresAt).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
      })
    : '48 hours from now';

  return wrapHtml(`
    <h1 style="color:#f1f5f9;font-size:22px;font-weight:800;margin:0 0 8px;">
      You're invited to join Academix 🎉
    </h1>
    <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 28px;">
      Your institution has been invited to the <strong style="color:#94a3b8;">Academix</strong> education management platform.
      Click the button below to accept your invitation and set up your college workspace.
    </p>

    <!-- Plan Badge -->
    <div style="margin-bottom:28px;">
      <span style="display:inline-block;padding:6px 16px;border-radius:99px;background:${plan.bg};color:${plan.color};font-size:12px;font-weight:700;border:1px solid ${plan.color}33;letter-spacing:0.5px;">
        ${plan.label} Plan
      </span>
    </div>

    <!-- Expiry Notice -->
    <div style="background:#0f1923;border:1px solid rgba(245,158,11,0.15);border-radius:12px;padding:14px 18px;margin-bottom:32px;display:flex;align-items:center;gap:10px;">
      <span style="font-size:18px;">⏰</span>
      <div>
        <div style="color:#fbbf24;font-size:12px;font-weight:700;margin-bottom:2px;">Invitation Expires</div>
        <div style="color:#64748b;font-size:12px;">${expiryStr}</div>
      </div>
    </div>

    <!-- CTA Button -->
    <div style="text-align:center;margin-bottom:32px;">
      <a href="${inviteUrl}"
         style="display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;border-radius:14px;font-size:15px;font-weight:800;letter-spacing:0.3px;box-shadow:0 8px 24px rgba(99,102,241,0.35);">
        Accept Invitation &amp; Get Started →
      </a>
    </div>

    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:0 0 24px;" />

    <!-- Fallback URL -->
    <p style="color:#475569;font-size:12px;line-height:1.6;margin:0;">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin:8px 0 0;">
      <a href="${inviteUrl}" style="color:#6366f1;font-size:12px;word-break:break-all;">${inviteUrl}</a>
    </p>

    <div style="margin-top:24px;padding:12px 16px;background:#080c12;border-radius:10px;border:1px solid rgba(255,255,255,0.04);">
      <p style="color:#334155;font-size:11px;margin:0;line-height:1.5;">
        🔒 This invitation link is single-use and will expire after it is accepted or after the time shown above.
        Never share this link with anyone other than your institution's designated administrator.
      </p>
    </div>
  `);
};

// ── Verification Email ─────────────────────────────────────────────────
const buildVerificationHtml = ({ name, code }) => wrapHtml(`
  <h1 style="color:#f1f5f9;font-size:20px;font-weight:800;margin:0 0 6px;">
    Hello ${name} 👋
  </h1>
  <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 28px;">
    Use the code below to verify your email address.
  </p>
  <div style="text-align:center;margin:0 0 28px;">
    <div style="display:inline-block;padding:18px 40px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:14px;font-size:36px;font-weight:900;letter-spacing:10px;color:#fff;">
      ${code}
    </div>
  </div>
  <p style="color:#475569;font-size:12px;text-align:center;margin:0;">
    This code expires in <strong style="color:#94a3b8;">10 minutes</strong>. Do not share it.
  </p>
`);

// ── Password Reset Email ───────────────────────────────────────────────
const buildPasswordResetHtml = ({ name, code }) => wrapHtml(`
  <h1 style="color:#f1f5f9;font-size:20px;font-weight:800;margin:0 0 6px;">
    Password Reset 🔐
  </h1>
  <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 28px;">
    Hello ${name}, use the code below to reset your Academix password.
  </p>
  <div style="text-align:center;margin:0 0 28px;">
    <div style="display:inline-block;padding:18px 40px;background:linear-gradient(135deg,#ef4444,#f87171);border-radius:14px;font-size:36px;font-weight:900;letter-spacing:10px;color:#fff;">
      ${code}
    </div>
  </div>
  <p style="color:#475569;font-size:12px;text-align:center;margin:0;">
    This code expires in <strong style="color:#94a3b8;">10 minutes</strong>.
    If you didn't request this, please secure your account immediately.
  </p>
`);

// ── Send Helpers ───────────────────────────────────────────────────────

/**
 * Send a college invitation email.
 * Throws a sanitized Error if delivery fails (caller should catch and return 500).
 */
const sendInvitationEmail = async (to, { inviteUrl, planId, expiresAt }) => {
  const transporter = createTransporter();
  const html = buildInvitationHtml({ inviteUrl, planId, expiresAt });

  try {
    await transporter.sendMail({
      from: fromAddress(),
      to,
      subject: '🎓 You\'re invited to join Academix — Accept your invitation',
      html,
      text: [
        'You have been invited to join Academix Education Management Platform.',
        `Plan: ${planId || 'Basic'}`,
        `Accept your invitation here: ${inviteUrl}`,
        `This link expires: ${expiresAt ? new Date(expiresAt).toUTCString() : 'in 48 hours'}`,
        '',
        'If you did not expect this email, you can safely ignore it.',
      ].join('\n'),
    });
  } catch (smtpError) {
    // Log full SMTP details server-side for diagnostics
    console.error('[EmailService] SMTP delivery failed:', {
      provider: process.env.EMAIL_PROVIDER || 'gmail',
      to,
      code: smtpError.code,
      command: smtpError.command,
      message: smtpError.message,
    });
    // Re-throw a sanitized message — never expose SMTP internals to clients
    throw new Error('Failed to deliver the invitation email. Please check server email configuration.');
  }
};

/**
 * Send a verification code email.
 */
const sendVerificationEmail = async (to, code, name = 'User') => {
  const transporter = createTransporter();
  try {
    await transporter.sendMail({
      from: fromAddress(),
      to,
      subject: `${code} — Your Academix Verification Code`,
      html: buildVerificationHtml({ name, code }),
    });
  } catch (smtpError) {
    console.error('[EmailService] Verification email failed:', smtpError.message);
    throw new Error('Failed to send verification email.');
  }
};

/**
 * Send a password reset code email.
 */
const sendPasswordResetEmail = async (to, code, name = 'User') => {
  const transporter = createTransporter();
  try {
    await transporter.sendMail({
      from: fromAddress(),
      to,
      subject: `${code} — Academix Password Reset`,
      html: buildPasswordResetHtml({ name, code }),
    });
  } catch (smtpError) {
    console.error('[EmailService] Password reset email failed:', smtpError.message);
    throw new Error('Failed to send password reset email.');
  }
};

/**
 * Send a subscription request notification email to syyedsanaullah@gmail.com.
 */
const sendSubscriptionRequestEmail = async (to, { collegeName, adminEmail, phone, selectedPlan, studentCount, message, timestamp }) => {
  const transporter = createTransporter();
  
  const planColors = {
    free: { label: 'Free Trial', color: '#10b981', bg: '#052e1e' },
    standard: { label: 'Standard Plan', color: '#6366f1', bg: '#1e1b4b' },
    premium: { label: 'Premium AI Plan', color: '#fbbf24', bg: '#1c1408' }
  };
  
  const plan = planColors[selectedPlan?.toLowerCase()] || planColors.free;
  
  const emailHtml = wrapHtml(`
    <h1 style="color:#f1f5f9;font-size:22px;font-weight:800;margin:0 0 8px;">
      New Subscription Request 📬
    </h1>
    <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px;">
      A college has submitted a subscription request on the Academix platform. Details are below:
    </p>

    <!-- Details Card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#080c12;border-radius:12px;border:1px solid rgba(255,255,255,0.04);padding:20px;margin-bottom:24px;">
      <tr>
        <td style="padding-bottom:10px;color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">College Name</td>
      </tr>
      <tr>
        <td style="color:#f1f5f9;font-size:15px;font-weight:700;padding-bottom:18px;">${collegeName}</td>
      </tr>
      <tr>
        <td style="padding-bottom:10px;color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Administrator Contact</td>
      </tr>
      <tr>
        <td style="color:#94a3b8;font-size:13px;padding-bottom:18px;">
          Email: <a href="mailto:${adminEmail}" style="color:#6366f1;text-decoration:none;">${adminEmail}</a><br/>
          Phone: <a href="tel:${phone}" style="color:#6366f1;text-decoration:none;">${phone}</a>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:10px;color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Plan & Scale</td>
      </tr>
      <tr>
        <td style="padding-bottom:18px;">
          <span style="display:inline-block;padding:4px 12px;border-radius:99px;background:${plan.bg};color:${plan.color};font-size:11px;font-weight:700;border:1px solid ${plan.color}33;margin-bottom:6px;">
            ${plan.label}
          </span>
          <div style="color:#94a3b8;font-size:13px;margin-top:4px;">Students Limit: <strong>${studentCount}</strong></div>
        </td>
      </tr>
      ${message ? `
      <tr>
        <td style="padding-bottom:10px;color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Message / Requirements</td>
      </tr>
      <tr>
        <td style="color:#f1f5f9;font-size:13px;line-height:1.6;white-space:pre-wrap;">${message}</td>
      </tr>
      ` : ''}
    </table>

    <div style="color:#475569;font-size:11px;">
      Submitted Date: ${new Date(timestamp).toLocaleString('en-US', { timeZone: 'Asia/Karachi' })} (PKT)
    </div>
  `);

  try {
    await transporter.sendMail({
      from: fromAddress(),
      to,
      subject: `📬 Subscription Request: ${collegeName} (${selectedPlan?.toUpperCase()})`,
      html: emailHtml,
      text: `
Subscription Request Details:
College Name: ${collegeName}
Admin Email: ${adminEmail}
Phone: ${phone}
Plan Selected: ${selectedPlan}
Students Count: ${studentCount}
Message: ${message || 'None'}
Timestamp: ${timestamp}
      `,
    });
  } catch (smtpError) {
    console.error('[EmailService] Subscription request email failed:', smtpError.message);
    throw new Error('Failed to send subscription request notification email.');
  }
};

/**
 * Send a contact form message email to syyedsanaullah@gmail.com.
 */
const sendContactDeveloperEmail = async (to, { name, email, phone, subject, message }) => {
  const transporter = createTransporter();

  const emailHtml = wrapHtml(`
    <h1 style="color:#f1f5f9;font-size:22px;font-weight:800;margin:0 0 8px;">
      New Contact Message 📨
    </h1>
    <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px;">
      A visitor has sent a message via the Academix contact form:
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#080c12;border-radius:12px;border:1px solid rgba(255,255,255,0.04);padding:20px;margin-bottom:24px;">
      <tr>
        <td style="padding-bottom:10px;color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Sender Details</td>
      </tr>
      <tr>
        <td style="color:#f1f5f9;font-size:14px;font-weight:700;padding-bottom:18px;">
          ${name}<br/>
          <span style="color:#94a3b8;font-size:12px;font-weight:normal;">
            Email: <a href="mailto:${email}" style="color:#6366f1;text-decoration:none;">${email}</a><br/>
            ${phone ? `Phone: <a href="tel:${phone}" style="color:#6366f1;text-decoration:none;">${phone}</a>` : ''}
          </span>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:10px;color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Subject</td>
      </tr>
      <tr>
        <td style="color:#f1f5f9;font-size:14px;font-weight:700;padding-bottom:18px;">${subject}</td>
      </tr>
      <tr>
        <td style="padding-bottom:10px;color:#475569;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Message</td>
      </tr>
      <tr>
        <td style="color:#f1f5f9;font-size:13px;line-height:1.6;white-space:pre-wrap;">${message}</td>
      </tr>
    </table>
  `);

  try {
    await transporter.sendMail({
      from: fromAddress(),
      to,
      subject: `📨 Contact Form: ${subject} (from ${name})`,
      html: emailHtml,
      text: `
Contact Form Message:
Name: ${name}
Email: ${email}
Phone: ${phone || 'None'}
Subject: ${subject}
Message: ${message}
      `,
    });
  } catch (smtpError) {
    console.error('[EmailService] Contact form email failed:', smtpError.message);
    throw new Error('Failed to send contact notification email.');
  }
};

module.exports = {
  generateCode,
  sendInvitationEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSubscriptionRequestEmail,
  sendContactDeveloperEmail,
};

