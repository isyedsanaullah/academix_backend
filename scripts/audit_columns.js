'use strict';
const { Client } = require('pg');
require('dotenv').config();

async function checkCols() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  for (const t of ['Attendance', 'LeaveApplication', 'BulkImportJob', 'PaymentProof', 'Group']) {
    const res = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position;`, [t]);
    console.log(`\nColumns of ${t}:`, res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
  }

  // Check unique constraints on Attendance and Group
  const idx = await c.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('Attendance', 'Group', 'BulkImportJob');`);
  console.log('\nIndexes:', idx.rows.map(r => `${r.indexname}: ${r.indexdef}`).join('\n'));

  await c.end();
}
checkCols().catch(e => { console.error(e); process.exit(1); });

