'use strict';
const { Client } = require('pg');
require('dotenv').config();

async function check() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const res = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;");
  console.log('Tables in DB count:', res.rows.length);
  console.log(res.rows.map(r => r.table_name).join(', '));

  // Check triggers on MealAccountTransaction
  const trg = await c.query("SELECT trigger_name, event_manipulation, action_statement FROM information_schema.triggers WHERE event_object_table='MealAccountTransaction';");
  console.log('MealAccountTransaction triggers:', trg.rows);

  // Check attendance tables
  const att = res.rows.filter(r => r.table_name.toLowerCase().includes('attend') || r.table_name.toLowerCase().includes('leave'));
  console.log('Attendance/Leave tables:', att.map(r => r.table_name));

  await c.end();
}
check().catch(e => { console.error(e); process.exit(1); });

