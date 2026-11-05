require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  try {
    const tables = await p.$queryRawUnsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name ILIKE '%biometric%'
    `);
    console.log('Tables matching biometric:', tables);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await p.$disconnect();
  }
}

main();

