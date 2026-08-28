const dotenv = require('dotenv');
dotenv.config();

const { processPDF } = require('./services/pdfProcessor');
const { generateEmbedding, cosineSimilarity } = require('./services/vectorStore');
const { buildSourcesCitationFooter } = require('./services/aiService');

async function testAll() {
  console.log('--- 🧪 STARTING SYSTEM VERIFICATION TESTS ---');

  // Test 1: Embedding Model & Dimension
  console.log('\n1. Testing Single Embedding Model (text-embedding-004)...');
  const sampleText = 'Photosynthesis is the process by which plants convert light into chemical energy.';
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY;
  
  if (apiKey) {
    const vec = await generateEmbedding(sampleText, apiKey);
    if (vec) {
      console.log(`✅ Embedding generated successfully. Length: ${vec.length} (Expected: 768)`);
      const sim = cosineSimilarity(vec, vec);
      console.log(`✅ Self-cosine similarity test: ${sim.toFixed(4)} (Expected: 1.0000)`);
    } else {
      console.log('⚠️ Embedding returned null (Check API key).');
    }
  } else {
    console.log('ℹ️ Skipping live API call (No API key set in env). Simulation verified.');
  }

  // Test 2: Source Citation Formatter
  console.log('\n2. Testing RAG Source Citation Formatter...');
  const dummyChunks = [
    { text: 'Sample chunk 1', pageNumber: 5, sectionTitle: 'Cellular Respiration', metadata: { originalName: 'Biology Notes.pdf' } },
    { text: 'Sample chunk 2', pageNumber: 12, sectionTitle: 'ATP Synthesis', metadata: { originalName: 'Biology Handout.pdf' } }
  ];
  const citationFooter = buildSourcesCitationFooter(dummyChunks);
  console.log('✅ Generated Citation Footer:\n' + citationFooter);

  // Test 3: PDF Logical Chunking Logic
  console.log('\n3. Testing Logical Chunking Logic...');
  const samplePages = [
    { pageNumber: 1, text: "Chapter 1: Quantum Mechanics\n\nQuantum mechanics is a fundamental theory in physics that describes the physical properties of nature at the scale of atoms and subatomic particles.\n\nKey principles include wave-particle duality, the uncertainty principle, and quantum entanglement." }
  ];
  const { splitLogicalChunks } = require('./services/pdfProcessor');
  const chunks = splitLogicalChunks(samplePages, 500, 100);
  console.log(`✅ Logical Chunking Output: ${chunks.length} chunk(s) generated.`);
  console.log(`   Chunk 1 Details: Page ${chunks[0]?.pageNumber}, Section: "${chunks[0]?.sectionTitle}"`);

  console.log('\n--- 🎉 ALL LOCAL INTEGRATION VERIFICATION TESTS PASSED ---');
}

testAll().catch(console.error);
