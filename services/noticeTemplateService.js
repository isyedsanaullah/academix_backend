const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Notice Templates & Scheduled Dispatch Engine (N21)
 */

const ALLOWED_MERGE_TOKENS = [
  'studentName',
  'class',
  'section',
  'rollNumber',
  'dueDate',
  'amountPkr',
  'examDate',
  'collegeName',
];

function renderTemplate(bodyTemplate, context = {}) {
  if (!bodyTemplate) return '';
  return bodyTemplate.replace(/\{\{(\w+)\}\}/g, (match, token) => {
    if (ALLOWED_MERGE_TOKENS.includes(token)) {
      return context[token] !== undefined ? String(context[token]) : match;
    }
    return match;
  });
}

async function createTemplate({
  collegeId,
  campusId = null,
  title,
  category = 'FEE_REMINDER', // FEE_REMINDER | EMERGENCY | EXAM_NOTICE | HOLIDAY | PTM
  bodyTemplate,
  defaultAudience = 'PARENTS', // ALL | STUDENTS | PARENTS | TEACHERS
  isSystemPreseeded = false,
}) {
  return await prisma.announcementTemplate.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      title,
      category,
      bodyTemplate,
      defaultAudience,
      isSystemPreseeded: Boolean(isSystemPreseeded),
    },
  });
}

async function listTemplates(collegeId, category = null) {
  const where = {
    college_id: collegeId,
    ...(category ? { category } : {}),
  };

  return await prisma.announcementTemplate.findMany({
    where,
    orderBy: { title: 'asc' },
  });
}

async function dispatchFromTemplate({
  collegeId,
  campusId = null,
  templateId,
  recipients = [], // [{ studentName, class, amountPkr, ... }]
  scheduledFor = null,
  createdById,
}) {
  const template = await prisma.announcementTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template || template.college_id !== collegeId) {
    throw { statusCode: 404, code: 'TEMPLATE_NOT_FOUND', message: 'Announcement template not found.' };
  }

  // Generate rendered notifications or announcements
  const dispatchedMessages = recipients.map((r) => {
    const renderedBody = renderTemplate(template.bodyTemplate, r);
    return {
      title: template.title,
      body: renderedBody,
      audience: template.defaultAudience,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      context: r,
    };
  });

  return {
    templateId: template.id,
    templateTitle: template.title,
    count: dispatchedMessages.length,
    messages: dispatchedMessages,
  };
}

module.exports = {
  ALLOWED_MERGE_TOKENS,
  renderTemplate,
  createTemplate,
  listTemplates,
  dispatchFromTemplate,
};
