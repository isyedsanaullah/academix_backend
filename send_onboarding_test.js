require('dotenv').config({ path: './.env' });
const ms = require('./services/mailService');

const formattedExpiry = new Date(Date.now() + 7*24*60*60*1000).toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
});

const setupUrl  = 'https://www.collegeshub.org/setup/demo-token-abc123';
const slug      = 'demo-college';
const ROOT_DOMAIN = 'collegeshub.org';
const collegeName = 'Demo College';
const tenantUrl = `https://${slug}.${ROOT_DOMAIN}`;
const adminUrl  = `${tenantUrl}/admin`;

// ── Email 1: Setup / provisioning link ──────────────────────────────
const bodyHtml1 = `
  <p style="margin:0 0 12px;color:#334155;">Dear Administrator,</p>
  <p style="margin:0 0 12px;color:#334155;">
    We are delighted to inform you that your subscription request for
    <strong style="color:#0F172A;">${collegeName}</strong> has been approved!
  </p>
  <p style="margin:0 0 12px;color:#334155;">
    Your dedicated campus subdomain is configured and ready:
    <strong style="color:#0A4D94;">${slug}.${ROOT_DOMAIN}</strong>
  </p>
  <p style="margin:0 0 20px;color:#334155;">
    Click the button below to complete your setup and begin customizing your portal:
  </p>
  <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px;">
    <tr>
      <td style="background:#FEF9EC;border:1px solid #FCD34D;border-radius:10px;padding:12px 16px;">
        <span style="font-size:15px;">⏳</span>
        <span style="color:#92400E;font-size:13px;font-weight:600;margin-left:8px;">
          This setup link expires on <strong>${formattedExpiry}</strong> (7 days from issue).
        </span>
      </td>
    </tr>
  </table>
`;

const html1 = ms.buildCollegeshubTemplate({
  title: 'Your College Workspace is Ready 🎉',
  preheader: 'Complete your CollegesHub college setup',
  bodyHtml: bodyHtml1,
  buttonText: 'Complete College Setup',
  buttonUrl: setupUrl,
  footerNote: 'Need assistance? Contact CollegesHub Support at support@collegeshub.org'
});

// ── Email 2: Go-live / welcome ───────────────────────────────────────
const bodyHtml2 = `
  <p style="margin:0 0 14px;color:#334155;font-size:15px;">
    Your college workspace on <strong style="color:#0F172A;">CollegesHub</strong> has been officially
    launched and is now <strong style="color:#289A49;">active</strong>! 🎉
  </p>
  <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px;">
    <tr>
      <td style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px 20px;">
        <p style="margin:0 0 8px;color:#14532D;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">What's now live</p>
        <ul style="margin:0;padding-left:18px;color:#166534;font-size:13px;line-height:1.7;">
          <li>Your public college portal: <a href="${tenantUrl}" style="color:#0A4D94;font-weight:700;">${tenantUrl}</a></li>
          <li>Teachers, staff, and students can now log in securely</li>
          <li>All administrative management tools are fully operational</li>
        </ul>
      </td>
    </tr>
  </table>
  <p style="margin:0;color:#64748B;font-size:13px;">
    Need help? Contact us at
    <a href="mailto:support@collegeshub.org" style="color:#0A4D94;">support@collegeshub.org</a>
  </p>
`;

const html2 = ms.buildCollegeshubTemplate({
  title: `🎉 Congratulations, ${collegeName}!`,
  preheader: `${collegeName} is now live on CollegesHub`,
  bodyHtml: bodyHtml2,
  buttonText: 'Access Admin Dashboard →',
  buttonUrl: adminUrl
});

Promise.all([
  ms.send({ to: 'syyedsanaullah@gmail.com', subject: `Welcome to CollegesHub — Set up your ${collegeName} workspace`, html: html1 }),
  ms.send({ to: 'syyedsanaullah@gmail.com', subject: `🎉 Congratulations! ${collegeName} is now live on CollegesHub`, html: html2 })
]).then(([r1, r2]) => {
  console.log('✅ Email 1 (Setup link):', r1.messageId);
  console.log('✅ Email 2 (Go-live):   ', r2.messageId);
}).catch(e => console.error('Error:', e.message));
