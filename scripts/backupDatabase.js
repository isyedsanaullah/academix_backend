require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

async function backup() {
  const prisma = getSystemClient();
  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;

  console.log(`Found ${tables.length} tables to backup...`);
  const backupData = {
    timestamp: new Date().toISOString(),
    databaseUrl: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'),
    tables: {}
  };

  for (const { table_name } of tables) {
    try {
      // Query table content safely
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table_name}";`);
      // Serialize BigInt and other special types
      const serializedRows = JSON.parse(JSON.stringify(rows, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ));
      backupData.tables[table_name] = serializedRows;
      console.log(`  - ${table_name}: ${rows.length} rows`);
    } catch (err) {
      console.error(`  - Failed to backup ${table_name}:`, err.message);
      backupData.tables[table_name] = { error: err.message };
    }
  }

  const backupDir = path.join(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `db_backup_${timestampStr}.json`;
  const filePath = path.join(backupDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`\n Backup completed successfully: ${filePath}`);
}

backup()
  .catch(console.error)
  .finally(async () => {
    await closeAllClients();
  });
