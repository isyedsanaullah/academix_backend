const { PLAN_FEATURES, normalizePlanId } = require('./planConstants');

/**
 * Canonical Feature Registry
 * Platform catalog of all available configurable modules, their categories,
 * core protection flags, display metadata, and architectural dependency links.
 * 
 * Note: Base plan availability is read dynamically from planConstants (PLAN_FEATURES).
 */
const FEATURE_REGISTRY = [
  {
    key: 'core-academic',
    name: 'Academic Foundation',
    category: 'Academic Core',
    description: 'Fundamental college structures including Sessions, Classes, Sections, Groups, Subjects, Students, and Teachers.',
    isCore: true,
    iconName: 'HiOutlineAcademicCap',
    dependsOn: []
  },
  {
    key: 'attendance',
    name: 'Attendance Tracking',
    category: 'Academic & LMS',
    description: 'Daily student and faculty attendance records, attendance registers, and monthly summaries.',
    isCore: false,
    iconName: 'HiOutlineClipboardCheck',
    dependsOn: []
  },
  {
    key: 'timetable',
    name: 'Timetables & Schedules',
    category: 'Academic & LMS',
    description: 'Class scheduling, lecture period planning, universal institution timetables, and teacher allocations.',
    isCore: false,
    iconName: 'HiOutlineClock',
    dependsOn: []
  },
  {
    key: 'exams-results',
    name: 'Examinations & Results',
    category: 'Academic & LMS',
    description: 'Exam scheduling, roll number slip generation, marks entry, student evaluations, and result cards.',
    isCore: false,
    iconName: 'HiOutlineChartBar',
    dependsOn: []
  },
  {
    key: 'assignments-quizzes',
    name: 'Assignments & LMS Quizzes',
    category: 'Academic & LMS',
    description: 'Online assignments, submission review, digital quiz bank, auto-grading, and attempt evaluations.',
    isCore: false,
    iconName: 'HiOutlineClipboardList',
    dependsOn: []
  },
  {
    key: 'certificates',
    name: 'Certificates & Credentials',
    category: 'Academic & LMS',
    description: 'Student character certificates, course completion letters, and QR-verifiable credential generation.',
    isCore: false,
    iconName: 'HiOutlineDocumentText',
    dependsOn: []
  },
  {
    key: 'announcements',
    name: 'Announcements & Broadcasts',
    category: 'Communication',
    description: 'Campus-wide emergency alerts, holiday notices, audience-targeted announcements, and in-app notifications.',
    isCore: false,
    iconName: 'HiOutlineSpeakerphone',
    dependsOn: []
  },
  {
    key: 'fees',
    name: 'Fee Management & Treasury',
    category: 'Finance & Operations',
    description: 'Fee structures, student vouchers, collection registers, defaulter tracking, receipts, and treasury logs.',
    isCore: false,
    iconName: 'HiOutlineCurrencyDollar',
    dependsOn: []
  },
  {
    key: 'employees',
    name: 'Staff Accounts & Leaves',
    category: 'HR & Operations',
    description: 'Staff profiles, employee payroll records, leave applications, and administrative approval workflows.',
    isCore: false,
    iconName: 'HiOutlineUserGroup',
    dependsOn: []
  },
  {
    key: 'canteen',
    name: 'Canteen POS & Transactions',
    category: 'Operations',
    description: 'Campus canteen balance ledger, point-of-sale food orders, and transaction audit trails.',
    isCore: false,
    iconName: 'HiOutlineOfficeBuilding',
    dependsOn: []
  },
  {
    key: 'analytics-reports',
    name: 'Platform Analytics & Reports',
    category: 'Intelligence',
    description: 'Comprehensive institution performance dashboards, student demographic analytics, and exportable report center.',
    isCore: false,
    iconName: 'HiOutlineChartBar',
    dependsOn: []
  },
  {
    key: 'entry-system',
    name: 'Gate Scanner & QR Entry',
    category: 'Security & Gate',
    description: 'Campus gate security scanner, real-time entry/exit logs, visitor tracking, and student early exit passes.',
    isCore: false,
    iconName: 'HiOutlineShieldCheck',
    dependsOn: []
  },
  {
    key: 'visitors',
    name: 'Visitor Management',
    category: 'Security & Gate',
    description: 'Visitor pass registration, host person notification, security check-in, and visitor log archives.',
    isCore: false,
    iconName: 'HiOutlineUser',
    dependsOn: []
  },
  {
    key: 'ai-chat',
    name: 'AI Chat Assistant',
    category: 'AI Education Suite',
    description: 'Conversational AI study assistant, 24/7 student tutoring, teacher lesson advisor, and principal guidance.',
    isCore: false,
    iconName: 'HiOutlineSparkles',
    dependsOn: []
  },
  {
    key: 'ai-pdf-chat',
    name: 'PDF Knowledge Library',
    category: 'AI Education Suite',
    description: 'Semantic vector search and conversational Q&A over uploaded textbook and lecture PDF materials.',
    isCore: false,
    iconName: 'HiOutlineBookOpen',
    dependsOn: ['ai-chat']
  },
  {
    key: 'ai-generators',
    name: 'AI Assessment Generators',
    category: 'AI Education Suite',
    description: 'AI-assisted quiz generator, exam paper builder, MCQ creator, study notes, assignment, and syllabus generator.',
    isCore: false,
    iconName: 'HiOutlineDocumentDuplicate',
    dependsOn: ['ai-chat']
  }
];

