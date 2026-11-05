require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  try {
    const employees = await p.employee.findMany({ take: 3 });
    console.log('Sample employees:', employees.length);
    const teachers = await p.teacher.findMany({ take: 3 });
    console.log('Sample teachers:', teachers.length);
    const users = await p.user.findMany({
      where: { role: { in: ['teacher', 'employee', 'staff'] } },
      take: 5
    });
    console.log('Sample staff users:', users.map(u => ({ id: u.id, role: u.role, name: u.name, college_id: u.college_id })));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await p.$disconnect();
  }
}

main();
