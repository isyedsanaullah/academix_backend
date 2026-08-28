const { getSystemClient } = require('../config/prismaManager');

/**
 * Plan Feature Definitions
 * Maps each plan to the features it unlocks.
 * Used by planGate middleware to enforce access control.
 */
const PLAN_FEATURES = {
  basic: [
    'students', 'teachers', 'subjects', 'attendance',
    'timetable', 'notices', 'exams', 'results',
    'classes', 'sections', 'sessions', 'announcements',
    'assignments', 'quizzes', 'certificates'
  ],
  standard: [
    // Includes all basic features
    'students', 'teachers', 'subjects', 'attendance',
    'timetable', 'notices', 'exams', 'results',
    'classes', 'sections', 'sessions', 'announcements',
    'assignments', 'quizzes', 'certificates',
    // Standard-only features
    'entry-system', 'fees', 'analytics', 'reports',
    'employees', 'visitors', 'canteen', 'advanced'
  ],
  premium: [
    // Includes all standard features
    'students', 'teachers', 'subjects', 'attendance',
    'timetable', 'notices', 'exams', 'results',
    'classes', 'sections', 'sessions', 'announcements',
    'assignments', 'quizzes', 'certificates',
    'entry-system', 'fees', 'analytics', 'reports',
    'employees', 'visitors', 'canteen', 'advanced',
    // Premium AI features
    'ai-chat', 'ai-pdf-chat', 'ai-study-assistant',
    'ai-paper-generator', 'ai-quiz-generator',
    'ai-assignment-generator', 'ai-notes-generator',
    'ai-syllabus-generator', 'ai-mcq-generator'
  ]
};

/**
 * Plan hierarchy for comparison
 */
const PLAN_LEVEL = { basic: 0, standard: 1, premium: 2 };

/**
 * Plan Gate Middleware
 * Checks if the college's subscription plan includes the required feature.
 * Super admins bypass all plan checks.
 */
const planGate = (requiredFeature) => {
  return async (req, res, next) => {
    try {
      // Super admins bypass plan checks
      if (req.user && req.user.role === 'superAdmin') {
        return next();
      }

      // Get college from tenant context
      const collegeId = req.collegeId || req.user?.college_id;
      if (!collegeId) {
        return res.status(403).json({
          success: false,
          message: 'No college associated with this account'
        });
      }

      const systemDb = getSystemClient();
      const college = await systemDb.college.findUnique({
        where: { id: collegeId },
        select: { subscription: true, isActive: true }
      });

      if (!college) {
        return res.status(404).json({
          success: false,
          message: 'College not found'
        });
      }

      // Check if college is active
      if (!college.isActive) {
        return res.status(403).json({
          success: false,
          message: 'College account is deactivated'
        });
      }

      const subscription = college.subscription || {};

      // Check subscription status
      if (subscription.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'College subscription is suspended. Contact administrator.'
        });
      }

      if (subscription.status === 'expired') {
        return res.status(403).json({
          success: false,
          message: 'College subscription has expired. Please renew.'
        });
      }

      // Check if plan includes the required feature
      const plan = subscription.plan || 'basic';
      const allowedFeatures = PLAN_FEATURES[plan] || PLAN_FEATURES.basic;

      if (!allowedFeatures.includes(requiredFeature)) {
        return res.status(403).json({
          success: false,
          message: `This feature requires a higher subscription plan. Current plan: ${plan.toUpperCase()}`,
          requiredFeature,
          currentPlan: plan,
          upgrade: true
        });
      }

      // Attach plan info to request for downstream use
      req.collegePlan = plan;
      req.planFeatures = allowedFeatures;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Minimum plan level check
 * Usage: planGate.minPlan('standard')
 */
planGate.minPlan = (minPlan) => {
  return async (req, res, next) => {
    try {
      if (req.user && req.user.role === 'superAdmin') {
        return next();
      }

      const collegeId = req.collegeId || req.user?.college_id;
      if (!collegeId) {
        return res.status(403).json({
          success: false,
          message: 'No college associated with this account'
        });
      }

      const systemDb = getSystemClient();
      const college = await systemDb.college.findUnique({
        where: { id: collegeId },
        select: { subscription: true, isActive: true }
      });

      if (!college || !college.isActive) {
        return res.status(403).json({
          success: false,
          message: 'College not found or deactivated'
        });
      }

      const subscription = college.subscription || {};
      const plan = subscription.plan || 'basic';
      const required = PLAN_LEVEL[minPlan] || 0;
      const current = PLAN_LEVEL[plan] || 0;

      if (current < required) {
        return res.status(403).json({
          success: false,
          message: `This feature requires at least the ${minPlan.toUpperCase()} plan. Current: ${plan.toUpperCase()}`,
          currentPlan: plan,
          requiredPlan: minPlan,
          upgrade: true
        });
      }

      req.collegePlan = plan;
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Export features map for use in frontend/seeder
planGate.PLAN_FEATURES = PLAN_FEATURES;
planGate.PLAN_LEVEL = PLAN_LEVEL;

module.exports = planGate;
