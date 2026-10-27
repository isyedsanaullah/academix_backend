'use strict';

const nodemailer = require('nodemailer');

/**
 * Collegeshub Mail Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider-agnostic wrapper for sending branded emails.
 * Brand colors:
 *   Blue:  #0A4D94
 *   Green: #299A49
 * ─────────────────────────────────────────────────────────────────────────────
 */

const createTransporter = () => {
  const provider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();

  if (provider === 'mock' || process.env.NODE_ENV === 'test' || !process.env.EMAIL_USER) {
    return {
      sendMail: async () => ({ messageId: `<mock-${Date.now()}@collegeshub.org>` })
    };
  }

  switch (provider) {
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
    case 'resend':
      return nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 587,
        secure: false,
        auth: { user: 'resend', pass: process.env.EMAIL_PASS || process.env.MAIL_API_KEY }
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
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });
  }
};

const getFromAddress = () => {
  const mailFrom = process.env.MAIL_FROM || process.env.EMAIL_USER || 'no-reply@collegeshub.org';
  const fromName = process.env.EMAIL_FROM_NAME || 'Collegeshub';
  return `"${fromName}" <${mailFrom}>`;
};

/**
 * Wrap content in Collegeshub branded email container.
 */
function buildCollegeshubTemplate({
  title = '',
  preheader = '',
  bodyHtml = '',
  buttonText = '',
  buttonUrl = '',
  footerNote = ''
}) {
  const currentYear = new Date().getFullYear();
  const rootDomain = process.env.ROOT_DOMAIN || 'collegeshub.org';

  const actionButton = buttonText && buttonUrl ? `
    <div style="text-align:center;margin:32px 0;">
      <a href="${buttonUrl}" target="_blank" rel="noopener noreferrer"
         style="display:inline-block;background:#0A4D94;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;box-shadow:0 4px 14px rgba(10,77,148,0.3);letter-spacing:0.3px;">
        ${buttonText}
      </a>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Collegeshub'}</title>
  ${preheader ? `<span style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>` : ''}
</head>
<body style="margin:0;padding:0;background-color:#0b111e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b111e;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <!-- Header / Brand -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <div style="width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,#0A4D94 0%,#299A49 100%);text-align:center;line-height:42px;color:#ffffff;font-size:22px;font-weight:bold;">
                      C
                    </div>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                      Collegeshub<span style="color:#299A49;">.org</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td style="background-color:#131c2e;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:36px 32px;box-shadow:0 10px 30px rgba(0,0,0,0.35);">
              ${title ? `<h1 style="color:#ffffff;font-size:20px;font-weight:700;margin:0 0 16px 0;line-height:1.4;">${title}</h1>` : ''}
              <div style="color:#cbd5e1;font-size:14px;line-height:1.65;">
                ${bodyHtml}
              </div>
              ${actionButton}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;color:#64748b;font-size:12px;line-height:1.5;">
              <p style="margin:0 0 6px 0;">
                Collegeshub — Multi-Tenant College Management & LMS Platform
              </p>
              ${footerNote ? `<p style="margin:0 0 6px 0;color:#94a3b8;">${footerNote}</p>` : ''}
              <p style="margin:0;font-size:11px;color:#475569;">
                &copy; ${currentYear} ${rootDomain}. All rights reserved.
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

/**
 * Convert HTML or template to plain text format.
 */
function toPlainText({ title, bodyText, buttonText, buttonUrl, footerNote }) {
  const parts = [];
  parts.push(`Collegeshub.org\n=========================\n`);
  if (title) parts.push(`${title}\n`);
  if (bodyText) parts.push(`${bodyText}\n`);
  if (buttonText && buttonUrl) parts.push(`${buttonText}: ${buttonUrl}\n`);
  if (footerNote) parts.push(`\nNote: ${footerNote}`);
  parts.push(`\n© ${new Date().getFullYear()} Collegeshub.org`);
  return parts.join('\n');
}

/**
 * Send email through the active provider.
 * Delivery failures do not throw by default, but return { success, error }
 * so caller can record delivery status without rolling back business transactions.
 *
 * @param {object} params
 * @param {string|string[]} params.to
 * @param {string} params.subject
 * @param {string} params.html
 * @param {string} [params.text]
 * @param {boolean} [params.throwOnError=false]
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function send({ to, subject, html, text, throwOnError = false }) {
  try {
    if (!to || !subject || (!html && !text)) {
      throw new Error('Missing required email fields (to, subject, and html or text).');
    }

    const transporter = createTransporter();
    const mailOptions = {
      from: getFromAddress(),
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html: html || undefined,
      text: text || undefined
    };

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('[MailService] Send failed:', error.message);
    if (throwOnError) {
      throw error;
    }
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  send,
  buildCollegeshubTemplate,
  toPlainText,
  createTransporter,
  getFromAddress
};
