const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pdfParseModule = require('pdf-parse');

const parsePDFBuffer = async (buffer, options = {}) => {
  if (typeof pdfParseModule === 'function') {
    return await pdfParseModule(buffer, options);
  } else if (pdfParseModule.PDFParse) {
    const parser = new pdfParseModule.PDFParse({ data: buffer });
    const result = await parser.getText();
    return {
      text: result.text || '',
      numpages: result.total || (result.pages ? result.pages.length : 1)
    };
  } else if (pdfParseModule.default && typeof pdfParseModule.default === 'function') {
    return await pdfParseModule.default(buffer, options);
  }
  throw new Error('pdf-parse module load failed');
};

const { processPDF } = require('../services/pdfProcessor');
const { addDocumentChunks, deleteDocumentChunks } = require('../services/vectorStore');
const { getDecryptedKey } = require('./aiApiKey.controller');
const { supabase, supabaseBucket } = require('../config/supabase');
const { getSystemClient } = require('../config/prismaManager');

/**
 * Background PDF processing worker function
 */
const runBackgroundPDFProcessing = async ({ doc, filePath, collegeId, userId, subject, year, chapter, tenantDb, systemDb }) => {
  try {
    const startTime = Date.now();
    await tenantDb.pDFDocument.update({
      where: { id: doc.id },
      data: { status: 'processing' }
    });

    const apiKey = await getDecryptedKey(userId);
    const { chunks, pageCount, hierarchy } = await processPDF(filePath, apiKey);

    if (!chunks || chunks.length === 0) {
      await tenantDb.pDFDocument.update({
        where: { id: doc.id },
        data: { status: 'failed', errorMessage: 'No readable text extracted from PDF file.' }
      });
      return;
    }

    // Upload to Supabase Storage if configured
    if (supabase) {
      try {
        const fileBuffer = fs.readFileSync(filePath);
        await supabase.storage
          .from(supabaseBucket)
          .upload(`${collegeId}/${doc.filename}`, fileBuffer, {
            contentType: 'application/pdf',
            upsert: true
          });
      } catch (uploadError) {
        console.error('Supabase Storage sync failed:', uploadError.message);
      }
    }

    const result = await addDocumentChunks({
      documentId: doc.id,
      collegeId,
      subject: subject || 'General',
      chunks,
      apiKey,
      metadata: {
        teacherId: userId,
        year: year || '',
        chapter: chapter || '',
        originalName: doc.originalName
      }
    });

    await tenantDb.pDFDocument.update({
      where: { id: doc.id },
      data: {
        pageCount: parseInt(pageCount) || 1,
        chunkCount: parseInt(result.stored) || 0,
        chaptersData: hierarchy || null,
        status: 'ready',
        errorMessage: null
      }
    });

    try {
      await systemDb.aIUsageLog.create({
        data: {
          userId: String(userId),
          collegeId: String(collegeId),
          action: 'pdf-process',
          duration: Date.now() - startTime,
          tokensUsed: chunks.length * 150
        }
      });
    } catch (e) {}
  } catch (processError) {
    console.error(`❌ PDF Background Processing Error (Doc ${doc.id}):`, processError);
    try {
      await tenantDb.pDFDocument.update({
        where: { id: doc.id },
        data: { status: 'failed', errorMessage: processError.message || 'Processing failed' }
      });
    } catch (e) {}
  }
};

/**
 * Upload PDF Endpoint
 */
