const forumService = require('../services/forumService');

/**
 * Class Discussion & Q&A Forum Controller (N31)
 */

async function createQuestion(req, res) {
  try {
    const q = await forumService.createQuestion({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      subjectId: req.body.subjectId,
      className: req.body.className || req.body.class,
      studentId: req.body.studentId || req.user.id,
      title: req.body.title,
      body: req.body.body,
    });
    return res.status(201).json({ success: true, data: q });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function listQuestions(req, res) {
  try {
    const list = await forumService.listQuestions(req.collegeId, {
      subjectId: req.query.subjectId,
      className: req.query.class || req.query.className,
    });
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function postAnswer(req, res) {
  try {
    const ans = await forumService.postAnswer({
      questionId: req.params.id,
      authorId: req.user.id,
      authorRole: ['teacher', 'principal', 'admin'].includes(req.user.role) ? 'teacher' : 'student',
      body: req.body.body,
    });
    return res.status(201).json({ success: true, data: ans });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function acceptAnswer(req, res) {
  try {
    const ans = await forumService.acceptAnswer({
      questionId: req.params.id,
      answerId: req.params.answerId,
      userRole: req.user.role,
    });
    return res.json({ success: true, data: ans });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

module.exports = {
  createQuestion,
  listQuestions,
  postAnswer,
  acceptAnswer,
};

