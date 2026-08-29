/**
 * Canonical Subscription Plan Feature Definitions
 * Single source of truth for features included by default in each plan tier.
 */

const PLAN_FEATURES = {
  basic: [
    'core-academic',
    'students',
    'teachers',
    'subjects',
    'classes',
    'sections',
    'sessions',
    'attendance',
    'timetable',
    'exams-results',
    'exams',
    'results',
    'assignments-quizzes',
    'assignments',
    'quizzes',
    'certificates',
    'announcements',
    'notices'
  ],
  standard: [
    // Includes all basic features
    'core-academic',
    'students',
    'teachers',
    'subjects',
    'classes',
    'sections',
    'sessions',
    'attendance',
    'timetable',
    'exams-results',
    'exams',
    'results',
    'assignments-quizzes',
    'assignments',
    'quizzes',
    'certificates',
    'announcements',
    'notices',
    // Standard-only features
    'fees',
    'entry-system',
    'visitors',
    'employees',
    'canteen',
    'analytics-reports',
    'analytics',
    'reports',
    'advanced'
  ],
  premium: [
    // Includes all standard features
    'core-academic',
    'students',
    'teachers',
    'subjects',
    'classes',
    'sections',
    'sessions',
    'attendance',
    'timetable',
    'exams-results',
    'exams',
    'results',
    'assignments-quizzes',
    'assignments',
    'quizzes',
    'certificates',
    'announcements',
    'notices',
    'fees',
    'entry-system',
    'visitors',
    'employees',
    'canteen',
    'analytics-reports',
    'analytics',
    'reports',
    'advanced',
    // Premium AI features
    'ai-chat',
    'ai-pdf-chat',
    'ai-generators',
    'ai-study-assistant',
    'ai-paper-generator',
    'ai-quiz-generator',
    'ai-assignment-generator',
    'ai-notes-generator',
    'ai-syllabus-generator',
    'ai-mcq-generator'
  ]
};

const PLAN_LEVEL = {
  basic: 0,
  standard: 1,
  premium: 2
};

/**
 * Normalizes raw plan string to canonical plan ID
 * @param {string} rawPlan - Raw plan value from DB or request
 * @returns {string} - 'basic' | 'standard' | 'premium'
 */
const normalizePlanId = (rawPlan) => {
  if (!rawPlan || typeof rawPlan !== 'string') return 'basic';
  const clean = rawPlan.toLowerCase().trim();
  if (clean.startsWith('prem')) return 'premium';
  if (clean.startsWith('stand')) return 'standard';
  if (clean.startsWith('ent')) return 'premium';
  return 'basic';
};

module.exports = {
  PLAN_FEATURES,
  PLAN_LEVEL,
  normalizePlanId
};