exports.uploadPDF = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const systemDb = getSystemClient();

    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    // 1. Multi-step Validation Suite
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    if (fileExt !== '.pdf' || req.file.mimetype !== 'application/pdf') {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Invalid file format. Only .pdf files are accepted.' });
    }

    const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
    if (req.file.size > MAX_SIZE || req.file.size === 0) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'File size must be between 1 KB and 25 MB.' });
    }

    const fileBuffer = fs.readFileSync(req.file.path);
    const magicHeader = fileBuffer.slice(0, 5).toString('utf-8');
    if (!magicHeader.startsWith('%PDF-')) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'File corruption detected. Uploaded file is not a valid PDF.' });
    }

    // PDF Integrity test
    try {
      await parsePDFBuffer(fileBuffer);
    } catch (corruptErr) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: `Corrupted PDF file: ${corruptErr.message}` });
    }

    const { subject, year, chapter, description } = req.body;
    const userId = req.user.id || req.user._id;

    // 2. SHA-256 Duplicate Detection
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const existingDoc = await tenantDb.pDFDocument.findFirst({
      where: { collegeId: req.collegeId, fileHash }
    });

    if (existingDoc && existingDoc.status === 'ready') {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(200).json({
        success: true,
        message: 'Duplicate PDF detected: This document has already been processed and is ready for use.',
        data: { ...existingDoc, _id: existingDoc.id, isDuplicate: true }
      });
    }

    // Versioning logic: check previous versions for subject & chapter
    let versionNumber = 1;
    let parentDocumentId = null;

    if (subject && chapter) {
      const prevDoc = await tenantDb.pDFDocument.findFirst({
        where: { collegeId: req.collegeId, subject, chapter, isActiveVersion: true }
      });
      if (prevDoc) {
        versionNumber = (prevDoc.versionNumber || 1) + 1;
        parentDocumentId = prevDoc.id;
        // Mark previous version inactive
        await tenantDb.pDFDocument.update({
          where: { id: prevDoc.id },
          data: { isActiveVersion: false }
        });
      }
    }

    // 3. Create Document DB Record
    const doc = await tenantDb.pDFDocument.create({
      data: {
        collegeId: req.collegeId,
        teacherId: userId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        fileHash,
        subject: subject || 'General',
        year: year || '',
        chapter: chapter || '',
        description: description || '',
        fileSize: parseFloat(req.file.size) || 0,
        versionNumber,
        parentDocumentId,
        isActiveVersion: true,
        status: 'uploading'
      }
    });

    // 4. Return instant HTTP 201 response while launching background task
    res.status(201).json({
      success: true,
      message: 'PDF uploaded successfully. Processing background job started.',
      data: { ...doc, _id: doc.id }
    });

    // 5. Non-blocking Background Queue Execution
    runBackgroundPDFProcessing({
      doc,
      filePath: req.file.path,
      collegeId: req.collegeId,
      userId,
      subject: subject || 'General',
      year: year || '',
      chapter: chapter || '',
      tenantDb,
      systemDb
    }).catch(err => console.error('Background worker error:', err));

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    next(error);
  }
};

/**
 * Retry Failed Document Processing
 */
exports.retryDocument = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const systemDb = getSystemClient();
    const { id } = req.params;

    const doc = await tenantDb.pDFDocument.findUnique({ where: { id } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    const filePath = `${process.env.UPLOAD_DIR || './uploads'}/${doc.collegeId}/${doc.filename}`;
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ success: false, message: 'Original file no longer exists on disk. Please upload again.' });
    }

    await tenantDb.pDFDocument.update({
      where: { id: doc.id },
      data: { status: 'uploading', errorMessage: null }
    });

    res.json({ success: true, message: 'Retrying PDF processing in background...' });

    const userId = req.user.id || req.user._id;
    runBackgroundPDFProcessing({
      doc,
      filePath,
      collegeId: doc.collegeId,
      userId,
      subject: doc.subject,
      year: doc.year,
      chapter: doc.chapter,
      tenantDb,
      systemDb
    }).catch(err => console.error('Retry worker error:', err));
  } catch (error) {
    next(error);
  }
};

/**
 * Get List of Uploaded Documents
 */
