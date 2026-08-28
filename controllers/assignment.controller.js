// ─── Assignment Controller (Multi-DB with Prisma) ───────────────────
const { getDecryptedKey } = require('./aiApiKey.controller');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSystemClient } = require('../config/prismaManager');

exports.getAssignments = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class_id, section_id, subject_id, session_id, status } = req.query;
    const where = { college_id: req.collegeId };
    
    if (class_id) where.class_id = class_id;
    if (section_id) where.section_id = section_id;
    if (subject_id) where.subject_id = subject_id;
    if (session_id) where.session_id = session_id;
    if (status) where.status = status;
    if (req.user.role === 'teacher') where.teacher_id = req.user._id;

    const assignments = await tenantDb.assignment.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    const formatted = assignments.map(a => ({
      ...a,
      _id: a.id,
      submissions: a.submissions || []
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.getAssignment = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const a = await tenantDb.assignment.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!a) return res.status(404).json({ success: false, message: 'Assignment not found' });
    
    res.json({
      success: true,
      data: {
        ...a,
        _id: a.id,
        submissions: a.submissions || []
      }
    });
  } catch (error) { next(error); }
};

exports.createAssignment = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, class_id, section_id, subject_id, title, description, instructions, dueDate, totalMarks, submissionType, attachments, status } = req.body;
    
    const data = {
      college_id: req.collegeId,
      teacher_id: req.user._id,
      title,
      description,
      instructions,
      dueDate: new Date(dueDate),
      totalMarks: totalMarks ? parseFloat(totalMarks) : null,
      submissionType,
      attachments: attachments || null,
      status: status || 'active',
      submissions: []
    };

    if (session_id) data.session_id = session_id;
    if (class_id) data.class_id = class_id;
    if (section_id) data.section_id = section_id;
    if (subject_id) data.subject_id = subject_id;

    const a = await tenantDb.assignment.create({ data });
    
    res.status(201).json({
      success: true,
      data: {
        ...a,
        _id: a.id,
        submissions: a.submissions || []
      }
    });
  } catch (error) { next(error); }
};

exports.updateAssignment = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const updateData = { ...req.body };
    if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate);
    if (updateData.totalMarks !== undefined) updateData.totalMarks = updateData.totalMarks ? parseFloat(updateData.totalMarks) : null;
    
    // Remove read-only properties
    delete updateData.id;
    delete updateData.college_id;
    delete updateData.teacher_id;
    
    // First verify it exists and belongs to the college
    const existing = await tenantDb.assignment.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Assignment not found' });

    const a = await tenantDb.assignment.update({
      where: { id: req.params.id },
      data: updateData
    });

    res.json({
      success: true,
      data: {
        ...a,
        _id: a.id,
        submissions: a.submissions || []
      }
    });
  } catch (error) { next(error); }
};

exports.submitAssignment = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { fileUrl, fileName, remarks } = req.body;

    const student = await tenantDb.student.findFirst({
      where: { college_id: req.collegeId, user_id: req.user._id }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });

    const a = await tenantDb.assignment.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!a) return res.status(404).json({ success: false, message: 'Assignment not found' });

    const studentId = student.id;
    let submissions = a.submissions || [];
    if (!Array.isArray(submissions)) submissions = [];

    const existingIndex = submissions.findIndex(s => s.student_id === studentId);
    const isLate = new Date() > new Date(a.dueDate);

    if (existingIndex > -1) {
      submissions[existingIndex] = {
        ...submissions[existingIndex],
        fileUrl,
        fileName: fileName || '',
        remarks,
        submittedAt: new Date(),
        status: isLate ? 'late' : 'submitted'
      };
    } else {
      submissions.push({
        student_id: studentId,
        fileUrl,
        fileName: fileName || '',
        remarks,
        submittedAt: new Date(),
        status: isLate ? 'late' : 'submitted'
      });
    }

    const updated = await tenantDb.assignment.update({
      where: { id: a.id },
      data: { submissions }
    });

    res.json({
      success: true,
      data: {
        ...updated,
        _id: updated.id,
        submissions: updated.submissions || []
      }
    });
  } catch (error) { next(error); }
};

exports.gradeSubmission = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { student_id, obtainedMarks, remarks } = req.body;
    const a = await tenantDb.assignment.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!a) return res.status(404).json({ success: false, message: 'Assignment not found' });

    let submissions = a.submissions || [];
    if (!Array.isArray(submissions)) submissions = [];

    const subIndex = submissions.findIndex(s => s.student_id === student_id);
    if (subIndex === -1) return res.status(404).json({ success: false, message: 'Submission not found' });

    submissions[subIndex] = {
      ...submissions[subIndex],
      obtainedMarks: obtainedMarks !== undefined ? parseFloat(obtainedMarks) : submissions[subIndex].obtainedMarks,
      remarks: remarks || submissions[subIndex].remarks,
      status: 'graded'
    };

    const updated = await tenantDb.assignment.update({
      where: { id: a.id },
      data: { submissions }
    });

    res.json({
      success: true,
      data: {
        ...updated,
        _id: updated.id,
        submissions: updated.submissions || []
      }
    });
  } catch (error) { next(error); }
};

