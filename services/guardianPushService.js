const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Parent App Web Push Notification Delivery Service (N22)
 */

async function saveSubscription({
  collegeId,
  studentId,
  endpoint,
  p256dh,
  auth,
  userAgent = null,
}) {
  return await prisma.guardianPushSubscription.upsert({
    where: { endpoint },
    create: {
      college_id: collegeId,
      studentId,
      endpoint,
      p256dh,
      auth,
      userAgent,
    },
    update: {
      college_id: collegeId,
      studentId,
      p256dh,
      auth,
      userAgent,
    },
  });
}

async function getSubscriptionsForStudent(collegeId, studentId) {
  return await prisma.guardianPushSubscription.findMany({
    where: {
      college_id: collegeId,
      studentId,
    },
  });
}

/**
 * Deliver push notification to subscriptions with automatic 410 / 404 purge
 */
async function sendPushNotification({
  collegeId,
  studentId,
  title,
  body,
  data = {},
  // Optional custom mock sender or mock status for testing
  pushSender = null,
}) {
  const subscriptions = await getSubscriptionsForStudent(collegeId, studentId);
  if (subscriptions.length === 0) {
    return { sentCount: 0, purgedCount: 0, message: 'No registered push subscriptions found.' };
  }

  let sentCount = 0;
  let purgedCount = 0;
  const purgedEndpoints = [];

  for (const sub of subscriptions) {
    try {
      if (pushSender) {
        // Execute provided sender (e.g. in test or custom web-push)
        await pushSender(sub, { title, body, data });
      }
      sentCount++;
    } catch (err) {
      // Invariant: Subscriptions returning HTTP 410 (Gone) or 404 (Not Found) are automatically deleted
      const statusCode = err.statusCode || err.status || (err.response && err.response.status);
      if (statusCode === 410 || statusCode === 404 || err.code === 'SUBSCRIPTION_EXPIRED') {
        await prisma.guardianPushSubscription.delete({
          where: { endpoint: sub.endpoint },
        });
        purgedCount++;
        purgedEndpoints.push(sub.endpoint);
      }
    }
  }

  return {
    sentCount,
    purgedCount,
    purgedEndpoints,
  };
}

module.exports = {
  saveSubscription,
  getSubscriptionsForStudent,
  sendPushNotification,
};
