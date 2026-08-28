// ─── Comprehensive Quiz & Assessment Controller ───────────────────

const crypto = require('crypto');
const { getDecryptedKey } = require('./aiApiKey.controller');
const { queryRelevantChunks } = require('../services/vectorStore');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSystemClient } = require('../config/prismaManager');

// In-Memory Background Job Queue Store for AI Quiz Generation
const aiQuizJobs = new Map();

const normalizeText = (str) => {
  if (!str) return '';
  return str.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
};

const isOpenRouterKey = (key) => typeof key === 'string' && key.trim().startsWith('sk-or-');

const generateQuestionsWithAI = async (apiKey, prompt) => {
  if (isOpenRouterKey(apiKey)) {
    const modelsToTry = ['deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'];
    let lastErr = null;

    for (const m of modelsToTry) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`,
            'HTTP-Referer': 'https://academix.edu.pk',
            'X-Title': 'Academix Smart E-Services'
          },
          body: JSON.stringify({
            model: m,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) return content;
        } else {
          const errData = await response.json().catch(() => ({}));
          lastErr = new Error(errData.error?.message || `OpenRouter HTTP ${response.status}`);
        }
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Failed to generate quiz questions via OpenRouter API');
  } else {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastErr = null;

    for (const m of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: m });
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Failed to generate quiz questions via Google Gemini API');
  }
};

const mapQuiz = (q) => {
  if (!q) return null;
  return {
    ...q,
    _id: q.id
  };
};

/**
 * Verify Teacher Assignment (RBAC Helper)
 */
const verifyTeacherAssignment = async (tenantDb, userId, collegeId, subject_id, class_id) => {
  const teacher = await tenantDb.teacher.findFirst({
    where: { user_id: userId, college_id: collegeId }
  });
  if (!teacher) return { valid: false, message: 'Teacher record not found.' };

  // Check subject assignment if provided
  if (subject_id && teacher.subjects && Array.isArray(teacher.subjects) && teacher.subjects.length > 0) {
    // Subject may be ID or name
    const subjectRecord = await tenantDb.subject.findFirst({ where: { id: subject_id } });
    const sName = subjectRecord ? subjectRecord.name : subject_id;
    const isAssigned = teacher.subjects.some(s => s === subject_id || s === sName);
    if (!isAssigned) {
      return { valid: false, message: 'You are not assigned to teach this subject.' };
    }
  }

  return { valid: true, teacher };
};

// ─── 1. Quiz List & Get ───────────────────────────────────────────────────

exports.getQuizzes = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class_id, subject_id, session_id, status } = req.query;
    const userId = req.user.id || req.user._id;

    const where = { college_id: req.collegeId };

    if (req.user.role === 'teacher') {
      where.teacher_id = userId;
    } else if (req.user.role === 'student') {
      const student = await tenantDb.student.findFirst({
        where: { user_id: userId, college_id: req.collegeId }
      });
      if (student) {
        where.class_id = student.class;
        const studentSec = (student.section || student.section_id || '').trim();
        if (studentSec) {
          where.OR = [
            { section_id: null },
            { section_id: '' },
            { section_id: 'all' },
            { section_id: { contains: studentSec, mode: 'insensitive' } }
          ];
        }
      }
      // Students can only see published or active quizzes
      where.status = { in: ['published', 'active'] };
    }

    if (class_id) where.class_id = class_id;
    if (subject_id) where.subject_id = subject_id;
    if (session_id) where.session_id = session_id;
    if (status && req.user.role !== 'student') where.status = status;

    const quizzes = await tenantDb.quiz.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // If student, attach attempt status & strip correct answers/explanations
    if (req.user.role === 'student') {
      let student = await tenantDb.student.findFirst({
        where: { college_id: req.collegeId, OR: [{ user_id: userId }, { id: userId }] }
      });
      if (!student && req.user.email) {
        student = await tenantDb.student.findFirst({
          where: { college_id: req.collegeId, email: req.user.email }
        });
      }

      let attemptsMap = new Map();
      if (student) {
        const studentAttempts = await tenantDb.quizAttempt.findMany({
          where: { student_id: student.id, college_id: req.collegeId },
          orderBy: { createdAt: 'desc' }
        });
        studentAttempts.forEach(a => {
          if (!attemptsMap.has(a.quiz_id)) {
            attemptsMap.set(a.quiz_id, []);
          }
          attemptsMap.get(a.quiz_id).push(a);
        });
      }

      const sanitized = quizzes.map(q => {
        const mapped = mapQuiz(q);
        const qAttempts = attemptsMap.get(q.id) || [];
        const lastAttempt = qAttempts[0] || null;
        const submittedAttempt = qAttempts.find(a => a.status === 'submitted' || a.status === 'passed' || a.status === 'failed');

        mapped.myAttempt = lastAttempt;
        mapped.hasSubmitted = !!submittedAttempt;
        mapped.isCompleted = !!submittedAttempt && (qAttempts.length >= (q.maxAttempts || 1));

        if (mapped.questions && Array.isArray(mapped.questions)) {
          mapped.questions = mapped.questions.map(quest => {
            const { correctAnswer, explanation, ...rest } = quest;
            return rest;
          });
        }
        return mapped;
      });

      return res.json({ success: true, data: sanitized });
    }

    const sanitized = quizzes.map(q => mapQuiz(q));
    res.json({ success: true, data: sanitized });
  } catch (error) {
    next(error);
  }
};

exports.getQuiz = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const q = await tenantDb.quiz.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!q) return res.status(404).json({ success: false, message: 'Quiz not found' });

    if (req.user.role === 'teacher' && q.teacher_id !== userId && !['admin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Unauthorized to view another teacher\'s quiz' });
    }

    const mapped = mapQuiz(q);

    // Strip answers for active student view
    if (req.user.role === 'student' && mapped.questions && Array.isArray(mapped.questions)) {
      mapped.questions = mapped.questions.map(quest => {
        const { correctAnswer, explanation, ...rest } = quest;
        return rest;
      });
    }

    res.json({ success: true, data: mapped });
  } catch (error) {
    next(error);
  }
};

// ─── 2. Manual Quiz Creation & Lifecycle ──────────────────────────────────

exports.createQuiz = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const systemDb = getSystemClient();
    const userId = req.user.id || req.user._id;

    const {
      session_id,
      class_id,
      section_id,
      subject_id,
      title,
      description,
      questions,
      totalMarks,
      duration,
      startTime,
      endTime,
      passingPercentage,
      negativeMarking,
      shuffleQuestions,
      shuffleOptions,
      maxAttempts,
      resultVisibility,
      proctoringConfig,
      chapters,
      topics,
      status
    } = req.body;

    if (req.user.role === 'teacher') {
      const check = await verifyTeacherAssignment(tenantDb, userId, req.collegeId, subject_id, class_id);
      if (!check.valid) return res.status(403).json({ success: false, message: check.message });
    }

    let calculatedTotalMarks = totalMarks ? parseFloat(totalMarks) : 0;
    const processedQuestions = (questions || []).map((q, idx) => {
      const qMarks = q.marks ? parseFloat(q.marks) : 1;
      if (!totalMarks) calculatedTotalMarks += qMarks;
      return {
        id: q.id || `q-${idx + 1}-${Date.now()}`,
        questionText: q.questionText || q.question || '',
        options: Array.isArray(q.options) ? q.options : ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
        correctAnswer: parseInt(q.correctAnswer ?? 0, 10),
        explanation: q.explanation || '',
        marks: qMarks,
        difficulty: q.difficulty || 'medium',
        chapter: q.chapter || null,
        topic: q.topic || null
      };
    });

    const quiz = await tenantDb.$transaction(async (tx) => {
      const created = await tx.quiz.create({
        data: {
          college_id: req.collegeId,
          teacher_id: userId,
          session_id: session_id || 'current',
          class_id,
          section_id: section_id || null,
          subject_id,
          title,
          description: description || '',
          questions: processedQuestions,
          totalMarks: calculatedTotalMarks,
          duration: duration ? parseFloat(duration) : 30,
          startTime: startTime ? new Date(startTime) : null,
          endTime: endTime ? new Date(endTime) : null,
          passingPercentage: passingPercentage ? parseFloat(passingPercentage) : 40,
          negativeMarking: negativeMarking ? parseFloat(negativeMarking) : 0,
          shuffleQuestions: shuffleQuestions || false,
          shuffleOptions: shuffleOptions || false,
          maxAttempts: maxAttempts ? parseInt(maxAttempts, 10) : 1,
          resultVisibility: resultVisibility || 'after_close',
          proctoringConfig: proctoringConfig || { maxViolations: 3, autoSubmitOnMax: true },
          chapters: chapters || null,
          topics: topics || null,
          isAIGenerated: false,
          status: status || 'draft'
        }
      });

      // Save manual questions to QuestionBank
      for (const qObj of processedQuestions) {
        const norm = normalizeText(qObj.questionText);
        const existingQ = await tx.questionBank.findFirst({
          where: { college_id: req.collegeId, normalizedText: norm }
        });

        if (!existingQ) {
          await tx.questionBank.create({
            data: {
              college_id: req.collegeId,
              teacher_id: userId,
              subject_id,
              class: class_id,
              section: section_id || null,
              chapter: qObj.chapter || (chapters ? chapters[0] : null),
              topic: qObj.topic || (topics ? topics[0] : null),
              difficulty: qObj.difficulty || 'medium',
              questionText: qObj.questionText,
              normalizedText: norm,
              options: qObj.options,
              correctAnswer: qObj.correctAnswer,
              explanation: qObj.explanation,
              marks: qObj.marks,
              isAIGenerated: false,
              createdBy: userId
            }
          });
        }
      }

      return created;
    });

    try {
      await systemDb.auditLog.create({
        data: {
          college_id: req.collegeId,
          user_id: userId,
          action: 'create-quiz',
          resource: 'Quiz',
          resourceId: quiz.id,
          details: `Created quiz: ${title}`
        }
      });
    } catch (e) {}

    res.status(201).json({ success: true, data: mapQuiz(quiz) });
  } catch (error) {
    next(error);
  }
};

exports.updateQuiz = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const existing = await tenantDb.quiz.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Quiz not found' });

    if (req.user.role === 'teacher' && existing.teacher_id !== userId && !['admin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Unauthorized to update this quiz' });
    }

    if (existing.status === 'published' || existing.status === 'active') {
      if (req.body.questions) {
        return res.status(400).json({ success: false, message: 'Cannot edit questions of a published/active quiz' });
      }
    }

    const {
      title, description, questions, totalMarks, duration, startTime, endTime,
      passingPercentage, negativeMarking, shuffleQuestions, shuffleOptions,
      maxAttempts, resultVisibility, proctoringConfig, status
    } = req.body;

    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (questions !== undefined) data.questions = questions;
    if (totalMarks !== undefined) data.totalMarks = parseFloat(totalMarks);
    if (duration !== undefined) data.duration = parseFloat(duration);
    if (startTime !== undefined) data.startTime = startTime ? new Date(startTime) : null;
    if (endTime !== undefined) data.endTime = endTime ? new Date(endTime) : null;
    if (passingPercentage !== undefined) data.passingPercentage = parseFloat(passingPercentage);
    if (negativeMarking !== undefined) data.negativeMarking = parseFloat(negativeMarking);
    if (shuffleQuestions !== undefined) data.shuffleQuestions = shuffleQuestions;
    if (shuffleOptions !== undefined) data.shuffleOptions = shuffleOptions;
    if (maxAttempts !== undefined) data.maxAttempts = parseInt(maxAttempts, 10);
    if (resultVisibility !== undefined) data.resultVisibility = resultVisibility;
    if (proctoringConfig !== undefined) data.proctoringConfig = proctoringConfig;
    if (status !== undefined) data.status = status;

    const updated = await tenantDb.quiz.update({
      where: { id },
      data
    });

    res.json({ success: true, data: mapQuiz(updated) });
  } catch (error) {
    next(error);
  }
};

exports.publishQuiz = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const q = await tenantDb.quiz.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!q) return res.status(404).json({ success: false, message: 'Quiz not found' });

    if (req.user.role === 'teacher' && q.teacher_id !== userId && !['admin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (!q.questions || !Array.isArray(q.questions) || q.questions.length === 0) {
      return res.status(400).json({ success: false, message: 'Cannot publish a quiz with 0 questions.' });
    }

    if (q.startTime && q.endTime && new Date(q.endTime) <= new Date(q.startTime)) {
      return res.status(400).json({ success: false, message: 'End time must be after start time.' });
    }

    const published = await tenantDb.$transaction(async (tx) => {
      return await tx.quiz.update({
        where: { id },
        data: { status: 'published' }
      });
    });

    res.json({ success: true, message: 'Quiz published successfully!', data: mapQuiz(published) });
  } catch (error) {
    next(error);
  }
};

exports.deleteQuiz = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const q = await tenantDb.quiz.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!q) return res.status(404).json({ success: false, message: 'Quiz not found' });

    if (req.user.role === 'teacher' && q.teacher_id !== userId && !['admin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this quiz' });
    }

    await tenantDb.quiz.delete({ where: { id } });

    res.json({ success: true, message: 'Quiz deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// ─── 3. Background AI Quiz Generation Job Queue ───────────────────────────

exports.generateAIQuizJob = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const {
      subject_id, subjectName, class_id, section_id, chapters, topics,
      difficulty = 'medium', count = 5, duration = 30, title
    } = req.body;

    if (req.user.role === 'teacher') {
      const check = await verifyTeacherAssignment(tenantDb, userId, req.collegeId, subject_id, class_id);
      if (!check.valid) return res.status(403).json({ success: false, message: check.message });
    }

    const apiKey = await getDecryptedKey(userId);
    if (!apiKey) {
      return res.status(400).json({ success: false, message: 'Please configure your Gemini API key in Settings.' });
    }

    const jobId = `job-quiz-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    aiQuizJobs.set(jobId, {
      jobId,
      status: 'processing',
      progress: 10,
      message: 'Searching Question Bank and index...',
      createdAt: Date.now()
    });

    res.status(202).json({
      success: true,
      message: 'AI Quiz Generation job started',
      data: { jobId, status: 'processing' }
    });

    // ── Non-blocking Worker Execution ──
    (async () => {
      try {
        const questionCountNeeded = parseInt(count, 10) || 5;
        const generatedQuestions = [];

        // Step 1: Check QuestionBank first for existing questions
        const targetChapter = Array.isArray(chapters) && chapters.length > 0 ? chapters[0] : null;
        const targetTopic = Array.isArray(topics) && topics.length > 0 ? topics[0] : null;

        const whereQB = { college_id: req.collegeId };
        if (subject_id) whereQB.subject_id = subject_id;
        if (class_id) whereQB.class = class_id;
        if (difficulty) whereQB.difficulty = difficulty;

        const existingQB = await tenantDb.questionBank.findMany({
          where: whereQB,
          take: questionCountNeeded * 2
        });

        // Randomly pick up to questionCountNeeded
        if (existingQB.length > 0) {
          const shuffled = [...existingQB].sort(() => 0.5 - Math.random());
          const reused = shuffled.slice(0, Math.min(questionCountNeeded, shuffled.length));
          reused.forEach(q => {
            generatedQuestions.push({
              id: q.id,
              questionText: q.questionText,
              options: q.options || ['Option A', 'Option B', 'Option C', 'Option D'],
              correctAnswer: q.correctAnswer || 0,
              explanation: q.explanation || 'Sourced from Question Bank',
              marks: q.marks || 1,
              difficulty: q.difficulty || difficulty,
              sourceDocId: q.sourceDocId,
              isReused: true
            });
          });
        }

        aiQuizJobs.set(jobId, { jobId, status: 'processing', progress: 40, message: 'Retrieving study material context...' });

        // Step 2: Generate remaining missing questions using Gemini
        const missingCount = questionCountNeeded - generatedQuestions.length;
        if (missingCount > 0) {
          let contextText = '';
          try {
            const chunks = await queryRelevantChunks({
              query: `${targetChapter || ''} ${targetTopic || ''} ${subjectName || ''}`,
              collegeId: req.collegeId,
              subject: subjectName || subject_id,
              class: class_id,
              chapter: targetChapter,
              topic: targetTopic,
              apiKey,
              topK: 4
            });
            if (chunks && chunks.length > 0) {
              contextText = chunks.map(c => c.text).join('\n\n---\n\n');
            }
          } catch (err) {}

          aiQuizJobs.set(jobId, { jobId, status: 'processing', progress: 70, message: 'Generating questions with AI...' });

          const difficultyGuidelines = difficulty === 'easy'
            ? 'Focus on direct definitions, basic concepts, and recall.'
            : difficulty === 'hard'
            ? 'Focus on deep analytical reasoning, multi-step problem solving, and complex scenarios.'
            : 'Focus on concept application, understanding, and clear technical scenarios.';

          const prompt = `Generate exactly ${missingCount} Multiple Choice Questions (MCQs) for a college quiz.
Subject: ${subjectName || subject_id || 'General'}
Chapter: ${targetChapter || 'All Chapters'}
Topic: ${targetTopic || 'All Topics'}
Difficulty: ${difficulty.toUpperCase()} (${difficultyGuidelines})
${contextText ? `Reference Study Material Context:\n${contextText}` : ''}

Format your response strictly as a JSON array of objects. Do NOT add any markdown backticks or commentary outside JSON.
JSON Format:
[
  {
    "questionText": "Question string?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": 0,
    "explanation": "Explanation of correct option",
    "marks": 1
  }
]`;

          const resText = await generateQuestionsWithAI(apiKey, prompt);
          const jsonMatch = resText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            for (let i = 0; i < parsed.length; i++) {
              const qItem = parsed[i];
              const norm = normalizeText(qItem.questionText);
              
              // Save new AI question to QuestionBank
              const createdQB = await tenantDb.questionBank.create({
                data: {
                  college_id: req.collegeId,
                  teacher_id: userId,
                  subject_id,
                  subjectName: subjectName || 'General',
                  class: class_id,
                  section: section_id || null,
                  chapter: targetChapter,
                  topic: targetTopic,
                  difficulty,
                  questionText: qItem.questionText,
                  normalizedText: norm,
                  options: qItem.options,
                  correctAnswer: parseInt(qItem.correctAnswer || 0, 10),
                  explanation: qItem.explanation,
                  marks: parseFloat(qItem.marks || 1),
                  isAIGenerated: true,
                  createdBy: userId
                }
              });

              generatedQuestions.push({
                id: createdQB.id,
                questionText: qItem.questionText,
                options: qItem.options,
                correctAnswer: parseInt(qItem.correctAnswer || 0, 10),
                explanation: qItem.explanation,
                marks: parseFloat(qItem.marks || 1),
                difficulty,
                isAIGenerated: true
              });
            }
          }
        }

        // Calculate total marks
        const totalMarksCalc = generatedQuestions.reduce((sum, q) => sum + (q.marks || 1), 0);

        // Step 3: Create Quiz Record in Draft status inside transaction
        const quiz = await tenantDb.$transaction(async (tx) => {
          return await tx.quiz.create({
            data: {
              college_id: req.collegeId,
              teacher_id: userId,
              session_id: 'current',
              class_id,
              section_id: section_id || null,
              subject_id,
              title: title || `AI Quiz - ${targetChapter || targetTopic || subjectName || 'General'}`,
              description: `Generated via AI (${difficulty} level)`,
              questions: generatedQuestions,
              totalMarks: totalMarksCalc,
              duration: parseFloat(duration) || 30,
              chapters: chapters || null,
              topics: topics || null,
              isAIGenerated: true,
              status: 'draft'
            }
          });
        });

        aiQuizJobs.set(jobId, {
          jobId,
          status: 'completed',
          progress: 100,
          message: 'Quiz generated successfully! Preview ready.',
          quizId: quiz.id,
          data: mapQuiz(quiz)
        });

      } catch (jobErr) {
        console.error('AI Generation Worker Error:', jobErr);
        aiQuizJobs.set(jobId, {
          jobId,
          status: 'failed',
          error: jobErr.message || 'Generation failed'
        });
      }
    })();

  } catch (error) {
    next(error);
  }
};