exports.aiGradeSubmission = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const systemDb = getSystemClient();
    const { student_id } = req.body;

    const a = await tenantDb.assignment.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!a) return res.status(404).json({ success: false, message: 'Assignment not found' });

    let submissions = a.submissions || [];
    if (!Array.isArray(submissions)) submissions = [];

    const subIndex = submissions.findIndex(s => s.student_id === student_id);
    if (subIndex === -1) return res.status(404).json({ success: false, message: 'Submission not found' });

    const sub = submissions[subIndex];

    if (sub.aiGradedAt && (Date.now() - new Date(sub.aiGradedAt).getTime()) < 3600000) {
      return res.json({
        success: true, cached: true,
        data: { aiMarks: sub.aiMarks, aiFeedback: sub.aiFeedback, aiIsGenerated: sub.aiIsGenerated, aiConfidence: sub.aiConfidence, aiMissingPoints: sub.aiMissingPoints }
      });
    }

    const apiKey = await getDecryptedKey(req.user._id);
    if (!apiKey) return res.status(400).json({ success: false, message: 'No AI API key configured. Go to Settings → AI API Key.' });

    const startTime = Date.now();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const prompt = `You are an assignment grading assistant. Grade this student submission.\n\nASSIGNMENT: "${a.title}"\nDESCRIPTION: ${a.description || 'N/A'}\nTOTAL MARKS: ${a.totalMarks}\nSTUDENT REMARKS: ${sub.remarks || 'None'}\nSUBMITTED FILE: ${sub.fileUrl || 'No file'}\n\nRespond in EXACT JSON format (no markdown):\n{"marks":<number 0-${a.totalMarks}>,"feedback":"<2-3 sentence feedback>","isAiGenerated":<true/false>,"confidence":<0-100>,"missingPoints":["<point1>","<point2>"]}\n\nKeep response under 200 tokens.`;

    try {
      const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
      const text = result.response.text().trim();
      let parsed;
      try {
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        parsed = { marks: 0, feedback: 'AI could not grade this submission.', isAiGenerated: null, confidence: 0, missingPoints: [] };
      }

      const aiMarks = Math.min(parsed.marks || 0, a.totalMarks || 0);
      const aiFeedback = parsed.feedback || '';
      const aiIsGenerated = parsed.isAiGenerated ?? null;
      const aiConfidence = parsed.confidence ?? 0;
      const aiMissingPoints = (parsed.missingPoints || []).slice(0, 5);

      submissions[subIndex] = {
        ...sub,
        aiMarks,
        aiFeedback,
        aiIsGenerated,
        aiConfidence,
        aiMissingPoints,
        aiGradedAt: new Date(),
        status: 'ai-graded'
      };

      const updated = await tenantDb.assignment.update({
        where: { id: a.id },
        data: { submissions }
      });

      try {
        await systemDb.aIUsageLog.create({
          data: {
            userId: req.user._id,
            collegeId: req.collegeId,
            action: 'assignment-grade',
            model: 'gemini-2.5-flash-lite',
            duration: Date.now() - startTime,
            tokensUsed: text.length
          }
        });
      } catch {}

      res.json({ success: true, data: { aiMarks, aiFeedback, aiIsGenerated, aiConfidence, aiMissingPoints } });
    } catch (aiError) {
      const isLimit = aiError.message && (aiError.message.toLowerCase().includes('quota') || aiError.message.includes('429'));
      if (isLimit) return res.status(429).json({ success: false, message: 'AI rate limit reached. Please try again later.' });
      return res.status(500).json({ success: false, message: `AI error: ${aiError.message}` });
    }
  } catch (error) { next(error); }
};

exports.aiBatchGrade = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const a = await tenantDb.assignment.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!a) return res.status(404).json({ success: false, message: 'Assignment not found' });

    let submissions = a.submissions || [];
    if (!Array.isArray(submissions)) submissions = [];

    const ungradedIndices = submissions.reduce((acc, s, index) => {
      if (!s.aiGradedAt && s.fileUrl) acc.push(index);
      return acc;
    }, []);

    if (ungradedIndices.length === 0) return res.json({ success: true, message: 'All submissions already graded', graded: 0 });
    
    const batchIndices = ungradedIndices.slice(0, 5);
    const apiKey = await getDecryptedKey(req.user._id);
    if (!apiKey) return res.status(400).json({ success: false, message: 'No AI API key configured' });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    let graded = 0;

    for (const subIndex of batchIndices) {
      const sub = submissions[subIndex];
      try {
        const prompt = `Grade briefly. Assignment: "${a.title}", Max marks: ${a.totalMarks}, Student remarks: "${sub.remarks || 'None'}".\nReply JSON only: {"marks":<0-${a.totalMarks}>,"feedback":"<1 sentence>","isAiGenerated":<bool>,"confidence":<0-100>,"missingPoints":["<point>"]}`;
        const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
        const text = result.response.text().trim();
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        let parsed;
        try { parsed = JSON.parse(clean); } catch { parsed = { marks: 0, feedback: 'Manual review needed.', isAiGenerated: null, confidence: 0, missingPoints: [] }; }
        
        submissions[subIndex] = {
          ...sub,
          aiMarks: Math.min(parsed.marks || 0, a.totalMarks || 0),
          aiFeedback: parsed.feedback || '',
          aiIsGenerated: parsed.isAiGenerated ?? null,
          aiConfidence: parsed.confidence ?? 0,
          aiMissingPoints: (parsed.missingPoints || []).slice(0, 5),
          aiGradedAt: new Date(),
          status: 'ai-graded'
        };
        
        graded++;
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) { break; }
    }

    await tenantDb.assignment.update({
      where: { id: a.id },
      data: { submissions }
    });

    res.json({ success: true, message: `${graded} of ${ungradedIndices.length} submissions graded`, graded, remaining: ungradedIndices.length - graded });
  } catch (error) { next(error); }
};

exports.deleteAssignment = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    
    // Check if it exists first
    const existing = await tenantDb.assignment.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Assignment not found' });

    await tenantDb.assignment.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Assignment deleted' });
  } catch (error) { next(error); }
};
