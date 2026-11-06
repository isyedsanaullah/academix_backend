const noticeTemplateService = require('../services/noticeTemplateService');

/**
 * Notice Templates Controller (N21)
 */

async function createTemplate(req, res) {
  try {
    const template = await noticeTemplateService.createTemplate({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      title: req.body.title,
      category: req.body.category,
      bodyTemplate: req.body.bodyTemplate,
      defaultAudience: req.body.defaultAudience,
      isSystemPreseeded: req.body.isSystemPreseeded,
    });
    return res.status(201).json({ success: true, data: template });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function listTemplates(req, res) {
  try {
    const templates = await noticeTemplateService.listTemplates(req.collegeId, req.query.category);
    return res.json({ success: true, data: templates });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function dispatchFromTemplate(req, res) {
  try {
    const result = await noticeTemplateService.dispatchFromTemplate({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      templateId: req.params.id,
      recipients: req.body.recipients || [],
      scheduledFor: req.body.scheduledFor,
      createdById: req.user.id,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

module.exports = {
  createTemplate,
  listTemplates,
  dispatchFromTemplate,
};

