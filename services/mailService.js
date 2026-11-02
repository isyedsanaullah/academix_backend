'use strict';

const nodemailer = require('nodemailer');

/**
 * Collegeshub Mail Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source-of-truth for all outbound emails.
 * Provider: Resend (or gmail/smtp fallback via env).
 *
 * Brand:
 *   Blue  #0A4D94
 *   Green #299A49
 *   Light background  #F8FAFC
 *   Card background   #FFFFFF
 *   Body text         #1E293B
 *   Muted text        #64748B
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Transport ────────────────────────────────────────────────────────────────

const createTransporter = () => {
  const provider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();

  if (
    provider === 'mock' ||
    process.env.NODE_ENV === 'test' ||
    (!process.env.EMAIL_USER && !process.env.RESEND_API_KEY && !process.env.EMAIL_PASS)
  ) {
    return {
      sendMail: async () => ({ messageId: `<mock-${Date.now()}@collegeshub.org>` })
    };
  }

  switch (provider) {
    case 'resend': {
      const { Resend } = require('resend');
      const apiKey = process.env.RESEND_API_KEY || process.env.EMAIL_PASS;
      const resend = new Resend(apiKey);
      return {
        sendMail: async (opts) => {
          const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
          const res = await resend.emails.send({
            from: opts.from || getFromAddress(),
            to: toList,
            subject: opts.subject,
            html: opts.html || undefined,
            text: opts.text || undefined
          });
          if (res.error) {
            console.error('[MailService] Resend error:', res.error);
            throw new Error(res.error.message || 'Resend delivery failed');
          }
          return { messageId: res.data?.id };
        }
      };
    }
    case 'smtp':
      return nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || '587', 10),
        secure: process.env.EMAIL_SECURE === 'true',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });
    case 'sendgrid':
      return nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        secure: false,
        auth: { user: 'apikey', pass: process.env.EMAIL_PASS || process.env.MAIL_API_KEY }
      });
    case 'ses':
      return nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'email-smtp.us-east-1.amazonaws.com',
        port: 587,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });
    case 'gmail':
    default:
      return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        pool: true,
        maxConnections: 3,
        family: 4,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 15000
      });
  }
};

const getFromAddress = () => {
  const email =
    process.env.EMAIL_FROM ||
    process.env.MAIL_FROM ||
    (process.env.EMAIL_USER?.includes('@') ? process.env.EMAIL_USER : 'noreply@collegeshub.org');
  const name = process.env.EMAIL_FROM_NAME || 'Collegeshub';
  return `"${name}" <${email}>`;
};

// ── Shared sender ────────────────────────────────────────────────────────────

/**
 * Low-level send. Returns { success, messageId?, error? }
 * Set throwOnError=true when the caller must know about failures.
 */