exports.getJobStatus = async (req, res) => {
  const { jobId } = req.params;
  const job = aiQuizJobs.get(jobId);
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
  res.json({ success: true, data: job });
};

// ─── 4. Question Bank Endpoints ───────────────────────────────────────────

exports.getQuestionBank = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { subject_id, class: className, chapter, topic, difficulty, search, page = 1, limit = 20 } = req.query;

    const where = { college_id: req.collegeId };
    if (subject_id) where.subject_id = subject_id;
    if (className) where.class = className;
    if (chapter) where.chapter = chapter;
    if (topic) where.topic = topic;
    if (difficulty) where.difficulty = difficulty;
    if (search) {
      where.questionText = { contains: search, mode: 'insensitive' };
    }

    const take = parseInt(limit, 10) || 20;
    const skip = (parseInt(page, 10) - 1) * take;

    const [total, questions] = await Promise.all([
      tenantDb.questionBank.count({ where }),
      tenantDb.questionBank.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take
      })
    ]);

    res.json({
      success: true,
      data: questions,
      pagination: { total, page: parseInt(page, 10), pages: Math.ceil(total / take) }
    });
  } catch (error) {
    next(error);
  }
};

exports.updateQuestionBankItem = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const existing = await tenantDb.questionBank.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Question not found' });

    const { questionText, options, correctAnswer, explanation, marks, difficulty } = req.body;

    // Create a new version preserving history
    const newVersionNumber = (existing.version || 1) + 1;
    const newQuestion = await tenantDb.questionBank.create({
      data: {
        college_id: req.collegeId,
        teacher_id: existing.teacher_id,
        subject_id: existing.subject_id,
        subjectName: existing.subjectName,
        class: existing.class,
        section: existing.section,
        chapter: existing.chapter,
        topic: existing.topic,
        difficulty: difficulty || existing.difficulty,
        questionText: questionText || existing.questionText,
        normalizedText: normalizeText(questionText || existing.questionText),
        options: options || existing.options,
        correctAnswer: correctAnswer !== undefined ? parseInt(correctAnswer, 10) : existing.correctAnswer,
        explanation: explanation !== undefined ? explanation : existing.explanation,
        marks: marks ? parseFloat(marks) : existing.marks,
        isAIGenerated: existing.isAIGenerated,
        version: newVersionNumber,
        parentQuestionId: existing.id,
        createdBy: existing.createdBy,
        updatedBy: userId
      }
    });

    res.json({ success: true, message: 'Question updated (new version created)', data: newQuestion });
  } catch (error) {
    next(error);
  }
};

