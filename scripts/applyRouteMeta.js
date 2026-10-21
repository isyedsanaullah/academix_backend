const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '..', 'routes');

const metaMap = {
  // Gated routes
  'aiChat.routes.js': { feature: 'ai-chat' },
  'aiGenerator.routes.js': { feature: 'ai-generators' },
  'announcement.routes.js': { feature: 'announcements' },
  'attendance.routes.js': { feature: 'attendance' },
  'canteen.routes.js': { feature: 'canteen' },
  'certificate.routes.js': { feature: 'certificates' },
  'employee.routes.js': { feature: 'employees' },
  'exam.routes.js': { feature: 'exams-results' },
  'fallback.routes.js': { feature: ['students', 'announcements'] },
  'fine.routes.js': { feature: 'fines' },
  'guard.routes.js': { feature: ['gate-scanner', 'gate-manual-log', 'early-exit'] },
  'pdf.routes.js': { feature: 'ai-pdf-chat' },
  'report.routes.js': { feature: 'analytics-reports' },
  'result.routes.js': { feature: 'exams-results' },
  'timetable.routes.js': { feature: 'timetable' },
  'visitor.routes.js': { feature: 'visitors' },

  // Exempt routes
  'accountant.routes.js': { exempt: 'core', reason: 'Accountant portal operations and dashboard' },
  'activityLog.routes.js': { exempt: 'core', reason: 'Audit and activity logs for tenant administration' },
  'approval.routes.js': { exempt: 'core', reason: 'Administrative approval workflows' },
  'auditLog.routes.js': { exempt: 'core', reason: 'Security and administrative audit trail' },
  'auth.routes.js': { exempt: 'auth', reason: 'Authentication and session handling for all users' },
  'class.routes.js': { exempt: 'core', reason: 'Core academic structure: classes' },
  'college.routes.js': { exempt: 'core', reason: 'College administration and configuration' },
  'files.routes.js': { exempt: 'core', reason: 'System file upload and retrieval infrastructure' },
  'group.routes.js': { exempt: 'core', reason: 'Core academic grouping' },
  'health.routes.js': { exempt: 'system', reason: 'System health check and monitoring endpoints' },
  'me.routes.js': { exempt: 'core', reason: 'Current authenticated user profile and capability resolution' },
  'notification.routes.js': { exempt: 'core', reason: 'User notification inbox and dispatch' },
  'onboarding.routes.js': { exempt: 'core', reason: 'Initial college onboarding setup' },
  'profile.routes.js': { exempt: 'core', reason: 'Personal profile settings and password change' },
  'registrar.routes.js': { exempt: 'core', reason: 'Registrar student records management' },
  'section.routes.js': { exempt: 'core', reason: 'Core academic structure: sections' },
  'session.routes.js': { exempt: 'core', reason: 'Core academic structure: academic sessions' },
  'student.routes.js': { exempt: 'core', reason: 'Core SIS entity: student records management' },
  'subject.routes.js': { exempt: 'core', reason: 'Core academic curriculum: subjects' },
  'superAdmin.routes.js': { exempt: 'platform', reason: 'Platform super-admin multi-tenant control plane' },
  'teacher.routes.js': { exempt: 'core', reason: 'Core SIS entity: teacher management' },
  'trash.routes.js': { exempt: 'core', reason: 'Administrative recycle bin and data recovery' },
  'user.routes.js': { exempt: 'core', reason: 'Core identity and user management' }
};

let modifiedCount = 0;

for (const [file, meta] of Object.entries(metaMap)) {
  const filePath = path.join(routesDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('router.meta')) {
    console.log(`Skipping ${file}: already has router.meta`);
    continue;
  }

  const metaString = `\nrouter.meta = ${JSON.stringify(meta, null, 2)};\n\nmodule.exports = router;`;
  if (!content.includes('module.exports = router;')) {
    console.error(`Could not find module.exports = router; in ${file}`);
    continue;
  }

  content = content.replace(/module\.exports\s*=\s*router;\s*$/, metaString);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${file}`);
  modifiedCount++;
}

console.log(`Successfully updated ${modifiedCount} files.`);
