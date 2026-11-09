const fs = require('fs');
const path = require('path');
const backendDir = 'D:/projects/CESMS/backend';
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });
const { getSystemClient, closeAllClients } = require(path.join(backendDir, 'config/prismaManager'));

async function main() {
  const prisma = getSystemClient();
  const backupDir = path.join(backendDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `college_payments_backup_${timestamp}.json`);

  console.log(`Taking snapshot of College and CollegeSubscriptionPayment tables to: ${backupPath}...`);

  const colleges = await prisma.college.findMany();
  const payments = await prisma.collegeSubscriptionPayment.findMany();

  const payload = {
    timestamp: new Date().toISOString(),
    counts: { colleges: colleges.length, payments: payments.length },
    colleges,
    payments
  };

  fs.writeFileSync(backupPath, JSON.stringify(payload, null, 2));
  console.log(`✅ Backup successfully saved. Total colleges: ${colleges.length}, payments: ${payments.length}`);

  await closeAllClients();
}

main().catch(err => {
  console.error('BACKUP_FAILED:', err);
  process.exit(1);
});