// ─── 5. Student Quiz Execution, Resumption & Proctoring ───────────────────

exports.startAttempt = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params; // quizId
    const userId = req.user.id || req.user._id;

    const quiz = await tenantDb.quiz.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

    let student = await tenantDb.student.findFirst({
      where: { college_id: req.collegeId, OR: [{ user_id: userId }, { id: userId }] }
    });
    if (!student && req.user.email) {
      student = await tenantDb.student.findFirst({
        where: { college_id: req.collegeId, email: req.user.email }
      });
    }

    if (!student) {
      if (req.user.role === 'admin' || req.user.role === 'teacher' || req.user.role === 'superAdmin') {
        student = {
          id: userId,
          user_id: userId,
          rollNumber: 'TEST-ADMIN',
          class: quiz.class_id || 'All',
          section: 'all'
        };
      } else {
        return res.status(403).json({
          success: false,
          message: 'Student profile record not found. Please ensure your student account is linked in Administration.'
        });
      }
    }

    if (quiz.status !== 'published' && quiz.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Quiz is not available for attempts.' });
    }

    // Verify student section authorization
    const studentSec = (student.section || student.section_id || '').trim();
    if (quiz.section_id && quiz.section_id !== 'all' && studentSec) {
      const allowedSections = quiz.section_id.split(', ').map(s => s.trim().toLowerCase());
      const isAllowed = allowedSections.some(sec => sec === studentSec.toLowerCase());
      if (!isAllowed) {
        return res.status(403).json({ success: false, message: 'This quiz is not assigned to your section.' });
      }
    }

    const now = new Date();
    if (quiz.startTime && new Date(quiz.startTime) > now) {
      return res.status(400).json({ success: false, message: 'Quiz has not started yet.' });
    }
    if (quiz.endTime && new Date(quiz.endTime) < now) {
      return res.status(400).json({ success: false, message: 'Quiz time window has expired.' });
    }

    // Check existing in_progress attempt for seamless resumption
    let attempt = await tenantDb.quizAttempt.findFirst({
      where: {
        quiz_id: id,
        student_id: student.id,
        college_id: req.collegeId,
        status: 'in_progress'
      }
    });

    if (!attempt) {
      // Check max attempts count
      const totalAttempts = await tenantDb.quizAttempt.count({
        where: { quiz_id: id, student_id: student.id, college_id: req.collegeId }
      });
      if (totalAttempts >= (quiz.maxAttempts || 1)) {
        return res.status(400).json({ success: false, message: `Maximum attempt limit (${quiz.maxAttempts || 1}) reached.` });
      }

      attempt = await tenantDb.quizAttempt.create({
        data: {
          college_id: req.collegeId,
          quiz_id: id,
          student_id: student.id,
          session_id: quiz.session_id,
          attemptNumber: totalAttempts + 1,
          totalMarks: quiz.totalMarks || 0,
          status: 'in_progress',
          answers: {},
          startedAt: now
        }
      });
    }

    // Calculate server remaining time
    const durationSeconds = (quiz.duration || 30) * 60;
    const elapsedSeconds = Math.floor((now.getTime() - new Date(attempt.startedAt).getTime()) / 1000);
    const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);

    // Prepare quiz for student (strip correct answers & explanations)
    const sanitizedQuestions = (quiz.questions || []).map(q => {
      const { correctAnswer, explanation, ...rest } = q;
      return rest;
    });

    res.json({
      success: true,
      data: {
        attemptId: attempt.id,
        quiz: {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          duration: quiz.duration,
          totalMarks: quiz.totalMarks,
          proctoringConfig: quiz.proctoringConfig,
          questions: sanitizedQuestions
        },
        remainingSeconds,
        savedAnswers: attempt.answers || {},
        currentQuestionIndex: attempt.currentQuestionIndex || 0,
        violationsCount: Array.isArray(attempt.violations) ? attempt.violations.length : 0
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.saveAnswer = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { attemptId } = req.params;
    const { answers, currentQuestionIndex, timeSpentSeconds } = req.body;

    const attempt = await tenantDb.quizAttempt.findFirst({
      where: { id: attemptId, college_id: req.collegeId }
    });
    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
    if (attempt.status !== 'in_progress') {
      return res.status(400).json({ success: false, message: 'Attempt is no longer in progress.' });
    }

    await tenantDb.quizAttempt.update({
      where: { id: attemptId },
      data: {
        answers: answers || attempt.answers,
        currentQuestionIndex: currentQuestionIndex !== undefined ? parseInt(currentQuestionIndex, 10) : attempt.currentQuestionIndex,
        timeSpentSeconds: timeSpentSeconds ? parseInt(timeSpentSeconds, 10) : attempt.timeSpentSeconds
      }
    });

    res.json({ success: true, message: 'Progress saved' });
  } catch (error) {
    next(error);
  }
};

exports.logViolation = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { attemptId } = req.params;
    const { type, timestamp } = req.body;

    const attempt = await tenantDb.quizAttempt.findFirst({
      where: { id: attemptId, college_id: req.collegeId }
    });
    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });

    const violations = Array.isArray(attempt.violations) ? attempt.violations : [];
    violations.push({ type: type || 'proctor_event', timestamp: timestamp || new Date().toISOString() });

    const quiz = await tenantDb.quiz.findUnique({ where: { id: attempt.quiz_id } });
    const maxAllowed = quiz?.proctoringConfig?.maxViolations || 3;
    const autoSubmit = quiz?.proctoringConfig?.autoSubmitOnMax !== false;

    let shouldAutoSubmit = false;
    if (violations.length >= maxAllowed && autoSubmit) {
      shouldAutoSubmit = true;
    }

    await tenantDb.quizAttempt.update({
      where: { id: attemptId },
      data: { violations }
    });

    res.json({
      success: true,
      violationsCount: violations.length,
      maxAllowed,
      shouldAutoSubmit
    });
  } catch (error) {
    next(error);
  }
};

