'use strict';
const { Client } = require('pg');
require('dotenv').config();

async function checkLeave() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const res = await c.query("SELECT COUNT(*) AS total, COUNT(student_id) AS with_student, COUNT(user_id) AS with_user FROM \"LeaveApplication\";");
  console.log('LeaveApplication rows:', res.rows[0]);

  // Check unique constraints on Student (rollNumber vs college_id)
  const stIdx = await c.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='Student';");
  console.log('Student indexes:', stIdx.rows.map(r => r.indexname + ': ' + r.indexdef).join('\n'));

  await c.end();
}
checkLeave().catch(e => { console.error(e); process.exit(1); });

