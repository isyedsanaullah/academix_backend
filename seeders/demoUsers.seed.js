/**
 * Academix Demo Users Seeder
 * ───────────────────────
 * Creates demo users for ALL roles with @gmail.com emails and password abc123.
 * Also creates a demo college with the system DB as its tenant DB.
 *
 * Usage: node seeders/demoUsers.seed.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getSystemClient } = require('../config/prismaManager');

const PASSWORD = 'abc123';
const DEMO_TENANT_URI = process.env.DATABASE_URL;

const demoCollege = {
  name: 'Government College Sargodha',
  code: 'GCS',
  slug: 'gcs',
  mongoUrl: DEMO_TENANT_URI,
  email: 'info@gcs.edu.pk',
  phone: '048-9230123',
  address: 'University Road, Sargodha',
  city: 'Sargodha',
  website: 'https://gcs.edu.pk',
  isActive: true,
  subscription: { plan: 'premium', status: 'active', startedAt: new Date(), expiresAt: new Date('2027-12-31') },
};

const demoUsers = [
  // SuperAdmin — no college
  { name: 'Super Admin',     email: 'superadmin@gmail.com',  role: 'superAdmin',  college: false },
  // College-scoped roles
  { name: 'College Admin',   email: 'admin@gmail.com',       role: 'admin',       college: true },
  { name: 'Dr. Khalid Mehmood', email: 'principal@gmail.com', role: 'principal', college: true },
  { name: 'Registrar Office', email: 'registrar@gmail.com',  role: 'registrar',   college: true },
  { name: 'Accounts Dept',   email: 'accountant@gmail.com',  role: 'accountant',  college: true },
  { name: 'Prof. Ahmed Ali', email: 'teacher@gmail.com',     role: 'teacher',     college: true },
  { name: 'Ali Hassan',      email: 'student@gmail.com',     role: 'student',     college: true },
  { name: 'Guard Nawaz',     email: 'employee@gmail.com',    role: 'employee',    college: true },
];

async function seed() {
  try {
    const systemDb = getSystemClient();
    console.log('✅ Connected to system DB');

    // ─── Upsert College ─────────────────────────
    let college = await systemDb.college.findUnique({ where: { code: 'GCS' } });
    if (!college) {
      college = await systemDb.college.create({
        data: demoCollege
      });
      console.log(`🏫 College created: ${college.name} (${college.code})`);
    } else {
      // Update mongoUrl if not set or incorrect
      if (college.mongoUrl !== DEMO_TENANT_URI) {
        college = await systemDb.college.update({
          where: { id: college.id },
          data: { mongoUrl: DEMO_TENANT_URI }
        });
        console.log(`🏫 College updated with DATABASE_URL: ${college.code}`);
      } else {
        console.log(`🏫 College exists: ${college.name} (${college.code})`);
      }
    }

    const hashedPassword = bcrypt.hashSync(PASSWORD, 10);

    // ─── Upsert Users ───────────────────────────
    for (const u of demoUsers) {
      const existing = await systemDb.user.findUnique({ where: { email: u.email } });
      if (existing) {
        // Update password and ensure active
        await systemDb.user.update({
          where: { email: u.email },
          data: {
            password: hashedPassword,
            isActive: true,
            authProvider: 'local',
            college_id: u.college && !existing.college_id ? college.id : undefined
          }
        });
        console.log(`  ✏️  Updated: ${u.email} (${u.role})`);
      } else {
        await systemDb.user.create({
          data: {
            name: u.name,
            email: u.email,
            password: hashedPassword,
            role: u.role,
            college_id: u.college ? college.id : null,
            isActive: true,
            authProvider: 'local'
          }
        });
        console.log(`  ✅ Created: ${u.email} (${u.role})`);
      }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('  Demo Users Seeded Successfully! 🎉');
    console.log('═══════════════════════════════════════');
    console.log('  Password for ALL accounts: abc123');
    console.log('');
    console.log('  superadmin@gmail.com  → Super Admin');
    console.log('  admin@gmail.com       → College Admin');
    console.log('  principal@gmail.com   → Principal');
    console.log('  registrar@gmail.com   → Registrar');
    console.log('  accountant@gmail.com  → Accountant');
    console.log('  teacher@gmail.com     → Teacher');
    console.log('  student@gmail.com     → Student');
    console.log('  employee@gmail.com    → Employee/Guard');
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
}

seed();
