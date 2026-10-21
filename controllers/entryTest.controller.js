// controllers/entryTest.controller.js
// Phase 10: Entry-test preparation (MCQ bank, Mock tests, Ranking with ties, Aggregate calculator, Registrations)

const { getSystemClient, getTenantClient } = require('../config/prismaManager');

/**
 * -----------------------------------------------------------------------------
 * 1. MCQ Question Bank
 * -----------------------------------------------------------------------------
 */

// GET /api/entry-test/mcq
async function getMcqQuestions(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { subject, class: className, chapter, difficulty, tag, search } = req.query;

    const where = { college_id: req.collegeId, isActive: true };
    if (subject) where.subject = subject;
    if (className) where.class = className;
    if (chapter) where.chapter = chapter;
    if (difficulty) where.difficulty = difficulty;
    if (tag) where.tags = { has: tag };
    if (search) where.text = { contains: search, mode: 'insensitive' };

    const questions = await tenantDb.mcqQuestion.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, count: questions.length, data: questions });
  } catch (err) {
    next(err);
  }
}

// POST /api/entry-test/mcq
async function createMcqQuestion(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const {
      subject,
      class: className,
      chapter,
      topic,
      text,
      options,
      answerIndex,
      explanation,
      difficulty,
      tags,
      source
    } = req.body;

    if (!subject || !text || !Array.isArray(options) || answerIndex === undefined) {
      return res.status(400).json({ error: 'Subject, text, options array, and answerIndex are required' });
    }

    const question = await tenantDb.mcqQuestion.create({
      data: {
        college_id: req.collegeId,
        subject,
        class: className,
        chapter,
        topic,
        text,
        options,
        answerIndex: Number(answerIndex),
        explanation,
        difficulty: difficulty || 'medium',
        tags: Array.isArray(tags) ? tags : [],
        source: source || 'manual',
        createdBy: req.user?.email || 'admin'
      }
    });

    res.status(201).json({ success: true, data: question });
  } catch (err) {
    next(err);
  }
}

// PUT /api/entry-test/mcq/:id
async function updateMcqQuestion(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id } = req.params;

    const updated = await tenantDb.mcqQuestion.update({
      where: { id },
      data: req.body
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/entry-test/mcq/:id
async function deleteMcqQuestion(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id } = req.params;

    await tenantDb.mcqQuestion.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Question deleted' });
  } catch (err) {
    next(err);
  }
}

/**
 * -----------------------------------------------------------------------------
 * 2. Mock Test Management
 * -----------------------------------------------------------------------------
 */

// GET /api/entry-test/mock-tests
async function getMockTests(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { session_id, tag, status } = req.query;

    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (tag) where.tag = tag;
    if (status) where.status = status;

    const tests = await tenantDb.mockTest.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: tests });
  } catch (err) {
    next(err);
  }
}

// POST /api/entry-test/mock-tests
async function createMockTest(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const {
      session_id,
      title,
      series,
      tag,
      testDate,
      questionIds,
      totalMarks,
      negativeMark,
      markingMode,
      answerKey
    } = req.body;

    if (!session_id || !title || !tag) {
      return res.status(400).json({ error: 'session_id, title, and tag (e.g. mdcat/ecat) are required' });
    }

    const test = await tenantDb.mockTest.create({
      data: {
        college_id: req.collegeId,
        session_id,
        title,
        series,
        tag,
        testDate: testDate ? new Date(testDate) : null,
        questionIds: Array.isArray(questionIds) ? questionIds : [],
        totalMarks: totalMarks !== undefined ? Number(totalMarks) : null,
        negativeMark: negativeMark !== undefined ? Number(negativeMark) : 0,
        markingMode: markingMode || 'manual',
        answerKey: answerKey || null,
        status: 'draft',
        createdBy: req.user?.email || 'admin'
      }
    });

    res.status(201).json({ success: true, data: test });
  } catch (err) {
    next(err);
  }
}

// GET /api/entry-test/mock-tests/:id
async function getMockTestById(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id } = req.params;

    const test = await tenantDb.mockTest.findUnique({
      where: { id }
    });
    if (!test) return res.status(404).json({ error: 'Mock test not found' });

    let questions = [];
    if (test.questionIds && test.questionIds.length > 0) {
      questions = await tenantDb.mcqQuestion.findMany({
        where: { id: { in: test.questionIds } }
      });
    }

    res.json({ success: true, data: { ...test, questions } });
  } catch (err) {
    next(err);
  }
}

/**
 * -----------------------------------------------------------------------------
 * 3. Mock Marking & Attempt Recording
 * -----------------------------------------------------------------------------
 */

