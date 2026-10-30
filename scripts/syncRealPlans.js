'use strict';

require('dotenv').config();
const { getSystemClient } = require('../config/prismaManager');

const REAL_PLANS = [
  {
    planId: 'starter',
    name: 'Starter',
    description: 'Small and new colleges',
    features: [
      'students', 'teachers', 'subjects', 'attendance',
      'timetable', 'notices', 'exams', 'results',
      'classes', 'sections', 'sessions', 'announcements',
      'assignments', 'quizzes', 'certificates'
    ],
    restrictions: [
      'No extra students beyond 300 (upgrade required)',
      'No online admissions portal (registrar enters by hand)',
      'No AI features',
      'Email support only'
    ],
    limits: {
      maxStudents: 300,
      maxStaff: 20,
      maxStorage: 5120, // 5 GB in MB
      maxApplications: 0,
      extraStudentCost: 0,
      support: 'Email'
    },
    price: {
      monthly: 7999,
      yearly: 79990,
      currency: 'PKR'
    },
    isAI: false,
    isActive: true,
    kind: 'standard'
  },
  {
    planId: 'standard',
    name: 'Standard',
    description: 'Private colleges',
    features: [
      'students', 'teachers', 'subjects', 'attendance',
      'timetable', 'notices', 'exams', 'results',
      'classes', 'sections', 'sessions', 'announcements',
      'assignments', 'quizzes', 'certificates',
      'entry-system', 'fees', 'analytics', 'reports',
      'employees', 'visitors', 'canteen', 'advanced',
      'id-cards-qr', 'gate-attendance', 'online-admissions'
    ],
    restrictions: [
      'No AI implementation'
    ],
    limits: {
      maxStudents: 1000,
      maxStaff: 60,
      maxStorage: 20480, // 20 GB in MB
      maxApplications: 300,
      extraStudentCost: 18,
      support: 'Chat, business hours'
    },
    price: {
      monthly: 19999,
      yearly: 199990,
      currency: 'PKR'
    },
    isAI: false,
    isActive: true,
    kind: 'standard'
  },
  {
    planId: 'premium',
    name: 'Premium',
    description: 'Growing multi-department colleges',
    features: [
      'students', 'teachers', 'subjects', 'attendance',
      'timetable', 'notices', 'exams', 'results',
      'classes', 'sections', 'sessions', 'announcements',
      'assignments', 'quizzes', 'certificates',
      'entry-system', 'fees', 'analytics', 'reports',
      'employees', 'visitors', 'canteen', 'advanced',
      'id-cards-qr', 'gate-attendance', 'online-admissions',
      'auto-timetable', 'parent-portal', 'priority-support'
    ],
    restrictions: [
      'No AI generation suite'
    ],
    limits: {
      maxStudents: 2500,
      maxStaff: 150,
      maxStorage: 76800, // 75 GB in MB
      maxApplications: 2000,
      extraStudentCost: 14,
      support: 'Priority chat'
    },
    price: {
      monthly: 44999,
      yearly: 449990,
      currency: 'PKR'
    },
    isAI: false,
    isActive: true,
    kind: 'standard'
  },
  {
    planId: 'enterprise',
    name: 'Enterprise',
    description: 'Large colleges and groups',
    features: [
      'students', 'teachers', 'subjects', 'attendance',
      'timetable', 'notices', 'exams', 'results',
      'classes', 'sections', 'sessions', 'announcements',
      'assignments', 'quizzes', 'certificates',
      'entry-system', 'fees', 'analytics', 'reports',
      'employees', 'visitors', 'canteen', 'advanced',
      'id-cards-qr', 'gate-attendance', 'online-admissions',
      'auto-timetable', 'parent-portal', 'multi-campus',
      'ai-chat', 'ai-pdf-chat', 'ai-study-assistant',
      'ai-paper-generator', 'ai-quiz-generator',
      'ai-assignment-generator', 'ai-notes-generator',
      'ai-syllabus-generator', 'ai-mcq-generator'
    ],
    restrictions: [],
    limits: {
      maxStudents: 5000,
      maxStaff: 400,
      maxStorage: 307200, // 300 GB in MB
      maxApplications: 10000,
      extraStudentCost: 12,
      support: 'Named contact'
    },
    price: {
      monthly: 119999,
      yearly: 1199990,
      currency: 'PKR'
    },
    isAI: true,
    isActive: true,
    kind: 'standard'
  }
];

async function run() {
  const prisma = getSystemClient();
  console.log('🔄 Syncing real subscription plans with system database...');

  // Deactivate old 'basic' plan if it exists
  await prisma.subscription.updateMany({
    where: { planId: 'basic' },
    data: { isActive: false, planStatus: 'legacy' }
  });

  for (const plan of REAL_PLANS) {
    const existing = await prisma.subscription.findUnique({
      where: { planId: plan.planId }
    });

    if (existing) {
      await prisma.subscription.update({
        where: { planId: plan.planId },
        data: {
          name: plan.name,
          description: plan.description,
          features: plan.features,
          restrictions: plan.restrictions,
          limits: plan.limits,
          price: plan.price,
          isAI: plan.isAI,
          isActive: true,
          planStatus: 'active'
        }
      });
      console.log(` ✔ Updated plan: ${plan.name} (${plan.planId}) -> PKR ${plan.price.monthly}/mo`);
    } else {
      await prisma.subscription.create({
        data: plan
      });
      console.log(` ✔ Created plan: ${plan.name} (${plan.planId}) -> PKR ${plan.price.monthly}/mo`);
    }
  }

  const allActive = await prisma.subscription.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`\n🎉 Total Active Plans in DB: ${allActive.length}`);
  allActive.forEach(p => console.log(`   - ${p.name} (${p.planId}): PKR ${p.price?.monthly?.toLocaleString()}/mo, PKR ${p.price?.yearly?.toLocaleString()}/yr`));

  process.exit(0);
}

run().catch(err => {
  console.error('❌ Failed to sync plans:', err);
  process.exit(1);
});
