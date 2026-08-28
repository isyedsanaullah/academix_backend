require('dotenv').config();
const { getSystemClient, getTenantClient, closeAllClients } = require('../config/prismaManager');
const { generateCardId } = require('../utils/cardIdGenerator');

async function runBackfill() {
  console.log('🔄 Running Unified Card ID, Roll Number & QR Code Sync Seeder...');
  const prisma = getSystemClient();

  try {
    const colleges = await prisma.college.findMany();
    console.log(`🏫 Found ${colleges.length} college(s) to process.`);

    let totalStudentsSynced = 0;
    let totalTeachersSynced = 0;
    let totalUsersSynced = 0;

    for (const college of colleges) {
      console.log(`\n--------------------------------------------------`);
      console.log(`📌 Processing College: ${college.name} (${college.code || college.id})`);
      const dbUrl = college.mongoUrl || process.env.DATABASE_URL;
      const tenantDb = getTenantClient(dbUrl);

      // 1. Sync Students (rollNumber = cardId = qrCode across Student & User)
      const allStudents = await tenantDb.student.findMany({
        where: { college_id: college.id }
      });
      console.log(`🎓 Syncing ${allStudents.length} student(s)...`);

      let studentSeq = 1;
      for (const student of allStudents) {
        const collegeCode = college.code ? college.code.toUpperCase() : 'PCS';
        const yy = String(new Date().getFullYear()).slice(-2);
        const cardId = `${collegeCode}-STU${yy}-${String(studentSeq).padStart(4, '0')}`;
        studentSeq++;

        // Update Tenant Student record
        await tenantDb.student.update({
          where: { id: student.id },
          data: {
            qrCode: cardId,
            cardId: cardId,
            rollNumber: cardId
          }
        });
        totalStudentsSynced++;

        // Update System User record if linked
        if (student.user_id) {
          await prisma.user.update({
            where: { id: student.user_id },
            data: { qrCode: cardId }
          }).catch(() => {});
        } else if (student.email) {
          await prisma.user.updateMany({
            where: { email: student.email.toLowerCase() },
            data: { qrCode: cardId }
          }).catch(() => {});
        }
      }

      // 2. Sync Teachers
      const allTeachers = await tenantDb.teacher.findMany({
        where: { college_id: college.id }
      });
      console.log(`👨‍🏫 Syncing ${allTeachers.length} teacher(s)...`);

      let teacherSeq = 1;
      for (const teacher of allTeachers) {
        const collegeCode = college.code ? college.code.toUpperCase() : 'PCS';
        const yy = String(new Date().getFullYear()).slice(-2);
        const cardId = `${collegeCode}-TCH${yy}-${String(teacherSeq).padStart(4, '0')}`;
        teacherSeq++;

        await tenantDb.teacher.update({
          where: { id: teacher.id },
          data: {
            qrCode: cardId,
            employeeCode: cardId
          }
        });
        totalTeachersSynced++;

        if (teacher.user_id) {
          await prisma.user.update({
            where: { id: teacher.user_id },
            data: { qrCode: cardId }
          }).catch(() => {});
        }
      }

      // 3. Sync Remaining Users (Staff / Admins / Employees)
      const allUsers = await prisma.user.findMany({
        where: { college_id: college.id }
      });
      console.log(`👥 Checking ${allUsers.length} user account(s)...`);

      let empSeq = 1;
      for (const user of allUsers) {
        // If user already got synced via student/teacher, skip or overwrite with role format
        if (user.role === 'admin' || user.role === 'principal' || user.role === 'employee' || user.role === 'registrar' || user.role === 'accountant') {
          const typePrefix = user.role === 'employee' ? 'EMP' : 'ADM';
          const collegeCode = college.code ? college.code.toUpperCase() : 'PCS';
          const yy = String(new Date().getFullYear()).slice(-2);
          const cardId = `${collegeCode}-${typePrefix}${yy}-${String(empSeq).padStart(4, '0')}`;
          empSeq++;

          await prisma.user.update({
            where: { id: user.id },
            data: { qrCode: cardId }
          });
          totalUsersSynced++;
        }
      }
    }

    console.log(`\n==================================================`);
    console.log(`🎉 UNIFIED SYNC COMPLETE!`);
    console.log(`   - Students Synced: ${totalStudentsSynced}`);
    console.log(`   - Teachers Synced: ${totalTeachersSynced}`);
    console.log(`   - Users Synced:    ${totalUsersSynced}`);
    console.log(`==================================================\n`);

  } catch (error) {
    console.error('❌ Sync failed with error:', error.message || error);
  } finally {
    await closeAllClients();
    process.exit(0);
  }
}

runBackfill();
