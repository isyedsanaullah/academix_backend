const fs = require('fs');
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

/**
 * PDF Processor Service
 * Extracts text page-by-page from PDF, cleans text, splits by logical boundaries
 * (paragraphs/headings), and windows into overlapping chunks with pageNumber metadata.
 */

/**
 * Extract text and page map from a PDF file
 */
const extractTextWithPages = async (filePath) => {
  const buffer = fs.readFileSync(filePath);
  
  const pageTexts = [];
  let totalPages = 0;

  const options = {
    pagerender: function(pageData) {
      return pageData.getTextContent().then(function(textContent) {
        let lastY, text = '';
        for (let item of textContent.items) {
          if (lastY == item.transform[5] || !lastY) {
            text += item.str;
          } else {
            text += '\n' + item.str;
          }
          lastY = item.transform[5];
        }
        return text;
      });
    }
  };

  const data = await parsePDFBuffer(buffer, options);
  totalPages = data.numpages || 1;

  // Split text by form feed or page separator if available, or split evenly
  const rawPages = (data.text || '').split(/\f|\x0C/);
  
  if (rawPages.length >= totalPages) {
    rawPages.forEach((pText, idx) => {
      pageTexts.push({ pageNumber: idx + 1, text: pText });
    });
  } else {
    // Fallback: estimate page per portion of total text
    const textPerPg = Math.ceil((data.text || '').length / Math.max(1, totalPages));
    for (let i = 0; i < totalPages; i++) {
      const pText = (data.text || '').substring(i * textPerPg, (i + 1) * textPerPg);
      pageTexts.push({ pageNumber: i + 1, text: pText });
    }
  }

  return { pageTexts, pageCount: totalPages };
};

/**
 * Clean extracted text
 */
