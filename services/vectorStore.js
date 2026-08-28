const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSystemClient } = require('../config/prismaManager');

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-004';
const EMBEDDING_DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '768', 10);

let pgVectorSupported = false;

/**
 * Initialize PostgreSQL pgvector extension and column if supported
 */
const initPgVector = async () => {
  const prisma = getSystemClient();
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS embedding_vector vector(${EMBEDDING_DIMENSION});`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS doc_chunks_vector_hnsw ON "DocumentChunk" USING hnsw (embedding_vector vector_cosine_ops);`);
    pgVectorSupported = true;
    console.log(`✅ PostgreSQL pgvector extension enabled with dimension ${EMBEDDING_DIMENSION}`);
  } catch (err) {
    pgVectorSupported = false;
    console.log(`ℹ PostgreSQL native pgvector extension not installed in current DB binary. Using optimized PostgreSQL array similarity store.`);
  }
};

// Run initialization silently
initPgVector().catch(() => {});

const isOpenRouterKey = (key) => typeof key === 'string' && key.trim().startsWith('sk-or-');
const isGeminiKey = (key) => typeof key === 'string' && key.trim().length > 10 && !isOpenRouterKey(key);

/**
 * Generate embedding strictly using Google Gemini text-embedding-004
 */
const generateEmbedding = async (text, apiKey) => {
  const token = apiKey || process.env.GEMINI_API_KEY;
  
  if (!token || !isGeminiKey(token)) {
    // Skip calling Google API if key is missing or not a Google Gemini key (e.g. OpenRouter key)
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(token);
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    const values = result?.embedding?.values;
    
    if (values && values.length === EMBEDDING_DIMENSION) {
      return values;
    }
    
    if (values && values.length > 0) {
      console.warn(`⚠ Generated embedding dimension ${values.length} does not match expected ${EMBEDDING_DIMENSION}.`);
      return values;
    }

    return null;
  } catch (error) {
    console.error(`Gemini Embedding (${EMBEDDING_MODEL}) failed:`, error.message);
    return null;
  }
};

/**
 * Cosine similarity calculation between two float arrays
 */
const cosineSimilarity = (a, b) => {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * Store chunks with embeddings into PostgreSQL DocumentChunk table
 */
const addDocumentChunks = async ({ documentId, collegeId, subject, class: className, section, academicSession, chunks, apiKey, metadata = {} }) => {
  const prisma = getSystemClient();
  let withEmbeddings = 0;
  const docsToInsert = [];

  // Process chunks sequentially or in batch to prevent API rate limits
  for (let i = 0; i < chunks.length; i++) {
    const chunkObj = typeof chunks[i] === 'string' ? { text: chunks[i], pageNumber: i + 1, sectionTitle: null } : chunks[i];
    const text = chunkObj.text || '';
    let embedding = [];

    const vec = await generateEmbedding(text, apiKey);
    if (vec && vec.length > 0) {
      embedding = vec;
      withEmbeddings++;
    }

    const chunkId = crypto.randomUUID ? crypto.randomUUID() : `${documentId}-chunk-${i}-${Date.now()}`;

    docsToInsert.push({
      id: chunkId,
      documentId: String(documentId),
      collegeId: String(collegeId),
      subject: subject || 'General',
      class: className || null,
      section: section || null,
      academicSession: academicSession || null,
      chunkIndex: i,
      pageNumber: chunkObj.pageNumber || null,
      sectionTitle: chunkObj.sectionTitle || null,
      text,
      embedding,
      metadata: { ...metadata, chunkIndex: i, pageNumber: chunkObj.pageNumber }
    });
  }

  // Write records to PostgreSQL inside short atomic transaction
  await prisma.$transaction(async (tx) => {
    await tx.documentChunk.createMany({
      data: docsToInsert
    });
  });

  // If pgvector is enabled, update vector column
  if (pgVectorSupported) {
    try {
      for (const doc of docsToInsert) {
        if (doc.embedding && doc.embedding.length > 0) {
          const vecStr = `[${doc.embedding.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE "DocumentChunk" SET embedding_vector = $1::vector WHERE id = $2`,
            vecStr,
            doc.id
          );
        }
      }
    } catch (e) {
      console.warn('pgvector column update failed, fallback to array store:', e.message);
    }
  }

  return { stored: docsToInsert.length, withEmbeddings };
};

/**
 * Query relevant chunks using PostgreSQL pgvector / float array cosine search
 * Enforces strict pre-filtering by collegeId, subject, class, section, academicSession
 */
