const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Class Discussion & Moderated Academic Q&A Forum (N31)
 */

function sanitizeHtmlContent(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
}

async function createQuestion({
  collegeId,
  campusId = null,
  subjectId,
  className,
  studentId,
  title,
  body,
}) {
  const cleanTitle = sanitizeHtmlContent(title);
  const cleanBody = sanitizeHtmlContent(body);

  if (!cleanTitle || !cleanBody) {
    throw { statusCode: 400, code: 'INVALID_INPUT', message: 'Question title and body cannot be empty.' };
  }

  return await prisma.forumQuestion.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      subject_id: subjectId,
      class: className,
      student_id: studentId,
      title: cleanTitle,
      body: cleanBody,
    },
  });
}

async function listQuestions(collegeId, filters = {}) {
  const where = {
    college_id: collegeId,
    ...(filters.subjectId ? { subject_id: filters.subjectId } : {}),
    ...(filters.className ? { class: filters.className } : {}),
  };

  return await prisma.forumQuestion.findMany({
    where,
    include: {
      answers: {
        orderBy: [{ isAccepted: 'desc' }, { upvotes: 'desc' }],
      },
    },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
  });
}

async function postAnswer({
  questionId,
  authorId,
  authorRole = 'student', // student | teacher
  body,
}) {
  const cleanBody = sanitizeHtmlContent(body);
  if (!cleanBody) {
    throw { statusCode: 400, code: 'INVALID_INPUT', message: 'Answer body cannot be empty.' };
  }

  return await prisma.forumAnswer.create({
    data: {
      questionId,
      authorId,
      authorRole,
      body: cleanBody,
    },
  });
}

async function acceptAnswer({
  questionId,
  answerId,
  userRole,
}) {
  const isAuthorizedTeacher = ['teacher', 'principal', 'admin'].includes(userRole);
  if (!isAuthorizedTeacher) {
    throw {
      statusCode: 403,
      code: 'TEACHER_ENDORSEMENT_REQUIRED',
      message: 'Only faculty teachers and academic heads can verify or endorse accepted answers.',
    };
  }

  const answer = await prisma.forumAnswer.findUnique({
    where: { id: answerId },
  });

  if (!answer || answer.questionId !== questionId) {
    throw { statusCode: 404, code: 'ANSWER_NOT_FOUND', message: 'Answer not found for this question.' };
  }

  return await prisma.forumAnswer.update({
    where: { id: answerId },
    data: {
      isAccepted: true,
    },
  });
}

module.exports = {
  sanitizeHtmlContent,
  createQuestion,
  listQuestions,
  postAnswer,
  acceptAnswer,
};
