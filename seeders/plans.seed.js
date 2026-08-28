const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { getSystemClient } = require('../config/prismaManager');

const plans = [
  {
    planId: 'basic',
    name: 'Basic Plan',
    description: 'Essential college management features for small institutions',
    features: [
      'students', 'teachers', 'subjects', 'attendance',
      'timetable', 'notices', 'exams', 'results',
      'classes', 'sections', 'sessions', 'announcements',
      'assignments', 'quizzes', 'certificates'
    ],
    restrictions: [
      'No AI features',
      'No biometric/entry system',
      'No fee management',
      'Teacher attendance only'
    ],
    limits: { maxStudents: 500, maxStaff: 50, maxStorage: 1024 },
    price: { monthly: 0, yearly: 0, currency: 'PKR' },
    isAI: false
  },
  {
    planId: 'standard',
    name: 'Standard Plan',
    description: 'Advanced management with fee tracking, analytics, and entry system',
    features: [
      'students', 'teachers', 'subjects', 'attendance',
      'timetable', 'notices', 'exams', 'results',
      'classes', 'sections', 'sessions', 'announcements',
      'assignments', 'quizzes', 'certificates',
      'entry-system', 'fees', 'analytics', 'reports',
      'employees', 'visitors', 'canteen', 'advanced'
    ],
    restrictions: [
      'No AI implementation'
    ],
    limits: { maxStudents: 2000, maxStaff: 200, maxStorage: 5120 },
    price: { monthly: 5000, yearly: 50000, currency: 'PKR' },
    isAI: false
  },
  {
    planId: 'premium',
    name: 'Premium AI Plan',
    description: 'Full-featured platform with AI-powered tools for modern education',
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
    limits: { maxStudents: -1, maxStaff: -1, maxStorage: 20480 },
    price: { monthly: 15000, yearly: 150000, currency: 'PKR' },
    isAI: true
  }
];

const seedPlans = async () => {
  try {
    const prisma = getSystemClient();
    console.log('🌱 Seeding subscription plans...');

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
