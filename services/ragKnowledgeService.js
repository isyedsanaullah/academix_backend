/**
 * backend/services/ragKnowledgeService.js
 * Engine 2: PDF RAG Knowledge Base and Vector Indexer (#100).
 * Stores curriculum textbooks (Punjab/Sindh boards, NBF) and college custom notes.
 * Enforces multi-tenancy: college_id = :collegeId OR college_id IS NULL (shared).
 * Executes top-K cosine similarity searches via PostgreSQL pgvector (<=> operator).
 */

const { getSystemClient } = require('../config/prismaManager');
const crypto = require('crypto');

/**
 * Deterministically generates a 768-dimensional normalized unit vector from input text.
 * Used for fast, offline, and reliable vector similarity in tests and local environments,
 * or as an embedding generator.
 */
function generateDeterministicEmbedding(text, dimension = 768) {
  const vector = new Float32Array(dimension);
  const words = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    vector[0] = 1.0;
    return Array.from(vector);
  }

  for (const word of words) {
    const h = crypto.createHash('md5').update(word).digest();
    const idx1 = h.readUInt16LE(0) % dimension;
    const idx2 = h.readUInt16LE(2) % dimension;
    const idx3 = h.readUInt16LE(4) % dimension;
    vector[idx1] += 1.0;
    vector[idx2] += 1.0;
    vector[idx3] += 1.0;
  }

  // Normalize to unit length (L2 norm)
  let norm = 0;
  for (let i = 0; i < dimension; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      vector[i] /= norm;
    }
  } else {
    vector[0] = 1.0;
  }

  return Array.from(vector);
}

/**
 * Formats a JavaScript array of floats into a PostgreSQL vector literal string.
 * E.g. "[0.123,0.456,...]"
 */
function vectorToSql(vector) {
  return `[${vector.map((v) => Number(v.toFixed(6))).join(',')}]`;
}

/**
 * Creates a KnowledgeBook and indexes its text chunks with pgvector embeddings.
 */
async function registerAndIndexBook({
  college_id = null,
  subject_id,
  className,
  title,
  fileKey = 'curriculum/textbook.pdf',
  chunks = [],
}) {
  const prisma = getSystemClient();

  const book = await prisma.knowledgeBook.create({
    data: {
      college_id: college_id || null,
      subject_id,
      class: className || 'General',
      title,
      fileKey,
      status: 'INDEXED',
      totalChunks: chunks.length,
    },
  });

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkId = crypto.randomUUID();
    const embeddingArr = chunk.embedding || generateDeterministicEmbedding(chunk.chunkText);
    const vectorLiteral = vectorToSql(embeddingArr);

    // Insert into DocumentChunkVector with vector casting
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentChunkVector" ("id", "bookId", "chunkIndex", "chapterName", "pageNumber", "chunkText", "embedding")
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
      chunkId,
      book.id,
      chunk.chunkIndex !== undefined ? chunk.chunkIndex : i,
      chunk.chapterName || null,
      chunk.pageNumber || 1,
      chunk.chunkText,
      vectorLiteral
    );
  }

  return await prisma.knowledgeBook.findUnique({
    where: { id: book.id },
    include: { chunks: true },
  });
}

/**
 * Retrieves the top-K most semantically relevant chunks using pgvector cosine distance (<=>).
 * Enforces strict multi-tenancy: (book.college_id = :collegeId OR book.college_id IS NULL)
 */
async function searchRelevantChunks({
  collegeId,
  subjectId = null,
  queryText,
  queryVector = null,
  limit = 3,
}) {
  const prisma = getSystemClient();
  const vector = queryVector || generateDeterministicEmbedding(queryText);
  const vectorLiteral = vectorToSql(vector);

  let results;
  if (subjectId) {
    results = await prisma.$queryRawUnsafe(
      `SELECT c.id, c."bookId", c."chunkIndex", c."chapterName", c."pageNumber", c."chunkText",
              b.title as "bookTitle", b.class as "bookClass",
              (c.embedding <=> $1::vector) as distance
       FROM "DocumentChunkVector" c
       JOIN "KnowledgeBook" b ON c."bookId" = b.id
       WHERE (b.college_id = $2 OR b.college_id IS NULL)
         AND b.subject_id = $3
       ORDER BY (c.embedding <=> $1::vector) ASC
       LIMIT $4`,
      vectorLiteral,
      collegeId,
      subjectId,
      limit
    );
  } else {
    results = await prisma.$queryRawUnsafe(
      `SELECT c.id, c."bookId", c."chunkIndex", c."chapterName", c."pageNumber", c."chunkText",
              b.title as "bookTitle", b.class as "bookClass",
              (c.embedding <=> $1::vector) as distance
       FROM "DocumentChunkVector" c
       JOIN "KnowledgeBook" b ON c."bookId" = b.id
       WHERE (b.college_id = $2 OR b.college_id IS NULL)
       ORDER BY (c.embedding <=> $1::vector) ASC
       LIMIT $3`,
      vectorLiteral,
      collegeId,
      limit
    );
  }

  return results.map((r) => ({
    id: r.id,
    bookId: r.bookId,
    bookTitle: r.bookTitle,
    chapterName: r.chapterName,
    pageNumber: r.pageNumber,
    chunkText: r.chunkText,
    distance: typeof r.distance === 'number' ? r.distance : parseFloat(r.distance),
  }));
}

module.exports = {
  generateDeterministicEmbedding,
  vectorToSql,
  registerAndIndexBook,
  searchRelevantChunks,
};
