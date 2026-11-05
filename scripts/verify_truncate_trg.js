'use strict';
const { Client } = require('pg');
require('dotenv').config();

async function check() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const res = await c.query(`
    SELECT tgname, tgtype, tgenabled 
    FROM pg_trigger 
    WHERE tgrelid = '"MealAccountTransaction"'::regclass;
  `);
  console.log('pg_trigger rows for MealAccountTransaction:', res.rows);
  await c.end();
}
check().catch(console.error);

