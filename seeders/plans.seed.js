const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { getSystemClient } = require('../config/prismaManager');
const { PLAN_PRICING, GB } = require('../config/planConstants');

const plans = [
  {
    planId: 'starter',
    name: 'Starter Plan',
    description: 'Core daily operations for smaller institutions',
    features: [
      'students', 'teachers', 'subjects', 'attendance',
      'timetable', 'notices', 'exams', 'results',
      'classes', 'sections', 'sessions', 'announcements',
      'assignments', 'quizzes', 'certificates'
    ],
    restrictions: ['No AI features', 'No fee management'],
    limits: { maxStudents: 300, maxStaff: 20, maxStorageGb: 5 },
    price: { monthly: PLAN_PRICING.starter.monthly, yearly: PLAN_PRICING.starter.yearly, currency: 'PKR' },
    isAI: false
  },
  {
    planId: 'standard',
    name: 'Standard Plan',
    description: 'Admissions, challans, board exams, payroll & AI Lite',
    features: [
      'students', 'teachers', 'subjects', 'attendance',
      'timetable', 'notices', 'exams', 'results',
      'classes', 'sections', 'sessions', 'announcements',
      'assignments', 'quizzes', 'certificates',
      'entry-system', 'fees', 'analytics', 'reports',
      'employees', 'visitors', 'canteen', 'advanced'
    ],
    restrictions: [],
    limits: { maxStudents: 750, maxStaff: 60, maxStorageGb: 25 },
    price: { monthly: PLAN_PRICING.standard.monthly, yearly: PLAN_PRICING.standard.yearly, currency: 'PKR' },
    isAI: true
  },
  {
    planId: 'premium',
    name: 'Premium Plan',
    description: 'Full multi-campus governance, 40M AI & API access',
    features: [
      'students', 'teachers', 'subjects', 'attendance',
      'timetable', 'notices', 'exams', 'results',
      'classes', 'sections', 'sessions', 'announcements',
      'assignments', 'quizzes', 'certificates',
      'entry-system', 'fees', 'analytics', 'reports',
      'employees', 'visitors', 'canteen', 'advanced',
      'ai-chat', 'ai-pdf-chat', 'ai-study-assistant',
      'ai-paper-generator', 'ai-quiz-generator',
      'ai-assignment-generator', 'ai-notes-generator',
      'ai-syllabus-generator', 'ai-mcq-generator'
    ],
    restrictions: [],
    limits: { maxStudents: 2000, maxStaff: 150, maxStorageGb: Math.round((100 * GB) / GB) },
    price: { monthly: PLAN_PRICING.premium.monthly, yearly: PLAN_PRICING.premium.yearly, currency: 'PKR' },
    isAI: true
  }
];

const seedPlans = async () => {
  try {
    const prisma = getSystemClient();
    console.log('🌱 Seeding fixed 3 subscription plans (Starter, Standard, Premium)...');

    // Remove any deprecated/legacy plan rows outside the 3 fixed plans
    await prisma.subscription.deleteMany({
      where: { planId: { notIn: ['starter', 'standard', 'premium'] } }
    });

    // Upsert each plan
    for (const plan of plans) {
      await prisma.subscription.upsert({
        where: { planId: plan.planId },
        update: {
          name: plan.name,
          description: plan.description,
          features: plan.features,
          restrictions: plan.restrictions,
          limits: plan.limits,
          price: plan.price,
          isAI: plan.isAI
        },
        create: {
          planId: plan.planId,
          name: plan.name,
          description: plan.description,
          features: plan.features,
          restrictions: plan.restrictions,
          limits: plan.limits,
          price: plan.price,
          isAI: plan.isAI
        }
      });
      console.log(`  ✅ ${plan.name} seeded`);
    }

    console.log('✅ All plans seeded successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seedPlans();