exports.getDocuments = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { subject, status, page = 1, limit = 20 } = req.query;

    const where = { collegeId: req.collegeId };
    if (subject) where.subject = subject;
    if (status) where.status = status;

    const userId = req.user.id || req.user._id;
    if (req.user.role === 'teacher') {
      where.teacherId = userId;
    }

    const take = parseInt(limit) || 20;
    const skip = (parseInt(page) - 1) * take;

    const [total, docs] = await Promise.all([
      tenantDb.pDFDocument.count({ where }),
      tenantDb.pDFDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take
      })
    ]);

    res.json({
      success: true,
      data: docs.map(d => ({ ...d, _id: d.id })),
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Subjects List with Counts
 */
exports.getSubjects = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;

    const subjects = await tenantDb.pDFDocument.groupBy({
      by: ['subject'],
      where: {
        collegeId: req.collegeId,
        status: 'ready'
      },
      _count: { subject: true },
      _sum: { chunkCount: true },
      orderBy: { subject: 'asc' }
    });

    res.json({
      success: true,
      data: subjects.map(s => ({
        subject: s.subject || 'General',
        documentCount: s._count.subject,
        totalChunks: s._sum.chunkCount || 0
      }))
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Complete Cascade Document Deletion
 */
exports.deleteDocument = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const doc = await tenantDb.pDFDocument.findUnique({ where: { id } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    const userId = req.user.id || req.user._id;
    if (doc.teacherId !== userId && !['admin', 'superAdmin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this document.' });
    }

    // Cascade delete vectors, disk file, Supabase file, and DB record inside atomic transaction
    await deleteDocumentChunks(doc.id);

    const filePath = `${process.env.UPLOAD_DIR || './uploads'}/${doc.collegeId}/${doc.filename}`;
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }

    if (supabase) {
      try {
        await supabase.storage.from(supabaseBucket).remove([`${doc.collegeId}/${doc.filename}`]);
      } catch (e) {}
    }

    await tenantDb.$transaction(async (tx) => {
      await tx.pDFDocument.delete({ where: { id: doc.id } });
    });

    res.json({ success: true, message: 'Document and all associated chunks deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

/**
 * Download PDF Document Endpoint
 */
exports.downloadDocument = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const doc = await tenantDb.pDFDocument.findUnique({ where: { id } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    // Verify document belongs to student/teacher's college
    if (doc.collegeId !== req.collegeId) {
      return res.status(403).json({ success: false, message: 'Access denied to document from another institution.' });
    }

    const filePath = path.resolve(`${process.env.UPLOAD_DIR || './uploads'}/${doc.collegeId}/${doc.filename}`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'PDF file not found on server storage.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.originalName)}"`);
    res.download(filePath, doc.originalName);
  } catch (error) {
    next(error);
  }
};

/**
 * Get Merged Subject Knowledge Hierarchy (Chapters & Topics)
 */
exports.getSubjectHierarchy = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { subject } = req.query;

    const where = {
      collegeId: req.collegeId,
      status: 'ready'
    };
    if (subject && subject !== 'all') {
      where.subject = subject;
    }

    const docs = await tenantDb.pDFDocument.findMany({
      where,
      select: { subject: true, chapter: true, chaptersData: true }
    });

    const chaptersMap = new Map();

    docs.forEach(doc => {
      if (doc.chaptersData && Array.isArray(doc.chaptersData)) {
        doc.chaptersData.forEach(chap => {
          if (!chap.title) return;
          if (!chaptersMap.has(chap.title)) {
            chaptersMap.set(chap.title, new Set());
          }
          if (Array.isArray(chap.topics)) {
            chap.topics.forEach(t => chaptersMap.get(chap.title).add(t));
          }
        });
      } else if (doc.chapter) {
        if (!chaptersMap.has(doc.chapter)) {
          chaptersMap.set(doc.chapter, new Set());
        }
      }
    });

    const result = Array.from(chaptersMap.entries()).map(([title, topicsSet]) => ({
      title,
      topics: Array.from(topicsSet)
    }));

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};


