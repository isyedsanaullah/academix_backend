require('dotenv').config();
const fs = require('fs');
const path = require('path');

console.log('--- Generating Route Inventory (Phase 18) ---');

const routesDir = path.join(__dirname, '../routes');
const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.routes.js'));

// Route Mount prefixes mapped from server.js
const MOUNT_MAP = {
  'auth.routes.js': '/api/auth',
  'superAdmin.routes.js': '/api/super-admin',
  'onboarding.routes.js': '/api/colleges/onboarding',
  'college.routes.js': '/api/colleges',
  'session.routes.js': '/api/sessions',
  'class.routes.js': '/api/classes',
  'group.routes.js': '/api/groups',
  'section.routes.js': '/api/sections',
  'subject.routes.js': '/api/subjects',
  'batch.routes.js': '/api/batches',
  'combinedClass.routes.js': '/api/combined-classes',
  'user.routes.js': '/api/users',
  'student.routes.js': '/api/students',
  'teacher.routes.js': '/api/teachers',
  'employee.routes.js': '/api/employees',
  'attendance.routes.js': '/api/attendance',
  'fee.routes.js': '/api/fees',
  'paymentProof.routes.js': '/api/payment-proofs',
  'exam.routes.js': '/api/exams',
  'result.routes.js': '/api/results',
  'board.routes.js': '/api/board',
  'eligibility.routes.js': '/api/eligibility',
  'practical.routes.js': '/api/practicals',
  'examAnalytics.routes.js': '/api/exam-analytics',
  'admissions.routes.js': '/api/admissions',
  'lead.routes.js': '/api/leads',
  'entryTest.routes.js': '/api/entry-test',
  'guidance.routes.js': '/api/guidance',
  'assignment.routes.js': '/api/assignments',
  'quiz.routes.js': '/api/quizzes',
  'timetable.routes.js': '/api/timetables',
  'timetableGenerator.routes.js': '/api/timetable',
  'universalTimetable.routes.js': '/api/universal-timetables',
  'substitution.routes.js': '/api/substitutions',
  'announcement.routes.js': '/api/announcements',
  'notification.routes.js': '/api/notifications',
  'certificate.routes.js': '/api/certificates',
  'document.routes.js': '/api/documents',
  'auditLog.routes.js': '/api/audit-logs',
  'activityLog.routes.js': '/api/activity-logs',
  'trash.routes.js': '/api/trash',
  'visitor.routes.js': '/api/visitors',
  'canteen.routes.js': '/api/canteen',
  'report.routes.js': '/api/reports',
  'ai.routes.js': '/api/ai',
  'pdf.routes.js': '/api/ai/pdf',
  'aiChat.routes.js': '/api/ai/chat',
  'aiGenerator.routes.js': '/api/ai/generate',
  'public.routes.js': '/api/public',
  'health.routes.js': '/api/health',
  'registrar.routes.js': '/api/registrar',
  'accountant.routes.js': '/api/accountant',
  'leaveApplication.routes.js': '/api/leaves',
  'fine.routes.js': '/api/fines',
  'guard.routes.js': '/api/gate',
  'profile.routes.js': '/api/profile',
  'me.routes.js': '/api/me',
  'fallback.routes.js': '/api',
  'analytics.routes.js': '/api/analytics',
  'approval.routes.js': '/api/approvals',
  'evaluation.routes.js': '/api/evaluations',
  'files.routes.js': '/api/files'
};

const inventory = [];
const missingMeta = [];

