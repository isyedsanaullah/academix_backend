const { getDecryptedKey } = require('./aiApiKey.controller');
const { generateFromTemplate } = require('../services/aiService');
const { queryRelevantChunks } = require('../services/vectorStore');

/**
 * Generic handler factory for AI generators
 */
const createGenerator = (templateName, action) => {
  return async (req, res, next) => {
    try {
      const apiKey = await getDecryptedKey(req.user._id);
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: 'No AI API key configured. Please add your Gemini API key in Settings.'
        });
      }

      const params = req.body;

      // If subject provided, try to get context from uploaded material
      if (params.subject && params.useContext !== false) {
        try {
          const chunks = await queryRelevantChunks({
            query: params.topic || params.subject,
            collegeId: req.collegeId || req.user.college_id,
            subject: params.subject,
            apiKey,
            topK: 3
          });
          if (chunks.length > 0) {
            params.context = chunks.map(c => c.text).join('\n\n---\n\n');
          }
        } catch { /* no context available, proceed without */ }
      }

      const result = await generateFromTemplate({
        templateName,
        params,
        apiKey,
        userId: req.user._id,
        collegeId: req.collegeId || req.user.college_id
      });

      res.json({
        success: true,
        data: { content: result, type: action }
      });
    } catch (error) {
      if (error.message?.includes('API_KEY') || error.status === 403) {
        return res.status(400).json({
          success: false,
          message: 'API key is invalid. Please update your Gemini API key in Settings.'
        });
      }
      next(error);
    }
  };
};

// @desc    Generate Quiz
// @route   POST /api/ai/generate/quiz
exports.generateQuiz = createGenerator('quiz', 'quiz');

// @desc    Generate Exam Paper
// @route   POST /api/ai/generate/paper
exports.generatePaper = createGenerator('paper', 'paper');

// @desc    Generate MCQs
// @route   POST /api/ai/generate/mcq
exports.generateMCQ = createGenerator('mcq', 'mcq');

// @desc    Generate Notes
// @route   POST /api/ai/generate/notes
exports.generateNotes = createGenerator('notes', 'notes');

// @desc    Generate Assignment
// @route   POST /api/ai/generate/assignment
exports.generateAssignment = createGenerator('assignment', 'assignment');

// @desc    Generate Syllabus
// @route   POST /api/ai/generate/syllabus
exports.generateSyllabus = createGenerator('syllabus', 'syllabus');
