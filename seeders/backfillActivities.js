/**
 * Backfill Activities Seeder
 * Populates historical ActivityLog entries from existing database records.
 * Can be run manually: node seeders/backfillActivities.js
 */

const dotenv = require('dotenv');
dotenv.config();

const { getSystemClient } = require('../config/prismaManager');
const { ACTIONS, CATEGORIES } = require('../config/activityConstants');

async function backfillActivities() {
  console.log('🔄 Starting historical ActivityLog backfill...');
  const prisma = getSystemClient();

  try {
    let insertedCount = 0;

    // 1. Announcements
    const announcements = await prisma.announcement.findMany({ take: 50 });
    for (const ann of announcements) {
      const exists = await prisma.activityLog.findFirst({
        where: { resourceType: 'Announcement', resourceId: ann.id }
      });
      if (!exists) {
        await prisma.activityLog.create({
          data: {
            college_id: ann.college_id,
            actorUserId: ann.createdBy || null,
            actorNameSnapshot: 'Administration',
            actorRoleSnapshot: 'admin',
            action: ACTIONS.ANNOUNCEMENT_PUBLISHED,
            category: CATEGORIES.ANNOUNCEMENT,
            resourceType: 'Announcement',
            resourceId: ann.id,
            title: ann.title,
            description: ann.content?.slice(0, 120),
            metadata: { announcementTitle: ann.title, category: ann.category },
            createdAt: ann.createdAt || new Date()
          }
        });
        insertedCount++;
      }
    }

    // 2. Assignments
    const assignments = await prisma.assignment.findMany({ take: 50 });
    for (const ass of assignments) {
      const exists = await prisma.activityLog.findFirst({
        where: { resourceType: 'Assignment', resourceId: ass.id }
      });
      if (!exists) {
        await prisma.activityLog.create({
          data: {
            college_id: ass.college_id,
            actorUserId: ass.teacher_id || null,
            actorNameSnapshot: 'Faculty Teacher',
            actorRoleSnapshot: 'teacher',
            action: ACTIONS.ASSIGNMENT_CREATED,
            category: CATEGORIES.ASSIGNMENT,
            resourceType: 'Assignment',
            resourceId: ass.id,
            title: ass.title,
            description: `Assignment "${ass.title}" was published.`,
            metadata: { assignmentTitle: ass.title, dueDate: ass.dueDate },
            createdAt: ass.createdAt || new Date()
          }
        });
        insertedCount++;
      }
    }

    // 3. Fee Payments / Fees
    const fees = await prisma.fee.findMany({ take: 50 });
    for (const fee of fees) {
      const exists = await prisma.activityLog.findFirst({
        where: { resourceType: 'Fee', resourceId: fee.id }
      });
      if (!exists) {
        const actionType = fee.status === 'paid' ? ACTIONS.FEE_PAYMENT_VERIFIED : ACTIONS.FEE_GENERATED;
        await prisma.activityLog.create({
          data: {
            college_id: fee.college_id,
            actorUserId: fee.verifiedBy || null,
            actorNameSnapshot: 'Accountant',
            actorRoleSnapshot: 'accountant',
            action: actionType,
            category: CATEGORIES.FINANCE,
            resourceType: 'Fee',
            resourceId: fee.id,
            targetUserId: fee.student_id,
            title: fee.status === 'paid' ? 'Fee Payment Verified' : 'Fee Invoice Generated',
            description: `Fee invoice for ${fee.month || 'session'} (${fee.totalAmount ? 'Rs. ' + fee.totalAmount : ''}).`,
            metadata: { amount: fee.totalAmount, month: fee.month, status: fee.status },
            createdAt: fee.createdAt || new Date()
          }
        });
        insertedCount++;
      }
    }

    // 4. Users / Staff
    const users = await prisma.user.findMany({ take: 30, orderBy: { createdAt: 'desc' } });
    for (const user of users) {
      const exists = await prisma.activityLog.findFirst({
        where: { resourceType: 'User', resourceId: user.id }
      });
      if (!exists) {
        await prisma.activityLog.create({
          data: {
            college_id: user.college_id,
            actorUserId: user.id,
            actorNameSnapshot: user.name,
            actorRoleSnapshot: user.role,
            action: ACTIONS.LOGIN,
            category: CATEGORIES.AUTHENTICATION,
            resourceType: 'User',
            resourceId: user.id,
            title: `${user.name} Login`,
            description: `${user.name} logged into the system.`,
            createdAt: user.lastLogin || user.createdAt || new Date()
          }
        });
        insertedCount++;
      }
    }

    console.log(`✅ ActivityLog backfill complete! Created ${insertedCount} new activity records.`);
  } catch (err) {
    console.error('❌ Backfill error:', err.message);
  }
}

if (require.main === module) {
  backfillActivities().then(() => process.exit(0));
}

module.exports = backfillActivities;
