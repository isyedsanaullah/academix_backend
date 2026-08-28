/**
 * Content Filter Service
 * Pre-processes user queries to block inappropriate content for students.
 * Runs BEFORE any AI call to save tokens on blocked queries.
 */

const BLOCKED_CATEGORIES = {
  political: [
    'politics', 'political party', 'election', 'democrat', 'republican',
    'government corruption', 'regime', 'propaganda', 'fascism', 'communism',
    'who should i vote', 'best political'
  ],
  hacking: [
    'hack', 'hacking', 'exploit', 'vulnerability', 'sql injection',
    'xss attack', 'ddos', 'password crack', 'brute force', 'malware',
    'ransomware', 'phishing', 'bypass security', 'steal data'
  ], 
  adult: [
    'porn', 'xxx', 'nude', 'naked', 'sexual', 'sex content',
    'adult content', 'explicit', 'nsfw'
  ],
  violence: [
    'how to kill', 'how to hurt', 'make a bomb', 'make a weapon',
    'poison someone', 'terrorism'
  ],
  offtopic: [
    'recipe for', 'movie review', 'song lyrics', 'celebrity gossip',
    'sports score', 'weather forecast', 'horoscope', 'dating advice',
    'relationship advice', 'weight loss', 'cryptocurrency', 'stock market'
  ]
};

/**
 * Check if a query contains blocked content
 * @param {string} query - The user's question
 * @param {string} role - The user's role
 * @returns {{ blocked: boolean, reason: string | null }}
 */
const filterContent = (query, role) => {
  // Only enforce strict filtering for students
  if (role !== 'student') {
    return { blocked: false, reason: null };
  }

  const lowerQuery = query.toLowerCase().trim();

  // Check each blocked category
  for (const [category, keywords] of Object.entries(BLOCKED_CATEGORIES)) {
    for (const keyword of keywords) {
      if (lowerQuery.includes(keyword.toLowerCase())) {
        return {
          blocked: true,
          reason: getBlockedMessage(category)
        };
      }
    }
  }

  return { blocked: false, reason: null };
};

/**
 * Get a friendly rejection message per category
 */
const getBlockedMessage = (category) => {
  const messages = {
    political: 'This question is outside your academic content permissions. Political topics are not covered in your study material.',
    hacking: 'This question is outside your academic content permissions. Security exploitation topics are not allowed.',
    adult: 'This question is outside your academic content permissions. This type of content is restricted.',
    violence: 'This question is outside your academic content permissions. Violent or harmful content is not allowed.',
    offtopic: 'This question is outside your academic content permissions. Please ask questions related to your uploaded study material.'
  };
  return messages[category] || 'This question is outside your academic content permissions.';
};

/**
 * Validate that a student's query is related to academic content or college info
 * @param {string} query - User query
 * @param {boolean} hasContext - Whether relevant context was found (PDF or DB)
 * @returns {{ valid: boolean, message: string | null }}
 */
const validateAcademicQuery = (query, hasContext) => {
  // Always allow college-related questions (DB context handles these)
  const msg = query.toLowerCase();
  const collegeTopics = /principal|teacher|professor|faculty|timetable|schedule|period|class|section|fee|payment|attendance|exam|result|grade|announcement|notice|college|campus|address|contact|subject|course|session|sir|madam|miss|lecture|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|who is|how many|my class|my section|my roll/;
  if (collegeTopics.test(msg)) {
    return { valid: true, message: null };
  }

  // If no relevant context found for non-college queries, reject
  if (!hasContext) {
    return {
      valid: false,
      message: 'I could not find relevant information in your study material for this question. Please ask something related to your uploaded books, notes, or college information (teachers, timetable, fees, etc.).'
    };
  }
  return { valid: true, message: null };
};

module.exports = { filterContent, validateAcademicQuery };