exports.submitAttempt = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { attemptId } = req.params;
    const { answers, timeSpentSeconds, isAutoSubmitted } = req.body;

    const attempt = await tenantDb.quizAttempt.findFirst({
      where: { id: attemptId, college_id: req.collegeId }
    });
    if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
    if (attempt.status !== 'in_progress') {
      return res.status(400).json({ success: false, message: 'Attempt already submitted.' });
    }

    const quiz = await tenantDb.quiz.findUnique({ where: { id: attempt.quiz_id } });
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

    const finalAnswers = answers || attempt.answers || {};
    const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    
    let score = 0;
    let totalPossibleMarks = 0;
    const negMarking = quiz.negativeMarking || 0;

    questions.forEach((q, idx) => {
      const qMarks = parseFloat(q.marks || 1);
      totalPossibleMarks += qMarks;
      const selected = finalAnswers[idx] !== undefined ? parseInt(finalAnswers[idx], 10) : null;
      if (selected !== null && selected === parseInt(q.correctAnswer, 10)) {
        score += qMarks;
      } else if (selected !== null && selected !== parseInt(q.correctAnswer, 10) && negMarking > 0) {
        score = Math.max(0, score - negMarking);
      }
    });

    const percentage = totalPossibleMarks > 0 ? Math.round((score / totalPossibleMarks) * 100) : 0;
    const passPercentage = quiz.passingPercentage || 40;
    const passStatus = percentage >= passPercentage ? 'passed' : 'failed';

    const updatedAttempt = await tenantDb.$transaction(async (tx) => {
      return await tx.quizAttempt.update({
        where: { id: attemptId },
        data: {
          score,
          totalMarks: totalPossibleMarks,
          percentage,
          status: passStatus,
          answers: finalAnswers,
          timeSpentSeconds: timeSpentSeconds ? parseInt(timeSpentSeconds, 10) : attempt.timeSpentSeconds,
          isAutoSubmitted: isAutoSubmitted || false,
          submittedAt: new Date()
        }
      });
    });

    // Check if result is immediately visible
    const showResultNow = quiz.resultVisibility === 'immediate' || quiz.isResultsReleased;

    res.json({
      success: true,
      message: 'Quiz submitted successfully!',
      data: {
        score: showResultNow ? score : null,
        totalMarks: showResultNow ? totalPossibleMarks : null,
        percentage: showResultNow ? percentage : null,
        status: showResultNow ? passStatus : 'submitted',
        isResultsReleased: showResultNow
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── 6. Teacher Analytics (100% Zero-AI SQL / Prisma Aggregation) ───────

exports.getQuizAnalytics = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const quiz = await tenantDb.quiz.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

    if (req.user.role === 'teacher' && quiz.teacher_id !== userId && !['admin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Unauthorized to view analytics for this quiz' });
    }

    const attempts = await tenantDb.quizAttempt.findMany({
      where: { quiz_id: id, college_id: req.collegeId, status: { in: ['completed', 'passed', 'failed'] } },
      orderBy: { percentage: 'desc' }
    });

    const totalAttempts = attempts.length;
    if (totalAttempts === 0) {
      return res.json({
        success: true,
        data: {
          quizTitle: quiz.title,
          totalAttempts: 0,
          averageScore: 0,
          highestScore: 0,
          lowestScore: 0,
          medianScore: 0,
          passPercentage: 0,
          failPercentage: 0,
          questionAccuracy: [],
          studentRankings: [],
          violationsSummary: { totalViolations: 0 }
        }
      });
    }

    const scores = attempts.map(a => a.score || 0);
    const highestScore = Math.max(...scores);
    const lowestScore = Math.min(...scores);
    const sumScore = scores.reduce((a, b) => a + b, 0);
    const averageScore = Math.round((sumScore / totalAttempts) * 10);

    const sortedScores = [...scores].sort((a, b) => a - b);
    const medianScore = totalAttempts % 2 === 0
      ? (sortedScores[totalAttempts / 2 - 1] + sortedScores[totalAttempts / 2]) / 2
      : sortedScores[Math.floor(totalAttempts / 2)];

    const passedCount = attempts.filter(a => a.status === 'passed').length;
    const passPercentage = Math.round((passedCount / totalAttempts) * 100);
    const failPercentage = 100 - passPercentage;

    // Question-wise Accuracy & Distractor Analysis
    const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    const questionAccuracy = questions.map((q, idx) => {
      let correctCount = 0;
      const optionCounts = [0, 0, 0, 0, 0]; // count per option index

      attempts.forEach(a => {
        const ansMap = a.answers || {};
        const sel = ansMap[idx] !== undefined ? parseInt(ansMap[idx], 10) : null;
        if (sel !== null && sel >= 0 && sel < 5) {
          optionCounts[sel]++;
          if (sel === parseInt(q.correctAnswer, 10)) {
            correctCount++;
          }
        }
      });

      const accuracy = Math.round((correctCount / totalAttempts) * 100);
      
      // Find most selected wrong option (distractor)
      let mostSelectedDistractor = null;
      let maxDistractorCount = 0;
      optionCounts.forEach((count, optIdx) => {
        if (optIdx !== parseInt(q.correctAnswer, 10) && count > maxDistractorCount) {
          maxDistractorCount = count;
          mostSelectedDistractor = q.options ? q.options[optIdx] : `Option ${optIdx + 1}`;
        }
      });

      return {
        questionIndex: idx + 1,
        questionText: q.questionText,
        correctAnswerIndex: q.correctAnswer,
        accuracyPercentage: accuracy,
        totalCorrect: correctCount,
        totalWrong: totalAttempts - correctCount,
        mostSelectedDistractor: mostSelectedDistractor || 'None'
      };
    });

    // Sort hardest and easiest questions
    const hardestQuestions = [...questionAccuracy].sort((a, b) => a.accuracyPercentage - b.accuracyPercentage).slice(0, 3);
    const easiestQuestions = [...questionAccuracy].sort((a, b) => b.accuracyPercentage - a.accuracyPercentage).slice(0, 3);

    // Resolve student names for ranking table
    const studentIds = [...new Set(attempts.map(a => a.student_id))];
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true, rollNumber: true, class: true, section: true }
    });
    const studentMap = {};
    students.forEach(s => { studentMap[s.id] = s; });

    let totalViolations = 0;
    const studentRankings = attempts.map((a, rank) => {
      const st = studentMap[a.student_id] || {};
      const vCount = Array.isArray(a.violations) ? a.violations.length : 0;
      totalViolations += vCount;
      return {
        rank: rank + 1,
        attemptId: a.id,
        studentName: st.name || 'Student',
        rollNumber: st.rollNumber || 'N/A',
        score: a.score,
        totalMarks: a.totalMarks,
        percentage: a.percentage,
        status: a.status,
        timeSpentSeconds: a.timeSpentSeconds,
        violationsCount: vCount,
        submittedAt: a.submittedAt
      };
    });

    res.json({
      success: true,
      data: {
        quizTitle: quiz.title,
        resultVisibility: quiz.resultVisibility,
        isResultsReleased: quiz.isResultsReleased || false,
        totalAttempts,
        averageScore,
        highestScore,
        lowestScore,
        medianScore,
        passPercentage,
        failPercentage,
        questionAccuracy,
        hardestQuestions,
        easiestQuestions,
        studentRankings,
        violationsSummary: { totalViolations }
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.releaseResults = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const userId = req.user.id || req.user._id;

    const quiz = await tenantDb.quiz.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

    if (req.user.role === 'teacher' && quiz.teacher_id !== userId && !['admin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const updated = await tenantDb.quiz.update({
      where: { id },
      data: { isResultsReleased: true }
    });

    res.json({ success: true, message: 'Quiz results released to students!', data: mapQuiz(updated) });
  } catch (error) {
    next(error);
  }
};
