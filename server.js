// ─── Academix Server Main ──────────────────────────────
// Prisma Client refreshed for Announcement status schema
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
// Server startup trigger: updated prisma client bindings
const dotenv = require('dotenv');
const { getSystemClient } = require('./config/prismaManager');
const { recoverStuckJobs } = require('./services/queueRecoveryService');
const { initAnnouncementScheduler } = require('./services/announcementScheduler');
const { initTrashCleanupScheduler } = require('./services/trashCleanupScheduler');
const errorHandler = require('./middleware/errorHandler');

// Load env vars
dotenv.config();

// Connect to database & recover stuck jobs & start scheduler
try {
  getSystemClient();
  console.log('✅ Connected to system PostgreSQL database via Prisma.');
  recoverStuckJobs().catch(e => console.error('Startup queue recovery error:', e.message));
  initAnnouncementScheduler();
  initTrashCleanupScheduler();
} catch (err) {
  console.error('❌ Failed to connect to PostgreSQL database on startup:', err.message);
}

const app = express();

// Middleware
const rawClientUrls = (process.env.CLIENT_URL || '')
  .split(',')
  .map(u => u.trim().replace(/\/$/, ''))
  .filter(Boolean);

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  ...rawClientUrls
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const isExplicitlyAllowed = defaultAllowedOrigins.some(o => o.toLowerCase() === origin.toLowerCase());
    const isVercelDomain = /^https:\/\/[a-zA-Z0-9_-]+\.vercel\.app$/.test(origin);

    if (isExplicitlyAllowed || isVercelDomain || process.env.CORS_ALLOW_ALL === 'true') {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── Routes ───────────────────────────────────────────
// Auth & Platform
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/super-admin', require('./routes/superAdmin.routes'));

// College Core
app.use('/api/colleges/onboarding', require('./routes/onboarding.routes'));
app.use('/api/colleges', require('./routes/college.routes'));
app.use('/api/sessions', require('./routes/session.routes'));
app.use('/api/classes', require('./routes/class.routes'));
app.use('/api/groups', require('./routes/group.routes'));
app.use('/api/sections', require('./routes/section.routes'));
app.use('/api/subjects', require('./routes/subject.routes'));

// People Management
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/students', require('./routes/student.routes'));
app.use('/api/teachers', require('./routes/teacher.routes'));
app.use('/api/employees', require('./routes/employee.routes'));

// Academic Operations
app.use('/api/attendance', require('./routes/attendance.routes'));
app.use('/api/fees', require('./routes/fee.routes'));
app.use('/api/exams', require('./routes/exam.routes'));
app.use('/api/results', require('./routes/result.routes'));

// LMS
app.use('/api/assignments', require('./routes/assignment.routes'));
app.use('/api/quizzes', require('./routes/quiz.routes'));
app.use('/api/timetables', require('./routes/timetable.routes'));
app.use('/api/universal-timetables', require('./routes/universalTimetable.routes'));

// Communication & Security
app.use('/api/announcements', require('./routes/announcement.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/certificates', require('./routes/certificate.routes'));
app.use('/api/audit-logs', require('./routes/auditLog.routes'));
app.use('/api/activity-logs', require('./routes/activityLog.routes'));
app.use('/api/trash', require('./routes/trash.routes'));


// Visitor & Canteen
app.use('/api/visitors', require('./routes/visitor.routes'));
app.use('/api/canteen', require('./routes/canteen.routes'));

// AI System & Reports
app.use('/api/reports', require('./routes/report.routes'));
app.use('/api/ai', require('./routes/ai.routes'));
app.use('/api/ai/pdf', require('./routes/pdf.routes'));
app.use('/api/ai/chat', require('./routes/aiChat.routes'));
app.use('/api/ai/generate', require('./routes/aiGenerator.routes'));

// Public & Infrastructure Health
app.use('/api/public', require('./routes/public.routes'));
app.use('/api/health', require('./routes/health.routes'));

// Role-Specific
app.use('/api/registrar', require('./routes/registrar.routes'));
app.use('/api/accountant', require('./routes/accountant.routes'));

// Leave & Fines
app.use('/api/leaves', require('./routes/leaveApplication.routes'));
app.use('/api/fines', require('./routes/fine.routes'));
app.use('/api/gate', require('./routes/guard.routes'));
app.use('/api/profile', require('./routes/profile.routes'));
app.use('/api/analytics', require('./routes/analytics.routes'));
app.use('/api/approvals', require('./routes/approval.routes'));
app.use('/api/evaluations', require('./routes/evaluation.routes'));

// Static files (uploads)
app.use('/uploads', express.static('uploads'));

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Academix Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

module.exports = app;