const cleanText = (text) => {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove null/control chars
    .replace(/\bPage\s+\d+\s+(of\s+\d+)?\b/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
};

/**
 * Split page text into logical section chunks with overlapping token windows
 */
const splitLogicalChunks = (pageTexts, chunkSize = 1500, overlap = 300) => {
  const structuredChunks = [];

  for (const pageObj of pageTexts) {
    const cleaned = cleanText(pageObj.text);
    if (!cleaned || cleaned.length < 15) continue;

    // Split page text into logical paragraphs by double newline or headings
    const paragraphs = cleaned.split(/\n\n+/).filter(p => p.trim().length > 10);
    
    let currentChunk = '';
    let currentTitle = null;

    for (let p of paragraphs) {
      const pTrim = p.trim();
      
      // Detect heading candidate (short line ending without period)
      if (pTrim.length < 80 && !pTrim.endsWith('.') && !pTrim.endsWith(',')) {
        currentTitle = pTrim;
      }

      if ((currentChunk + '\n\n' + pTrim).length <= chunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + pTrim;
      } else {
        if (currentChunk.length > 20) {
          structuredChunks.push({
            text: currentChunk,
            pageNumber: pageObj.pageNumber,
            sectionTitle: currentTitle
          });
        }
        // Apply overlap from end of previous chunk
        const overlapStart = Math.max(0, currentChunk.length - overlap);
        const overlapText = currentChunk.substring(overlapStart);
        currentChunk = overlapText + '\n\n' + pTrim;
      }
    }

    if (currentChunk.trim().length > 20) {
      structuredChunks.push({
        text: currentChunk.trim(),
        pageNumber: pageObj.pageNumber,
        sectionTitle: currentTitle
      });
    }
  }

  return structuredChunks;
};

/**
 * 5-Step Chapter & Topic Hierarchy Extraction Pipeline
 */
const extractChapterHierarchy = async (pageTexts, apiKey = null) => {
  const chaptersMap = new Map();
  let currentChapter = 'General';
  
  const ensureChapter = (chapTitle) => {
    const cleanTitle = chapTitle.replace(/^chapter\s*\d*[:\-]?\s*/i, '').trim() || chapTitle;
    if (!chaptersMap.has(cleanTitle)) {
      chaptersMap.set(cleanTitle, new Set());
    }
    return cleanTitle;
  };

  ensureChapter('General');

  // Step 1: TOC Page Regex Check
  let foundTOC = false;
  for (const pageObj of pageTexts.slice(0, 10)) {
    const text = cleanText(pageObj.text);
    if (/table\s+of\s+contents|contents\b/i.test(text)) {
      foundTOC = true;
      const lines = text.split('\n');
      for (const line of lines) {
        const tocMatch = line.match(/(?:chapter|unit|section)?\s*(\d+[\.\:]?\s+[^\.\d]{3,50})/i);
        if (tocMatch) {
          ensureChapter(tocMatch[1].trim());
        }
      }
    }
  }

  // Step 2 & 3 & 4: Heading & Numbered Heading Patterns across pages
  const chapterRegex = /^(?:chapter|unit|section|module)\s*(\d+|[ivxlcdm]+)[:\-\s]+(.+)$/i;
  const numberedHeadingRegex = /^(\d+\.\d+)\s+(.+)$/;

  for (const pageObj of pageTexts) {
    const text = cleanText(pageObj.text);
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    for (const line of lines) {
      // Chapter pattern match
      const chapMatch = line.match(chapterRegex);
      if (chapMatch) {
        currentChapter = ensureChapter(`Chapter ${chapMatch[1]}: ${chapMatch[2]}`);
        continue;
      }

      // Numbered topic pattern match
      const numMatch = line.match(numberedHeadingRegex);
      if (numMatch && currentChapter) {
        const topicName = numMatch[2].substring(0, 60).trim();
        if (topicName.length >= 3 && !topicName.endsWith('.')) {
          chaptersMap.get(currentChapter)?.add(topicName);
        }
        continue;
      }

      // Short heading candidate
      if (line.length > 5 && line.length < 55 && !line.endsWith('.') && !line.endsWith(',') && !/^(page|\d+)/i.test(line)) {
        if (/^[A-Z0-9\s\-\:]+$/.test(line) || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/.test(line)) {
          if (line.toLowerCase().includes('chapter') || line.toLowerCase().includes('unit')) {
            currentChapter = ensureChapter(line);
          } else if (currentChapter) {
            chaptersMap.get(currentChapter)?.add(line);
          }
        }
      }
    }
  }

  // Convert Map to Array structure
  let resultChapters = Array.from(chaptersMap.entries()).map(([title, topicsSet]) => ({
    title,
    topics: Array.from(topicsSet)
  })).filter(c => c.title !== 'General' || c.topics.length > 0);

  // Step 5: Single-pass Gemini Fallback if deterministic extraction yields < 2 chapters
  if (resultChapters.length < 2 && apiKey) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
      
      const sampleText = pageTexts.slice(0, 15).map(p => cleanText(p.text)).join('\n\n').substring(0, 8000);
      const prompt = `Analyze this document text and extract the table of contents / chapter hierarchy as JSON.
Return ONLY valid JSON matching this exact format:
{
  "chapters": [
    {
      "title": "Chapter Name",
      "topics": ["Topic 1", "Topic 2"]
    }
  ]
}

Document Text Sample:
${sampleText}`;

      const res = await model.generateContent(prompt);
      const resText = res.response.text();
      const jsonMatch = resText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.chapters && Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
          resultChapters = parsed.chapters;
        }
      }
    } catch (e) {
      console.warn('Gemini chapter extraction fallback skipped/failed:', e.message);
    }
  }

  if (resultChapters.length === 0) {
    resultChapters = [{ title: 'General Overview', topics: ['Main Concepts', 'Key Terminology', 'Summary'] }];
  }

  return resultChapters;
};

/**
 * Full PDF process pipeline
 */
const processPDF = async (filePath, apiKey = null) => {
  const { pageTexts, pageCount } = await extractTextWithPages(filePath);
  const chunks = splitLogicalChunks(pageTexts, 1500, 300);
  const hierarchy = await extractChapterHierarchy(pageTexts, apiKey);

  return {
    chunks,
    pageCount,
    totalChunks: chunks.length,
    hierarchy
  };
};

module.exports = {
  extractTextWithPages,
  cleanText,
  splitLogicalChunks,
  extractChapterHierarchy,
  processPDF
};

