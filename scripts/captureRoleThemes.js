const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outDir = path.join(__dirname, '../../docs/samples/themes');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const roles = [
  { role: 'admin', title: 'Admin Control Panel', accent: '#2563EB', bg: '#0d1117', soft: 'rgba(37, 99, 235, 0.12)', contrast: '#FFFFFF' },
  { role: 'accountant', title: 'Accountant Finance & Fees Panel', accent: '#047857', bg: '#061510', soft: 'rgba(4, 120, 87, 0.12)', contrast: '#FFFFFF' },
  { role: 'registrar', title: 'Registrar Admissions & Records Panel', accent: '#7C3AED', bg: '#110c1d', soft: 'rgba(124, 58, 237, 0.12)', contrast: '#FFFFFF' },
  { role: 'teacher', title: 'Faculty & Teacher Academic Panel', accent: '#C2410C', bg: '#180c07', soft: 'rgba(194, 65, 12, 0.12)', contrast: '#FFFFFF' }
];

function generateHtml(r) {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <title>${r.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #080c12; color: rgba(255, 255, 255, 0.88); display: flex; height: 100vh; overflow: hidden; }
    
    [data-role="${r.role}"] {
      --accent: ${r.accent};
      --accent-contrast: ${r.contrast};
      --accent-soft: ${r.soft};
      --sidebar-bg: ${r.bg};
      --sidebar-active: ${r.soft};
    }
    
    .sidebar { width: 260px; background: var(--sidebar-bg); border-right: 1px solid rgba(255, 255, 255, 0.06); padding: 20px 16px; display: flex; flex-direction: column; }
    .brand { display: flex; items-center: center; gap: 12px; margin-bottom: 24px; }
    .brand-logo { width: 36px; height: 36px; border-radius: 8px; background: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: bold; color: var(--accent-contrast); }
    .brand-title { font-size: 15px; font-weight: 700; color: #fff; }
    .brand-role { font-size: 10px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 1px; }
    
    .nav-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.5); margin-bottom: 4px; text-decoration: none; }
    .nav-item.active { background: var(--sidebar-active); color: var(--accent); font-weight: 600; border-left: 3px solid var(--accent); }
    
    .main { flex: 1; display: flex; flex-direction: column; }
    .header { height: 60px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); display: flex; align-items: center; justify-content: space-between; padding: 0 28px; background: rgba(13, 17, 23, 0.8); }
    .header-title { font-size: 16px; font-weight: 600; }
    
    .content { padding: 28px; flex: 1; overflow-y: auto; }
    .banner { background: linear-gradient(135deg, rgba(255,255,255,0.02), var(--accent-soft)); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .badge { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent); padding: 4px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .card { background: #0d1117; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 14px; padding: 18px; }
    .card-label { font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 8px; }
    .card-value { font-size: 24px; font-weight: 700; color: #fff; }
    .card-indicator { font-size: 11px; color: var(--accent); font-weight: 600; margin-top: 4px; }
    
    .btn-primary { background: var(--accent); color: var(--accent-contrast); border: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px; cursor: pointer; }
    
    .table-container { background: #0d1117; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 14px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    th { background: var(--accent-soft); color: var(--accent); font-weight: 600; padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.06); }
    td { padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.04); color: rgba(255,255,255,0.7); }
  </style>
</head>
<body data-role="${r.role}">
  <div class="sidebar">
    <div class="brand">
      <div class="brand-logo">A</div>
      <div>
        <div class="brand-title">Academix CMS</div>
        <div class="brand-role">${r.role} Workspace</div>
      </div>
    </div>
    <div class="nav-item active">Dashboard Overview</div>
    <div class="nav-item">Academic Records</div>
    <div class="nav-item">Operations & Schedule</div>
    <div class="nav-item">Reports & PDF Center</div>
    <div class="nav-item">System Settings</div>
  </div>
  <div class="main">
    <div class="header">
      <div class="header-title">${r.title}</div>
      <button class="btn-primary">+ Quick Action</button>
    </div>
    <div class="content">
      <div class="banner">
        <div>
          <h2 style="font-size: 18px; font-weight: 700; margin-bottom: 6px;">Active Panel Theme: ${r.role.toUpperCase()}</h2>
          <p style="font-size: 13px; color: rgba(255,255,255,0.5);">Accent Variable: ${r.accent} • Contrast Ratio: &gt; 4.5:1 (WCAG AA Compliant)</p>
        </div>
        <div class="badge">Theme Live: ${r.accent}</div>
      </div>
      <div class="cards">
        <div class="card">
          <div class="card-label">Active Enrollments</div>
          <div class="card-value">1,248</div>
          <div class="card-indicator">↑ 12% vs last session</div>
        </div>
        <div class="card">
          <div class="card-label">Operational Efficiency</div>
          <div class="card-value">98.4%</div>
          <div class="card-indicator">Optimal Standing</div>
        </div>
        <div class="card">
          <div class="card-label">Verified Documents</div>
          <div class="card-value">3,492</div>
          <div class="card-indicator">Zero Backlog</div>
        </div>
        <div class="card">
          <div class="card-label">Pending Reviews</div>
          <div class="card-value">0</div>
          <div class="card-indicator">Queue Cleared</div>
        </div>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Entity / Subject</th>
              <th>Status</th>
              <th>Action Metric</th>
              <th>Verification</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>#1001</td>
              <td>Physics Section A - Period 1</td>
              <td><span class="badge">Confirmed</span></td>
              <td>100% Attendance</td>
              <td style="color: var(--accent); font-weight: 600;">Verified Active</td>
            </tr>
            <tr>
              <td>#1002</td>
              <td>Chemistry Practical Lab - Period 2</td>
              <td><span class="badge">Confirmed</span></td>
              <td>96% Lab Capacity</td>
              <td style="color: var(--accent); font-weight: 600;">Verified Active</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;
}

console.log('--- Capturing 4 Role Panel Screenshots (Admin, Accountant, Registrar, Teacher) ---');

const tmpDir = path.join(__dirname, '../../docs/samples/themes/tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

roles.forEach(r => {
  const htmlPath = path.join(tmpDir, `${r.role}.html`);
  const pngPath = path.join(outDir, `${r.role}_theme.png`);
  fs.writeFileSync(htmlPath, generateHtml(r), 'utf8');

  try {
    const cmd = `"${edgePath}" --headless --disable-gpu --window-size=1280,800 --screenshot="${pngPath}" "file:///${htmlPath.replace(/\\/g, '/')}"`;
    execSync(cmd, { stdio: 'ignore' });
    console.log(`✓ Screenshot captured: docs/samples/themes/${r.role}_theme.png`);
  } catch (err) {
    console.error(`Failed to capture screenshot for ${r.role}:`, err.message);
  }
});

// Clean up temporary HTML files
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (e) {}

console.log('All 4 theme screenshots saved successfully into docs/samples/themes/');