// POST /api/entry-test/mock-tests/:id/attempt
async function submitMockAttempt(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id: mock_id } = req.params;
    const { student_id, answers, score, correct, wrong, skipped, source = 'manual' } = req.body;

    if (!student_id) {
      return res.status(400).json({ error: 'student_id is required' });
    }

    const mock = await tenantDb.mockTest.findUnique({ where: { id: mock_id } });
    if (!mock) return res.status(404).json({ error: 'Mock test not found' });

    let calculatedScore = score !== undefined ? Number(score) : 0;
    let numCorrect = correct !== undefined ? Number(correct) : 0;
    let numWrong = wrong !== undefined ? Number(wrong) : 0;
    let numSkipped = skipped !== undefined ? Number(skipped) : 0;

    // If online submission with answers and answerKey available, auto-grade
    if (source === 'online' && answers && typeof answers === 'object') {
      let qIds = mock.questionIds || [];
      let questions = [];
      if (qIds.length > 0) {
        questions = await tenantDb.mcqQuestion.findMany({ where: { id: { in: qIds } } });
      }

      numCorrect = 0;
      numWrong = 0;
      numSkipped = 0;

      for (const q of questions) {
        const studentAns = answers[q.id];
        if (studentAns === undefined || studentAns === null || studentAns === '') {
          numSkipped++;
        } else if (Number(studentAns) === q.answerIndex) {
          numCorrect++;
        } else {
          numWrong++;
        }
      }

      const neg = Number(mock.negativeMark) || 0;
      calculatedScore = Math.max(0, numCorrect * 1 - numWrong * neg);
    }

    const attempt = await tenantDb.mockAttempt.upsert({
      where: {
        college_id_mock_id_student_id: {
          college_id: req.collegeId,
          mock_id,
          student_id
        }
      },
      update: {
        answers: answers || null,
        score: calculatedScore,
        correct: numCorrect,
        wrong: numWrong,
        skipped: numSkipped,
        source
      },
      create: {
        college_id: req.collegeId,
        session_id: mock.session_id,
        mock_id,
        student_id,
        answers: answers || null,
        score: calculatedScore,
        correct: numCorrect,
        wrong: numWrong,
        skipped: numSkipped,
        source
      }
    });

    res.json({ success: true, data: attempt });
  } catch (err) {
    next(err);
  }
}

// POST /api/entry-test/mock-tests/:id/omr (Planned feature - returns 501)
async function recordOmrScan(req, res) {
  return res.status(501).json({
    code: 'NOT_BUILT',
    message: 'OMR scanning is planned for a future release. Please use manual or online marking modes.'
  });
}

/**
 * -----------------------------------------------------------------------------
 * 4. Ranking per Section & College (with Ties Handling)
 * -----------------------------------------------------------------------------
 */

// GET /api/entry-test/mock-tests/:id/rankings
async function getMockRankings(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id: mock_id } = req.params;

    const mock = await tenantDb.mockTest.findUnique({ where: { id: mock_id } });
    if (!mock) return res.status(404).json({ error: 'Mock test not found' });

    // Fetch all attempts for this mock test
    const attempts = await tenantDb.mockAttempt.findMany({
      where: { college_id: req.collegeId, mock_id },
      orderBy: { score: 'desc' }
    });

    if (attempts.length === 0) {
      return res.json({ success: true, count: 0, rankings: [] });
    }

    // Fetch student section metadata for section ranking
    const studentIds = attempts.map(a => a.student_id);
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true, rollNumber: true, section_id: true }
    });
    const studentMap = new Map(students.map(s => [s.id, s]));

    // Compute College Ranking handling ties (standard competition ranking: 1, 2, 2, 4...)
    let currentRank = 1;
    let prevScore = null;
    let rankOffset = 0;

    const rankedCollegeAttempts = attempts.map((att, idx) => {
      const score = att.score ?? 0;
      if (prevScore !== null && score === prevScore) {
        // Tie: keep the same rank
        rankOffset++;
      } else {
        currentRank = idx + 1;
        rankOffset = 0;
        prevScore = score;
      }
      return {
        ...att,
        rankCollege: currentRank,
        student: studentMap.get(att.student_id) || null
      };
    });

    // Compute Section Rankings handling ties per section
    const bySection = new Map();
    for (const att of rankedCollegeAttempts) {
      const secId = att.student?.section_id || 'unassigned';
      if (!bySection.has(secId)) bySection.set(secId, []);
      bySection.get(secId).push(att);
    }

    for (const [secId, secAttempts] of bySection.entries()) {
      let secRank = 1;
      let secPrevScore = null;
      secAttempts.forEach((att, idx) => {
        const score = att.score ?? 0;
        if (secPrevScore !== null && score === secPrevScore) {
          att.rankSection = secRank;
        } else {
          secRank = idx + 1;
          secPrevScore = score;
          att.rankSection = secRank;
        }
      });
    }

    // Persist calculated ranks back to DB
    for (const att of rankedCollegeAttempts) {
      await tenantDb.mockAttempt.update({
        where: { id: att.id },
        data: {
          rankCollege: att.rankCollege,
          rankSection: att.rankSection
        }
      });
    }

    res.json({
      success: true,
      mockTitle: mock.title,
      totalAttempts: rankedCollegeAttempts.length,
      rankings: rankedCollegeAttempts
    });
  } catch (err) {
    next(err);
  }
}