async function send({ to, subject, html, text, throwOnError = false }) {
  try {
    if (!to || !subject || (!html && !text)) {
      throw new Error('Missing required email fields (to, subject, html or text).');
    }
    const transporter = createTransporter();
    const info = await transporter.sendMail({
      from: getFromAddress(),
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html: html || undefined,
      text: text || undefined
    });
    console.log(`[MailService] ✉ Sent "${subject}" → ${to} (id: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[MailService] Send failed:', err.message);
    if (throwOnError) throw err;
    return { success: false, error: err.message };
  }
}

// ── Brand constants ───────────────────────────────────────────────────────────

const BLUE  = '#0A4D94';
const GREEN = '#299A49';
const YEAR  = new Date().getFullYear();

// ── Master light-theme template ───────────────────────────────────────────────

/**
 * Wraps any body HTML in the CollegesHub branded light email shell.
 *
 * @param {{ title, preheader, bodyHtml, buttonText, buttonUrl, footerNote }} opts
 */
function buildCollegeshubTemplate({
  title     = '',
  preheader = '',
  bodyHtml  = '',
  buttonText = '',
  buttonUrl  = '',
  footerNote = ''
}) {
  const actionButton = buttonText && buttonUrl ? `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:32px 0;">
      <tr>
        <td align="center">
          <a href="${buttonUrl}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block;background:linear-gradient(135deg,${BLUE} 0%,#1565C0 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:15px 36px;border-radius:10px;box-shadow:0 4px 16px rgba(10,77,148,0.28);letter-spacing:0.3px;">
            ${buttonText}
          </a>
        </td>
      </tr>
    </table>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Collegeshub'}</title>
  ${preheader ? `<span style="display:none;font-size:1px;color:#F8FAFC;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>` : ''}
</head>
<body style="margin:0;padding:0;background-color:#EEF2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1E293B;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#EEF2F7;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

          <!-- ══ HEADER / LOGO ══ -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <!--[if !mso]><!-->
              <a href="https://www.collegeshub.org" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-block;">
                <img
                  src="https://www.collegeshub.org/logo-horizontal.svg"
                  alt="CollegesHub"
                  width="220"
                  height="52"
                  style="display:block;border:0;max-width:220px;height:auto;"
                />
              </a>
              <!--<![endif]-->
              <!--[if mso]>
              <a href="https://www.collegeshub.org" style="text-decoration:none;">
                <span style="font-family:Arial,sans-serif;font-size:26px;font-weight:900;color:#0A4D94;letter-spacing:-0.5px;">Colleges</span><span style="font-family:Arial,sans-serif;font-size:26px;font-weight:900;color:#289A49;letter-spacing:-0.5px;">Hub</span>
              </a>
              <![endif]-->
            </td>
          </tr>

          <!-- ══ MAIN CARD ══ -->
          <tr>
            <td style="background:#FFFFFF;border-radius:16px;border:1px solid #E2E8F0;padding:40px 36px;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
              ${title ? `<h1 style="color:#0F172A;font-size:22px;font-weight:800;margin:0 0 12px 0;line-height:1.35;">${title}</h1>` : ''}
              <div style="color:#334155;font-size:15px;line-height:1.7;">
                ${bodyHtml}
              </div>
              ${actionButton}
            </td>
          </tr>

          <!-- ══ FOOTER ══ -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <!-- Social / links row -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="padding:0 8px;">
                    <a href="https://www.collegeshub.org" style="color:${BLUE};font-size:12px;font-weight:600;text-decoration:none;">Website</a>
                  </td>
                  <td style="color:#CBD5E1;font-size:12px;">|</td>
                  <td style="padding:0 8px;">
                    <a href="mailto:support@collegeshub.org" style="color:${BLUE};font-size:12px;font-weight:600;text-decoration:none;">Support</a>
                  </td>
                  <td style="color:#CBD5E1;font-size:12px;">|</td>
                  <td style="padding:0 8px;">
                    <a href="https://www.collegeshub.org/privacy-policy" style="color:${BLUE};font-size:12px;font-weight:600;text-decoration:none;">Privacy</a>
                  </td>
                </tr>
              </table>
              ${footerNote ? `<p style="margin:0 0 8px 0;color:#64748B;font-size:12px;">${footerNote}</p>` : ''}
              <p style="margin:0;color:#94A3B8;font-size:11px;line-height:1.6;">
                © ${YEAR} CollegesHub · collegeshub.org · All rights reserved.<br>
                You received this email because of your CollegesHub account activity.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Plain-text fallback ───────────────────────────────────────────────────────

function toPlainText({ title, bodyText, buttonText, buttonUrl, footerNote }) {
  const parts = [`CollegesHub — collegeshub.org\n${'='.repeat(40)}\n`];
  if (title)      parts.push(`${title}\n`);
  if (bodyText)   parts.push(`${bodyText}\n`);
  if (buttonText && buttonUrl) parts.push(`${buttonText}:\n${buttonUrl}\n`);
  if (footerNote) parts.push(`\nNote: ${footerNote}`);
  parts.push(`\n© ${YEAR} CollegesHub. All rights reserved.`);
  return parts.join('\n');
}

// ── OTP code block helper ─────────────────────────────────────────────────────

function otpBlock(code, color = BLUE) {
  return `
  <div style="text-align:center;margin:28px 0;">
    <div style="display:inline-block;padding:20px 48px;background:linear-gradient(135deg,${color} 0%,${color === BLUE ? '#1565C0' : '#1B7A35'} 100%);border-radius:14px;font-size:40px;font-weight:900;letter-spacing:12px;color:#ffffff;font-variant-numeric:tabular-nums;">
      ${code}
    </div>
    <p style="margin:12px 0 0;color:#64748B;font-size:12px;">
      This code expires in <strong style="color:#0F172A;">10 minutes</strong>. Do not share it with anyone.
    </p>
  </div>`;
}

// ── High-level send helpers ───────────────────────────────────────────────────

/**
 * Send a college/super-admin invitation email.
 * @param {string} to
 * @param {{ inviteUrl: string, planId?: string, expiresAt?: Date|string, collegeName?: string }} opts
 */
async function sendInvitationEmail(to, { inviteUrl, planId, expiresAt, collegeName } = {}) {
  const planColors = {
    basic:      { label: 'Basic',      color: '#64748B', bg: '#F1F5F9' },
    standard:   { label: 'Standard',   color: BLUE,      bg: '#EFF6FF' },
    premium:    { label: 'Premium',    color: '#D97706', bg: '#FFFBEB' },
    enterprise: { label: 'Enterprise', color: GREEN,     bg: '#F0FDF4' }
  };
  const plan = planColors[(planId || '').toLowerCase()] || planColors.basic;

  const expiryStr = expiresAt
    ? new Date(expiresAt).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
      })
    : '48 hours from now';

  const bodyHtml = `
    <p style="margin:0 0 20px;">
      ${collegeName ? `<strong>${collegeName}</strong> has been` : 'Your institution has been'}
      invited to the <strong>CollegesHub</strong> smart college management platform.
      Click the button below to accept your invitation and set up your workspace.
    </p>

    <!-- Plan badge -->
    <div style="margin-bottom:20px;">
      <span style="display:inline-block;padding:5px 16px;border-radius:99px;background:${plan.bg};color:${plan.color};font-size:12px;font-weight:700;border:1px solid ${plan.color}40;">
        ${plan.label} Plan
      </span>
    </div>

    <!-- Expiry notice -->
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:8px;">
      <tr>
        <td style="background:#FEF9EC;border:1px solid #FCD34D;border-radius:10px;padding:12px 16px;">
          <span style="font-size:16px;">⏰</span>
          <span style="color:#92400E;font-size:13px;font-weight:600;margin-left:8px;">
            Invitation expires: ${expiryStr}
          </span>
        </td>
      </tr>
    </table>

    <!-- Fallback URL -->
    <p style="margin:24px 0 0;color:#64748B;font-size:13px;">
      If the button doesn't work, copy and paste this link:<br>
      <a href="${inviteUrl}" style="color:${BLUE};word-break:break-all;">${inviteUrl}</a>
    </p>

    <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:20px;">
      <tr>
        <td style="background:#F8FAFC;border-radius:8px;padding:12px 14px;border:1px solid #E2E8F0;">
          <p style="margin:0;color:#64748B;font-size:11px;line-height:1.6;">
            🔒 This invitation link is single-use and expires after acceptance.
            Never share this link with anyone other than your designated administrator.
          </p>
        </td>
      </tr>
    </table>`;

  const html = buildCollegeshubTemplate({
    title: "You're invited to join CollegesHub 🎉",
    preheader: 'Accept your CollegesHub platform invitation',
    bodyHtml,
    buttonText: 'Accept Invitation & Get Started →',
    buttonUrl: inviteUrl
  });

  return send({
    to,
    subject: "🎓 You're invited to CollegesHub — Accept your invitation",
    html,
    text: toPlainText({
      title: "You're invited to CollegesHub",
      bodyText: `Accept your invitation here: ${inviteUrl}\nExpires: ${expiryStr}`,
      buttonText: 'Accept Invitation',
      buttonUrl: inviteUrl,
      footerNote: 'This link is single-use. Do not share it.'
    }),
    throwOnError: true
  });
}

/**
 * Send an email verification OTP.
 * @param {string} to
 * @param {string} code  6-digit OTP
 * @param {string} name  Recipient's first name
 */
async function sendVerificationEmail(to, code, name = 'there') {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#64748B;font-size:14px;">Hello <strong style="color:#0F172A;">${name}</strong>,</p>
    <p style="margin:0 0 6px;">Use the verification code below to confirm your email address on CollegesHub.</p>
    ${otpBlock(code, BLUE)}`;

  const html = buildCollegeshubTemplate({
    title: '✉ Verify your email address',
    preheader: `${code} is your CollegesHub verification code`,
    bodyHtml
  });

  return send({
    to,
    subject: `${code} — Your CollegesHub Email Verification Code`,
    html,
    text: `Hello ${name},\n\nYour CollegesHub verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it.\n\n© ${YEAR} CollegesHub`
  });
}

/**
 * Send a password reset OTP.
 * @param {string} to
 * @param {string} code  6-digit OTP
 * @param {string} name  Recipient's first name
 */
async function sendPasswordResetEmail(to, code, name = 'there') {
  const bodyHtml = `
    <p style="margin:0 0 4px;color:#64748B;font-size:14px;">Hello <strong style="color:#0F172A;">${name}</strong>,</p>
    <p style="margin:0 0 6px;">
      We received a request to reset your CollegesHub password.
      Use the code below to complete the process.
    </p>
    ${otpBlock(code, '#DC2626')}
    <p style="margin:20px 0 0;color:#64748B;font-size:13px;">
      If you didn't request this reset, you can safely ignore this email.
      Your password will not change until you enter this code.
    </p>`;

  const html = buildCollegeshubTemplate({
    title: '🔐 Password Reset Request',
    preheader: `${code} is your CollegesHub password reset code`,
    bodyHtml
  });

  return send({
    to,
    subject: `${code} — CollegesHub Password Reset`,
    html,
    text: `Hello ${name},\n\nYour CollegesHub password reset code is: ${code}\n\nExpires in 10 minutes. If you didn't request this, ignore this email.\n\n© ${YEAR} CollegesHub`
  });
}