routeFiles.forEach(file => {
  const filePath = path.join(routesDir, file);
  const router = require(filePath);

  // Verification 1: Fail if router has no meta or lacks both feature & exempt
  if (!router.meta || (!router.meta.feature && !router.meta.exempt)) {
    missingMeta.push(file);
    return;
  }

  const prefix = MOUNT_MAP[file] || `/api/${file.replace('.routes.js', '')}`;
  const fileMeta = router.meta || {};

  // Inspect router stack
  if (router.stack) {
    router.stack.forEach(layer => {
      if (layer.route) {
        // Individual route definition
        const routePath = layer.route.path;
        const fullPath = (prefix + (routePath === '/' ? '' : routePath)).replace(/\/+/g, '/');
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());

        // Extract middlewares & roles
        const middlewareNames = [];
        let routeRoles = [];
        let specificFeature = fileMeta.feature || null;

        layer.route.stack.forEach(s => {
          const fnName = s.handle.name || 'anonymous';
          middlewareNames.push(fnName);
          // Detect roles if function bound or source inspection
          const fnStr = s.handle.toString();
          if (fnStr.includes('roles') || fnStr.includes('allowedRoles')) {
            const roleMatches = fnStr.match(/['"](admin|principal|registrar|accountant|teacher|student|employee|guard|superAdmin)['"]/g);
            if (roleMatches) {
              routeRoles.push(...roleMatches.map(r => r.replace(/['"]/g, '')));
            }
          }
        });

        // Also check file source for exact authorize() parameters
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent.split('\n');
        lines.forEach(l => {
          if (l.includes(routePath) && l.includes('authorize(')) {
            const authMatch = l.match(/authorize\(([^)]+)\)/);
            if (authMatch) {
              const parsed = authMatch[1].split(',').map(r => r.trim().replace(/['"]/g, ''));
              routeRoles = [...new Set([...routeRoles, ...parsed])];
            }
          }
          if (l.includes(routePath) && l.includes('featureGate(')) {
            const gateMatch = l.match(/featureGate\(['"]([^'"]+)['"]\)/);
            if (gateMatch) specificFeature = gateMatch[1];
          }
        });

        methods.forEach(method => {
          inventory.push({
            method,
            path: fullPath,
            file,
            feature: specificFeature || (fileMeta.exempt ? null : fileMeta.feature),
            exempt: fileMeta.exempt || null,
            exemptReason: fileMeta.reason || (fileMeta.exempt ? 'Exempt core/public endpoint' : null),
            roles: routeRoles.length > 0 ? [...new Set(routeRoles)].join(', ') : 'public / authenticated',
            middlewares: middlewareNames.join(', ') || 'handler'
          });
        });
      }
    });
  }
});

if (missingMeta.length > 0) {
  console.error('❌ FAIL: The following route files lack meta.feature or meta.exempt:');
  missingMeta.forEach(m => console.error(`  - ${m}`));
  process.exit(1);
}

// Sort inventory by path and method
inventory.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

// Generate Markdown Document
let md = `# Academix Route Inventory & Security Audit\n\n`;
md += `Generated: ${new Date().toISOString()}\n\n`;
md += `## Summary Statistics\n\n`;
md += `- **Total Route Files Audited**: ${routeFiles.length}\n`;
md += `- **Total Exposed Endpoints**: ${inventory.length}\n`;
md += `- **Gated Feature Routes**: ${inventory.filter(r => r.feature).length}\n`;
md += `- **Exempt / Core Routes**: ${inventory.filter(r => r.exempt).length}\n`;
md += `- **Compliance Status**: 100% PASS (All ${routeFiles.length} route files specify meta.feature or meta.exempt)\n\n`;

md += `## Route Inventory Table\n\n`;
md += `| Method | Full Path | Feature Gate | Exempt Status | Allowed Roles | Route File |\n`;
md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

inventory.forEach(r => {
  const feat = r.feature ? `\`${r.feature}\`` : '—';
  const exempt = r.exempt ? `\`${r.exempt}\` (${r.exemptReason || 'exempt'})` : '—';
  md += `| **${r.method}** | \`${r.path}\` | ${feat} | ${exempt} | ${r.roles} | [${r.file}](file:///d:/projects/CESMS/backend/routes/${r.file}) |\n`;
});

const outPath = path.join(__dirname, '../../docs/route-inventory.md');
fs.writeFileSync(outPath, md, 'utf8');

console.log(`✓ Route inventory generated successfully: docs/route-inventory.md (${inventory.length} routes audited across ${routeFiles.length} files)`);
process.exit(0);
