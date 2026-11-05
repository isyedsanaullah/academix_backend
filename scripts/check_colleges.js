require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  const colleges = await p.college.findMany({ select: { id: true, name: true, planId: true, subStatus: true } });
  console.log('Colleges:', colleges);
  await p.$disconnect();
}

main();