/**
 * Validates DAG cycle freedom in the feature registry
 */
function validateRegistryDAG(registry) {
  const map = new Map(registry.map(f => [f.key, f.dependsOn || []]));
  const visited = new Set();
  const recursionStack = new Set();

  function detectCycle(key) {
    if (!visited.has(key)) {
      visited.add(key);
      recursionStack.add(key);

      const deps = map.get(key) || [];
      for (const dep of deps) {
        if (!map.has(dep)) {
          console.warn(`[FeatureRegistry] Warning: Feature "${key}" depends on unknown feature "${dep}"`);
          continue;
        }
        if (!visited.has(dep) && detectCycle(dep)) {
          return true;
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }
    }
    recursionStack.delete(key);
    return false;
  }

  for (const f of registry) {
    if (detectCycle(f.key)) {
      throw new Error(`[FeatureRegistry] Circular dependency detected in feature: "${f.key}"`);
    }
  }
}

// Run cycle check on module load
validateRegistryDAG(FEATURE_REGISTRY);

/**
 * Deterministic Feature Access Resolution
 * Evaluates Plan Baseline -> Stored Overrides -> Topological Fixed-Point Dependency Propagation.
 * 
 * @param {string} rawPlanId - Raw plan identifier (e.g. 'basic', 'standard', 'premium')
 * @param {object} rawOverrides - Stored overrides map (e.g. { 'fees': false, 'ai-chat': true })
 * @returns {object} - { effectiveKeys: string[], featureMatrix: object[], stats: object }
 */
function resolveCollegeFeatures(rawPlanId, rawOverrides = {}) {
  const planId = normalizePlanId(rawPlanId);
  const planAllowed = PLAN_FEATURES[planId] || PLAN_FEATURES.starter || PLAN_FEATURES.basic;
  const overrides = (typeof rawOverrides === 'object' && rawOverrides !== null) ? rawOverrides : {};

  // Step 1: Base candidate state calculation
  const stateMap = new Map();

  for (const feat of FEATURE_REGISTRY) {
    // Check if the plan includes this feature
    const inPlan = planAllowed.includes(feat.key);

    // Read explicit override
    const rawOverride = overrides[feat.key];
    let override = null;
    if (rawOverride === true || rawOverride === 'true') override = true;
    else if (rawOverride === false || rawOverride === 'false') override = false;

    // Core features are unconditionally active
    if (feat.isCore) {
      stateMap.set(feat.key, {
        ...feat,
        inPlan: true,
        override: null,
        effective: true,
        dependencyBlocked: false,
        blockedBy: [],
        source: 'core_foundation'
      });
      continue;
    }

    // Determine initial candidate state
    let effective = inPlan;
    let source = inPlan ? 'plan_default' : 'plan_default';

    if (override === true) {
      effective = true;
      source = inPlan ? 'plan_default' : 'custom_enabled';
    } else if (override === false) {
      effective = false;
      source = 'custom_disabled';
    } else {
      effective = inPlan;
      source = 'plan_default';
    }

    stateMap.set(feat.key, {
      ...feat,
      inPlan,
      override,
      effective,
      dependencyBlocked: false,
      blockedBy: [],
      source
    });
  }

  // Step 2: Deterministic fixed-point dependency propagation
  let changed = true;
  let iterations = 0;
  const maxIterations = FEATURE_REGISTRY.length * 2;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const feat of FEATURE_REGISTRY) {
      const current = stateMap.get(feat.key);
      if (!current || current.isCore) continue;

      if (current.effective && feat.dependsOn && feat.dependsOn.length > 0) {
        const missingDeps = [];
        for (const depKey of feat.dependsOn) {
          const depState = stateMap.get(depKey);
          if (!depState || !depState.effective) {
            missingDeps.push(depKey);
          }
        }

        if (missingDeps.length > 0) {
          current.effective = false;
          current.dependencyBlocked = true;
          current.blockedBy = missingDeps;
          current.source = 'dependency_blocked';
          changed = true;
        }
      }
    }
  }

  const featureMatrix = Array.from(stateMap.values());
  const effectiveKeys = featureMatrix.filter(f => f.effective).map(f => f.key);

  // Derive summary statistics dynamically
  const stats = {
    totalFeatures: featureMatrix.length,
    planIncluded: featureMatrix.filter(f => f.inPlan).length,
    customEnabled: featureMatrix.filter(f => f.override === true).length,
    customDisabled: featureMatrix.filter(f => f.override === false).length,
    dependencyBlocked: featureMatrix.filter(f => f.dependencyBlocked).length,
    effectiveActive: effectiveKeys.length
  };

  return {
    planId,
    effectiveKeys,
    featureMatrix,
    stats
  };
}

module.exports = {
  FEATURE_REGISTRY,
  resolveCollegeFeatures,
  normalizePlanId
};