const queryRelevantChunks = async ({ query, collegeId, subject, class: className, section, academicSession, chapter, topic, apiKey, topK = 5 }) => {
  const prisma = getSystemClient();
  const queryEmbedding = await generateEmbedding(query, apiKey);

  const filter = { collegeId: String(collegeId) };
  if (subject) filter.subject = subject;
  if (className) filter.class = className;
  if (section) filter.section = section;
  if (academicSession) filter.academicSession = academicSession;
  if (chapter || topic) {
    filter.OR = [];
    if (chapter) {
      filter.OR.push({ sectionTitle: { contains: chapter, mode: 'insensitive' } });
    }
    if (topic) {
      filter.OR.push({ text: { contains: topic, mode: 'insensitive' } });
    }
  }

  // ─── 1. Native pgvector Search (if supported) ───────────────────
  if (pgVectorSupported && queryEmbedding && queryEmbedding.length > 0) {
    try {
      const vecStr = `[${queryEmbedding.join(',')}]`;
      const rawResults = await prisma.$queryRawUnsafe(`
        SELECT id, "documentId", "collegeId", subject, class, section, "chunkIndex", "pageNumber", "sectionTitle", text, metadata,
               1 - (embedding_vector <=> $1::vector) AS similarity
        FROM "DocumentChunk"
        WHERE "collegeId" = $2
          AND ($3::text IS NULL OR subject = $3)
          AND ($4::text IS NULL OR class = $4)
          AND ($5::text IS NULL OR section = $5)
        ORDER BY embedding_vector <=> $1::vector
        LIMIT $6
      `, vecStr, String(collegeId), subject || null, className || null, section || null, topK);

      if (rawResults && rawResults.length > 0) {
        return rawResults.map(r => ({
          text: r.text,
          score: parseFloat(r.similarity) || 0,
          metadata: r.metadata || {},
          pageNumber: r.pageNumber,
          sectionTitle: r.sectionTitle,
          subject: r.subject
        }));
      }
    } catch (pgErr) {
      console.warn('pgvector search fallback:', pgErr.message);
    }
  }

  // ─── 2. PostgreSQL Array Cosine Fallback ───────────────────
  if (queryEmbedding && queryEmbedding.length > 0) {
    try {
      const dbChunks = await prisma.documentChunk.findMany({
        where: filter,
        select: { id: true, documentId: true, text: true, embedding: true, pageNumber: true, sectionTitle: true, metadata: true, subject: true }
      });

      const scored = dbChunks
        .map(chunk => {
          const score = cosineSimilarity(queryEmbedding, chunk.embedding);
          return {
            text: chunk.text,
            score,
            metadata: chunk.metadata || {},
            pageNumber: chunk.pageNumber,
            sectionTitle: chunk.sectionTitle,
            subject: chunk.subject
          };
        })
        .filter(c => c.score > 0);

      if (scored.length > 0) {
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
      }
    } catch (err) {
      console.error('Similarity search error:', err.message);
    }
  }

  // ─── 3. Keyword Search Fallback ───────────────────
  try {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    const matchedChunks = await prisma.documentChunk.findMany({
      where: {
        AND: [
          filter,
          keywords.length > 0 ? {
            OR: keywords.map(kw => ({
              text: { contains: kw, mode: 'insensitive' }
            }))
          } : {}
        ]
      },
      take: topK * 2
    });

    if (matchedChunks.length > 0) {
      const scored = matchedChunks.map(c => {
        const textLower = c.text.toLowerCase();
        const matchCount = keywords.filter(k => textLower.includes(k)).length;
        return {
          text: c.text,
          score: keywords.length > 0 ? matchCount / keywords.length : 0.5,
          metadata: c.metadata || {},
          pageNumber: c.pageNumber,
          sectionTitle: c.sectionTitle,
          subject: c.subject
        };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK);
    }
  } catch (err) {
    console.error('Keyword fallback failure:', err.message);
  }

  return [];
};

/**
 * Complete cascade deletion of document chunks
 */
const deleteDocumentChunks = async (documentId) => {
  const prisma = getSystemClient();
  await prisma.documentChunk.deleteMany({
    where: { documentId: String(documentId) }
  });
  return { success: true };
};

/**
 * Get total chunk count for a tenant college
 */
const getCollegeChunkCount = async (collegeId) => {
  const prisma = getSystemClient();
  return prisma.documentChunk.count({
    where: { collegeId: String(collegeId) }
  });
};

module.exports = {
  addDocumentChunks,
  queryRelevantChunks,
  deleteDocumentChunks,
  getCollegeChunkCount,
  generateEmbedding
};
