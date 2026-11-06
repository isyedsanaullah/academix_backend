const clubService = require('../services/clubService');

/**
 * Clubs & Sports Controller (N33)
 */

async function createClub(req, res) {
  try {
    const club = await clubService.createClub({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      name: req.body.name,
      category: req.body.category,
      description: req.body.description,
      leadTeacherId: req.body.leadTeacherId || req.user.id,
      presidentStudentId: req.body.presidentStudentId,
    });
    return res.status(201).json({ success: true, data: club });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function addClubMember(req, res) {
  try {
    const member = await clubService.addClubMember({
      clubId: req.params.id,
      studentId: req.body.studentId,
      role: req.body.role,
    });
    return res.status(201).json({ success: true, data: member });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function scheduleClubEvent(req, res) {
  try {
    const event = await clubService.scheduleClubEvent({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      clubId: req.params.id,
      title: req.body.title,
      eventDate: req.body.eventDate,
      venue: req.body.venue,
      description: req.body.description,
      budgetPkr: req.body.budgetPkr,
    });
    return res.status(201).json({ success: true, data: event });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function listClubs(req, res) {
  try {
    const clubs = await clubService.listClubs(req.collegeId, req.campusId);
    return res.json({ success: true, data: clubs });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

module.exports = {
  createClub,
  addClubMember,
  scheduleClubEvent,
  listClubs,
};