/**
 * -----------------------------------------------------------------------------
 * 5. Aggregate Calculator
 * -----------------------------------------------------------------------------
 */

// GET /api/entry-test/aggregate-formulas
async function getAggregateFormulas(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const formulas = await tenantDb.aggregateFormula.findMany({
      where: { college_id: req.collegeId, isActive: true }
    });
    res.json({ success: true, data: formulas });
  } catch (err) {
    next(err);
  }
}

// POST /api/entry-test/aggregate-formulas
async function createAggregateFormula(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { name, program, weights, year } = req.body;

    if (!name || !program || !weights) {
      return res.status(400).json({ error: 'Name, program, and weights are required' });
    }

    const formula = await tenantDb.aggregateFormula.create({
      data: {
        college_id: req.collegeId,
        name,
        program,
        weights,
        year: year ? Number(year) : new Date().getFullYear()
      }
    });

    res.status(201).json({ success: true, data: formula });
  } catch (err) {
    next(err);
  }
}

// POST /api/entry-test/calculate-aggregate
// Accepts: { weights: { matric: 10, fsc: 40, entryTest: 50 }, matricObtained, matricTotal, fscObtained, fscTotal, entryTestObtained, entryTestTotal }
function calculateAggregate(req, res) {
  const {
    weights = { matric: 10, fsc: 40, entryTest: 50 },
    matricObtained,
    matricTotal = 1100,
    fscObtained,
    fscTotal = 1100,
    entryTestObtained,
    entryTestTotal = 200
  } = req.body;

  if (matricObtained === undefined || fscObtained === undefined || entryTestObtained === undefined) {
    return res.status(400).json({ error: 'matricObtained, fscObtained, and entryTestObtained are required' });
  }

  const pMatric = (Number(matricObtained) / Number(matricTotal)) * 100;
  const pFsc = (Number(fscObtained) / Number(fscTotal)) * 100;
  const pEntry = (Number(entryTestObtained) / Number(entryTestTotal)) * 100;

  const wMatric = Number(weights.matric) || 0;
  const wFsc = Number(weights.fsc) || 0;
  const wEntry = Number(weights.entryTest) || 0;
  const totalWeight = wMatric + wFsc + wEntry || 100;

  const aggregate = (pMatric * wMatric + pFsc * wFsc + pEntry * wEntry) / totalWeight;

  return res.json({
    success: true,
    aggregate: Number(aggregate.toFixed(4)),
    breakdown: {
      matricPercentage: Number(pMatric.toFixed(2)),
      fscPercentage: Number(pFsc.toFixed(2)),
      entryTestPercentage: Number(pEntry.toFixed(2)),
      weightsUsed: { matric: wMatric, fsc: wFsc, entryTest: wEntry }
    }
  });
}

/**
 * -----------------------------------------------------------------------------
 * 6. Entry-Test & University Application Tracking
 * -----------------------------------------------------------------------------
 */

// GET /api/entry-test/registrations
async function getRegistrations(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { session_id, student_id, testName, status } = req.query;

    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (student_id) where.student_id = student_id;
    if (testName) where.testName = testName;
    if (status) where.status = status;

    const regs = await tenantDb.entryTestRegistration.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, count: regs.length, data: regs });
  } catch (err) {
    next(err);
  }
}

// POST /api/entry-test/registrations
async function createRegistration(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { session_id, student_id, testName, registrationNo, testDate, score, status, applications } = req.body;

    if (!session_id || !student_id || !testName) {
      return res.status(400).json({ error: 'session_id, student_id, and testName are required' });
    }

    const reg = await tenantDb.entryTestRegistration.create({
      data: {
        college_id: req.collegeId,
        session_id,
        student_id,
        testName,
        registrationNo,
        testDate: testDate ? new Date(testDate) : null,
        score: score !== undefined ? Number(score) : null,
        status: status || 'planned',
        applications: Array.isArray(applications) ? applications : []
      }
    });

    res.status(201).json({ success: true, data: reg });
  } catch (err) {
    next(err);
  }
}

// PUT /api/entry-test/registrations/:id
async function updateRegistration(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id } = req.params;

    const updated = await tenantDb.entryTestRegistration.update({
      where: { id },
      data: req.body
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMcqQuestions,
  createMcqQuestion,
  updateMcqQuestion,
  deleteMcqQuestion,
  getMockTests,
  createMockTest,
  getMockTestById,
  submitMockAttempt,
  recordOmrScan,
  getMockRankings,
  getAggregateFormulas,
  createAggregateFormula,
  calculateAggregate,
  getRegistrations,
  createRegistration,
  updateRegistration
};