/**
 * Notify admin about a new subscription request.
 */
async function sendSubscriptionRequestEmail(to, {
  collegeName, adminEmail, phone, selectedPlan, studentCount, message, timestamp
} = {}) {
  const planColors = {
    free:     { label: 'Free Trial',     color: GREEN,     bg: '#F0FDF4' },
    standard: { label: 'Standard Plan',  color: BLUE,      bg: '#EFF6FF' },
    premium:  { label: 'Premium AI Plan',color: '#D97706', bg: '#FFFBEB' }
  };
  const plan = planColors[(selectedPlan || '').toLowerCase()] || planColors.free;

  const bodyHtml = `
    <p style="margin:0 0 20px;color:#64748B;">A college has submitted a subscription request on the CollegesHub platform.</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#F8FAFC;border-radius:12px;border:1px solid #E2E8F0;padding:20px;margin-bottom:20px;">
      <tr><td style="padding-bottom:4px;color:#64748B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">College Name</td></tr>
      <tr><td style="color:#0F172A;font-size:16px;font-weight:800;padding-bottom:16px;">${collegeName}</td></tr>

      <tr><td style="padding-bottom:4px;color:#64748B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Administrator</td></tr>
      <tr><td style="padding-bottom:16px;font-size:14px;color:#1E293B;">
        Email: <a href="mailto:${adminEmail}" style="color:${BLUE};">${adminEmail}</a><br>
        Phone: <a href="tel:${phone}" style="color:${BLUE};">${phone}</a>
      </td></tr>

      <tr><td style="padding-bottom:4px;color:#64748B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Plan &amp; Scale</td></tr>
      <tr><td style="padding-bottom:${message ? '16' : '0'}px;">
        <span style="display:inline-block;padding:4px 14px;border-radius:99px;background:${plan.bg};color:${plan.color};font-size:12px;font-weight:700;border:1px solid ${plan.color}40;">${plan.label}</span>
        <span style="margin-left:12px;color:#64748B;font-size:13px;">Students: <strong>${studentCount}</strong></span>
      </td></tr>

      ${message ? `
      <tr><td style="padding-bottom:4px;color:#64748B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Message</td></tr>
      <tr><td style="color:#1E293B;font-size:13px;line-height:1.6;white-space:pre-wrap;">${message}</td></tr>` : ''}
    </table>

    <p style="margin:0;color:#64748B;font-size:12px;">
      Submitted: ${new Date(timestamp).toLocaleString('en-US', { timeZone: 'Asia/Karachi' })} (PKT)
    </p>`;

  const html = buildCollegeshubTemplate({
    title: '📬 New Subscription Request',
    preheader: `${collegeName} wants to join CollegesHub`,
    bodyHtml
  });

  return send({
    to,
    subject: `📬 Subscription Request: ${collegeName} (${(selectedPlan || '').toUpperCase()})`,
    html,
    text: `Subscription Request\nCollege: ${collegeName}\nEmail: ${adminEmail}\nPhone: ${phone}\nPlan: ${selectedPlan}\nStudents: ${studentCount}\nMessage: ${message || 'None'}\nSubmitted: ${timestamp}`
  });
}

