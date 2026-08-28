// ─── Evaluation Controller (Multi-DB with Prisma) ───────────────────
const { getSystemClient } = require('../config/prismaManager');

// ═══ PRINCIPAL: Announce/manage evaluation seasons ═══
exports.createSeason = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const startDate = new Date(req.body.startDate || Date.now());
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    const season = await tenantDb.evaluationSeason.create({
      data: {
        college_id: req.collegeId,
        title: req.body.title || 'Teacher Evaluation',
        startDate,
        endDate,
        status: 'active',
        announcedBy: req.user._id
      }
    });

    res.status(201).json({
      success: true,
      data: {
        ...season,
        _id: season.id
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getSeasons = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const seasons = await tenantDb.evaluationSeason.findMany({
      where: { college_id: req.collegeId },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = seasons.map(s => ({
      ...s,
      _id: s.id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

// ═══ STUDENT: Get teachers to evaluate + submit evaluation ═══
exports.getMyEvaluations = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;

    const season = await tenantDb.evaluationSeason.findFirst({
      where: { college_id: req.collegeId, status: 'active' }
    });
    if (!season) {
      return res.json({ success: true, data: [], season: null, message: 'No active evaluation' });
    }

    const student = await tenantDb.student.findFirst({
      where: { user_id: req.user._id, college_id: req.collegeId }
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found' });
    }

    let teachers = [];
    let subjectMap = {};

    try {
      const subjects = await tenantDb.subject.findMany({
        where: {
          college_id: req.collegeId,
          class: student.class,
          section: student.section
        }
      });
      const teacherIds = [...new Set(subjects.map(s => s.teacher_id).filter(Boolean))];
      if (teacherIds.length > 0) {
        const teacherRecords = await tenantDb.teacher.findMany({
          where: { id: { in: teacherIds }, college_id: req.collegeId }
        });
        const userIds = teacherRecords.map(tr => tr.user_id).filter(Boolean);
        const teacherUsers = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true }
        });
        const userMap = new Map(teacherUsers.map(u => [u.id, u]));

        teachers = teacherRecords
          .filter(t => userMap.has(t.user_id))
          .map(t => {
            const user = userMap.get(t.user_id);
            return {
              _id: user.id,
              name: user.name
            };
          });

        subjects.forEach(s => {
          if (s.teacher_id) {
            const matchedTeacher = teacherRecords.find(tr => tr.id === s.teacher_id);
            if (matchedTeacher) {
              subjectMap[matchedTeacher.user_id] = s.name;
            } else {
              subjectMap[s.teacher_id] = s.name;
            }
          }
        });
      }
    } catch (err) {
      console.error(err);
    }

    // Fallback: all teachers in college
    if (teachers.length === 0) {
      const allTeachers = await prisma.user.findMany({
        where: { college_id: req.collegeId, role: 'teacher', isActive: true },
        select: { id: true, name: true }
      });
      teachers = allTeachers.map(t => ({ _id: t.id, name: t.name }));
    }

    // Check which are already completed
    const done = await tenantDb.evaluation.findMany({
      where: {
        college_id: req.collegeId,
        season_id: season.id,
        student_id: req.user._id
      }
    });
    const doneMap = {};
    done.forEach(d => {
      doneMap[d.teacher_id] = d;
    });

    const list = teachers.map(t => ({
      teacher_id: t._id,
      name: t.name,
      subject: subjectMap[t._id] || 'General',
      completed: !!doneMap[t._id],
      stars: doneMap[t._id]?.stars || 0
    }));

    res.json({
      success: true,
      data: list,
      season: {
        _id: season.id,
        title: season.title,
        endDate: season.endDate
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.submitEvaluation = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { teacher_id, questions } = req.body; // questions: [{question, answer}]

    const season = await tenantDb.evaluationSeason.findFirst({
      where: { college_id: req.collegeId, status: 'active' }
    });
    if (!season) {
      return res.status(400).json({ success: false, message: 'No active evaluation season' });
    }
    if (new Date() > new Date(season.endDate)) {
      return res.status(400).json({ success: false, message: 'Evaluation deadline passed' });
    }

    const existing = await tenantDb.evaluation.findFirst({
      where: {
        college_id: req.collegeId,
        season_id: season.id,
        student_id: req.user._id,
        teacher_id
      }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Already evaluated this teacher' });
    }

    // Calculate stars and goodCount (replicate legacy Mongoose hook)
    const qArray = Array.isArray(questions) ? questions : [];
    const goodCount = qArray.filter(q => q.answer === 'good').length;
    const stars = Math.min(5, Math.floor(goodCount / 3));

    const evaluation = await tenantDb.evaluation.create({
      data: {
        college_id: req.collegeId,
        season_id: season.id,
        student_id: req.user._id,
        teacher_id,
        questions: questions || null,
        goodCount,
        stars: parseFloat(stars),
        completed: true,
        completedAt: new Date()
      }
    });

    res.status(201).json({
      success: true,
      data: {
        stars: evaluation.stars,
        goodCount: evaluation.goodCount
      }
    });
  } catch (error) {
    next(error);
  }
};

// ═══ Get teacher star ratings (public within college) ═══
exports.getTeacherRatings = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;

    const evaluations = await tenantDb.evaluation.findMany({
      where: { college_id: req.collegeId, completed: true },
      select: { teacher_id: true, stars: true }
    });

    const teacherStats = {};
    for (const e of evaluations) {
      if (!teacherStats[e.teacher_id]) {
        teacherStats[e.teacher_id] = { totalStars: 0, count: 0 };
      }
      teacherStats[e.teacher_id].totalStars += e.stars || 0;
      teacherStats[e.teacher_id].count += 1;
    }

    const teacherIds = Object.keys(teacherStats);
    const teachers = await prisma.user.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, name: true, email: true }
    });

    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    const result = teacherIds.map(tid => {
      const stats = teacherStats[tid];
      const user = teacherMap.get(tid);
      const avgStars = stats.count > 0 ? (stats.totalStars / stats.count) : 0;
      return {
        teacher_id: tid,
        name: user?.name || 'Unknown',
        avgStars: Math.round(avgStars * 10) / 10,
        totalEvaluations: stats.count
      };
    }).sort((a, b) => b.avgStars - a.avgStars);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// Generate 15 AI evaluation questions
exports.generateQuestions = async (req, res, next) => {
  try {
    const questions = [
      "Does the teacher explain concepts clearly?",
      "Is the teacher punctual and regular in class?",
      "Does the teacher encourage student participation?",
      "Is the teacher available for doubt resolution?",
      "Does the teacher use practical examples?",
      "Is the teacher fair in grading and assessment?",
      "Does the teacher maintain discipline in class?",
      "Is the course material well organized?",
      "Does the teacher show enthusiasm for the subject?",
      "Is the teacher respectful towards students?",
      "Does the teacher provide helpful feedback on work?",
      "Is the teaching pace appropriate?",
      "Does the teacher use modern teaching methods?",
      "Is the teacher approachable outside class hours?",
      "Overall, would you rate this teacher positively?"
    ];
    res.json({ success: true, data: questions });
  } catch (error) {
    next(error);
  }
};

