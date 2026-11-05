const { getSystemClient } = require('../config/prismaManager');

class MessagingDriver {
  constructor() {
    this.isReal = false;
  }
  async send(params) {
    throw new Error('Not implemented');
  }
}

class InAppMessagingDriver extends MessagingDriver {
  constructor() {
    super();
    this.isReal = false;
  }

  async send({ collegeId, campusId = null, recipient, title = 'Notice', body, kind = 'GENERAL', refType = null, refId = null }) {
    const prisma = getSystemClient();

    if (!recipient || !recipient.type) {
      throw new Error('Typed recipient required ({ type: "USER", userId } or { type: "GUARDIAN", studentId })');
    }

    if (recipient.type === 'GUARDIAN') {
      if (!recipient.studentId) throw new Error('studentId required for GUARDIAN recipient');
      const notification = await prisma.guardianNotification.create({
        data: {
          college_id: collegeId,
          campus_id: campusId,
          student_id: recipient.studentId,
          kind,
          title,
          body,
          refType,
          refId
        }
      });
      return { success: true, channel: 'IN_APP', id: notification.id, costCredits: 0 };
    }

    if (recipient.type === 'USER') {
      if (!recipient.userId) throw new Error('userId required for USER recipient');
      const userNotification = await prisma.notification.create({
        data: {
          college_id: collegeId,
          recipient: recipient.userId,
          title,
          message: body,
          type: kind.toLowerCase()
        }
      });
      return { success: true, channel: 'IN_APP', id: userNotification.id, costCredits: 0 };
    }

    throw new Error(`Unsupported recipient type: ${recipient.type}`);
  }
}

class TwilioSmsDriver extends MessagingDriver {
  constructor() {
    super();
    this.isReal = true;
  }
}

class MetaWhatsAppDriver extends MessagingDriver {
  constructor() {
    super();
    this.isReal = true;
  }
}

const activeDrivers = {
  IN_APP: new InAppMessagingDriver(),
  SMS: null, // Stays null until real driver registered
  WHATSAPP: null // Stays null until real driver registered
};

/**
 * Universal messaging send entry point
 */
async function sendMessage({
  collegeId,
  campusId = null,
  recipient,
  channel = 'IN_APP',
  title = 'Notice',
  body,
  kind = 'GENERAL',
  refType = null,
  refId = null
}) {
  const driver = activeDrivers[channel];
  if (!driver) {
    const err = new Error(`Channel ${channel} is not available. Real drivers will be enabled when SMS/WhatsApp goes live.`);
    err.code = 'CHANNEL_NOT_AVAILABLE';
    err.status = 422;
    throw err;
  }

  return await driver.send({
    collegeId,
    campusId,
    recipient,
    title,
    body,
    kind,
    refType,
    refId
  });
}

module.exports = {
  MessagingDriver,
  InAppMessagingDriver,
  TwilioSmsDriver,
  MetaWhatsAppDriver,
  sendMessage,
  activeDrivers
};