/**
 * Send a contact form message to support.
 */
async function sendContactDeveloperEmail(to, { name, email, phone, subject, message } = {}) {
  const bodyHtml = `
    <p style="margin:0 0 20px;color:#64748B;">A visitor sent a message via the CollegesHub contact form.</p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#F8FAFC;border-radius:12px;border:1px solid #E2E8F0;padding:20px;margin-bottom:20px;">
      <tr><td style="padding-bottom:4px;color:#64748B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Sender</td></tr>
      <tr><td style="font-size:15px;font-weight:700;color:#0F172A;padding-bottom:16px;">
        ${name}<br>
        <span style="font-size:13px;font-weight:400;color:#64748B;">
          <a href="mailto:${email}" style="color:${BLUE};">${email}</a>
          ${phone ? `&nbsp;·&nbsp;<a href="tel:${phone}" style="color:${BLUE};">${phone}</a>` : ''}
        </span>
      </td></tr>

      <tr><td style="padding-bottom:4px;color:#64748B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Subject</td></tr>
      <tr><td style="font-size:15px;font-weight:700;color:#0F172A;padding-bottom:16px;">${subject}</td></tr>

      <tr><td style="padding-bottom:4px;color:#64748B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Message</td></tr>
      <tr><td style="color:#1E293B;font-size:14px;line-height:1.7;white-space:pre-wrap;">${message}</td></tr>
    </table>`;

  const html = buildCollegeshubTemplate({
    title: '📨 New Contact Message',
    preheader: `${name} sent a message: ${subject}`,
    bodyHtml
  });

  return send({
    to,
    subject: `📨 Contact Form: ${subject} (from ${name})`,
    html,
    text: `Contact Form\nName: ${name}\nEmail: ${email}\nPhone: ${phone || 'None'}\nSubject: ${subject}\nMessage: ${message}`
  });
}

// ── generateCode (used by profile.controller) ─────────────────────────────────

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Core
  send,
  buildCollegeshubTemplate,
  toPlainText,
  createTransporter,
  getFromAddress,
  generateCode,
  // Named email helpers
  sendInvitationEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSubscriptionRequestEmail,
  sendContactDeveloperEmail
};
