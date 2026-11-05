'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  const count = await prisma.subscriptionReminderLog.count({
    where: { eventType: 'GRANDFATHER_90D' }
  });
  console.log('GRANDFATHER_90D count in DB:', count);

  const logs = await prisma.subscriptionReminderLog.findMany({
    where: { eventType: 'GRANDFATHER_90D' }
  });
  console.log('Logs count:', logs.length);
  for (const l of logs) {
    console.log(` - college: ${l.college_id}, eventType: ${l.eventType}, sentDate: ${l.sentDate.toISOString()}, periodEndDate: ${l.periodEndDate ? l.periodEndDate.toISOString() : null}`);
  }

  // Check how many grandfathered colleges exist
  const grandfathered = await prisma.college.findMany({
    where: {
      isGrandfathered: true
    },
    select: { id: true, name: true, periodEnd: true, isGrandfathered: true }
  });
  console.log('\nGrandfathered colleges in DB:', grandfathered.length);
  for (const g of grandfathered) {
    console.log(` - ${g.name} (${g.id}), periodEnd: ${g.periodEnd}`);
  }

  // Check all distinct eventTypes in SubscriptionReminderLog
  const allEvents = await prisma.subscriptionReminderLog.groupBy({
    by: ['eventType'],
    _count: { id: true }
  });
  console.log('\nAll events in SubscriptionReminderLog:', allEvents);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
