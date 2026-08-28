require('dotenv').config();
const { getSystemClient, closeAllClients } = require('./config/prismaManager');

async function main() {
  const prisma = getSystemClient();
  const colleges = await prisma.college.findMany();
  console.log(JSON.stringify(colleges, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await closeAllClients();
  });
