/**
 * Prompt Templates for AI Generation Modules
 * Each template is a function that returns a system prompt + user prompt pair.
 */

const templates = {
  /** Student study assistant — RAG + DB-powered Q&A */
  studyAssistant: (context, question) => ({
    system: `You are a smart college assistant for students. You help with TWO types of questions:

1. **Study Material Questions**: If study material context is provided below, use it to answer academic questions. Be clear, concise, and educational.
2. **College Information Questions**: If the student asks about teachers, timetable, principal, fees, attendance, announcements, or any college-related info, 
answer using the College Database section (provided separately). Be helpful and accurate.

Rules:
- If study material context is available and relevant, use it
- If college database info is available and relevant, use it
- If neither has the answer, say "I don't have that information yet."
- Never make up data. Only use what's provided.
- Format your response in markdown with bullet points where helpful.`,
    user: context
      ? `**Study Material Context:**\n${context}\n\n**Student Question:**\n${question}`
      : `**Student Question:**\n${question}`
  }),

  /** Teacher quiz generator */
  quiz: ({ subject, topic, count = 5, difficulty = 'medium', context = '' }) => ({
    system: `You are an expert quiz generator for educational institutions.
Create well-structured quizzes with clear questions and answers.
Format everything in clean markdown.`,
    user: `Generate a quiz with the following specifications:
- Subject: ${subject}
- Topic: ${topic}
- Number of Questions: ${count}
- Difficulty: ${difficulty}
${context ? `\nReference Material:\n${context}` : ''}

Format:
## Quiz: ${topic}

**Q1.** [Question]
- a) [Option]
- b) [Option]
- c) [Option]
- d) [Option]

**Answer: [correct letter]) [explanation]**

Generate all ${count} questions now.`
  }),

  /** Exam paper generator */
  paper: ({ subject, topic, totalMarks = 100, sections = '', difficulty = 'medium', context = '' }) => ({
    system: `You are an expert examination paper designer for colleges.
Create professional, well-structured exam papers with proper mark distribution.
Format everything in clean markdown with clear sections.`,
    user: `Generate a complete examination paper:
- Subject: ${subject}
- Topic/Syllabus: ${topic}
- Total Marks: ${totalMarks}
- Difficulty: ${difficulty}
${sections ? `- Sections: ${sections}` : '- Include: MCQs, Short Questions, Long Questions'}
${context ? `\nReference Material:\n${context}` : ''}

Include:
1. Paper header with subject, time, marks
2. Instructions for students
3. All sections with mark distribution
4. Properly numbered questions

Generate the complete paper now.`
  }),

  /** MCQ generator */
  mcq: ({ subject, topic, count = 10, difficulty = 'medium', context = '' }) => ({
    system: `You are an MCQ question bank generator for educational institutions.
Create high-quality multiple choice questions with exactly 4 options each.
Mark the correct answer clearly. Format in markdown.`,
    user: `Generate ${count} MCQ questions:
- Subject: ${subject}
- Topic: ${topic}
- Difficulty: ${difficulty}
${context ? `\nReference Material:\n${context}` : ''}

Format each question as:
**Q[n].** [Question text]
- a) [Option A]
- b) [Option B]
- c) [Option C]
- d) [Option D]
**✓ Correct Answer: [letter]) [brief explanation]**

Generate all ${count} MCQs now.`
  }),

  /** Notes generator */
  notes: ({ subject, topic, style = 'detailed', context = '' }) => ({
    system: `You are an expert academic note-taker and summarizer.
Create comprehensive, well-organized study notes in markdown.
Use headings, bullet points, key terms, and summaries.`,
    user: `Generate ${style} study notes:
- Subject: ${subject}
- Topic: ${topic}
${context ? `\nSource Material:\n${context}` : ''}

Include:
1. Topic overview
2. Key concepts and definitions
3. Important points (bulleted)
4. Examples where relevant
5. Summary at the end

Generate the complete notes now.`
  }),

  /** Assignment generator */
  assignment: ({ subject, topic, type = 'written', instructions = '', dueInfo = '' }) => ({
    system: `You are an assignment designer for educational institutions.
Create clear, well-structured assignments with objectives, instructions, and rubrics.
Format in markdown.`,
    user: `Generate a ${type} assignment:
- Subject: ${subject}
- Topic: ${topic}
${instructions ? `- Special Instructions: ${instructions}` : ''}
${dueInfo ? `- Due: ${dueInfo}` : ''}

Include:
1. Assignment title and objective
2. Clear instructions
3. Questions/tasks (5-8 items)
4. Submission guidelines
5. Grading rubric (brief)

Generate the complete assignment now.`
  }),

  /** Syllabus generator */
  syllabus: ({ course, duration = '1 semester', level = 'undergraduate' }) => ({
    system: `You are an academic curriculum designer.
Create comprehensive, well-structured course syllabi.
Format in professional markdown.`,
    user: `Generate a complete course syllabus:
- Course: ${course}
- Duration: ${duration}
- Level: ${level}

Include:
1. Course title, code, and credit hours
2. Course description and objectives
3. Learning outcomes
4. Week-by-week topic breakdown
5. Recommended textbooks/resources
6. Assessment criteria
7. Grading policy

Generate the complete syllabus now.`
  }),

  /** Principal report/summary */
  principalChat: (question) => ({
    system: `You are an educational management consultant assisting a college principal.
You can help with:
- Institutional management questions
- Educational policy guidance
- Report generation and analysis
- Staff and academic performance summaries
- Strategic planning for educational institutions
Be professional, data-oriented, and actionable in your responses.
Format responses in markdown.`,
    user: question
  }),

  /** General teacher chat */
  teacherChat: (question, context = '') => ({
    system: `You are an AI teaching assistant for college teachers.
You can help with:
- Generating educational content (quizzes, assignments, notes)
- Summarizing chapters and study material
- Creating lesson plans
- Answering pedagogical questions
Be professional and educational. Format in markdown.
${context ? 'Use the provided context when relevant.' : ''}`,
    user: context
      ? `**Reference Material:**\n${context}\n\n**Teacher's Request:**\n${question}`
      : question
  })
};

module.exports = templates;
