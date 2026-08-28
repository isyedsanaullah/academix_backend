const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Cache: connectionUrl -> PrismaClient
const clients = new Map();
// Cache: connectionUrl -> pg.Pool (only for postgres urls using driver adapter)
const pools = new Map();

/**
 * Get or create a Prisma Client instance for a given PostgreSQL connection URL.
 * Scoped dynamically for each college/tenant, or for system DB.
 * 
 * @param {string} connectionUrl - The PostgreSQL connection URL
 * @returns {PrismaClient}
 */
function getTenantClient(connectionUrl) {
  if (!connectionUrl) {
    throw new Error('Connection URL is required for getTenantClient');
  }

  // Return cached client if available
  if (clients.has(connectionUrl)) {
    return clients.get(connectionUrl);
  }

  let client;

  // Prisma Postgres (prisma+postgres://) or Accelerate does not require pg adapter
  if (connectionUrl.startsWith('prisma://') || connectionUrl.startsWith('prisma+postgres://')) {
    client = new PrismaClient({
      accelerateUrl: connectionUrl
    });
  } else {
    // Standard PostgreSQL URL (postgresql:// or postgres://) -> use pg Pool + PrismaPg adapter
    try {
      const isSsl = connectionUrl.includes('sslmode=require') || 
                    connectionUrl.includes('neon.tech') || 
                    connectionUrl.includes('render.com') || 
                    connectionUrl.includes('supabase.co');

      const poolConfig = {
        connectionString: connectionUrl,
        max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };

      if (isSsl) {
        poolConfig.ssl = { rejectUnauthorized: false };
      }

      const pool = new Pool(poolConfig);

      pools.set(connectionUrl, pool);
      
      const adapter = new PrismaPg(pool);
      client = new PrismaClient({ adapter });
    } catch (err) {
      console.error(`❌ Failed to initialize PrismaClient with pg adapter for URL: ${connectionUrl}`, err);
      // Fallback to direct client initialization
      client = new PrismaClient({
        accelerateUrl: connectionUrl
      });
    }
  }

  clients.set(connectionUrl, client);
  return client;
}

/**
 * Get the system Prisma Client instance using DATABASE_URL.
 */
let systemClient = null;
function getSystemClient() {
  if (!systemClient) {
    const systemUrl = process.env.DATABASE_URL;
    if (!systemUrl) {
      throw new Error('DATABASE_URL env variable is not set');
    }
    systemClient = getTenantClient(systemUrl);
  }
  return systemClient;
}

/**
 * Close all active Prisma Clients and pg Pools.
 */
async function closeAllClients() {
  console.log('🔌 Shutting down all Prisma clients and pools...');
  
  const disconnectPromises = [];
  for (const client of clients.values()) {
    disconnectPromises.push(client.$disconnect());
  }
  await Promise.all(disconnectPromises);

  const closePoolPromises = [];
  for (const pool of pools.values()) {
    closePoolPromises.push(pool.end());
  }
  await Promise.all(closePoolPromises);

  clients.clear();
  pools.clear();
  systemClient = null;
  
  console.log('✅ All Prisma clients and pools shut down successfully.');
}

module.exports = {
  getTenantClient,
  getSystemClient,
  closeAllClients,
  clients,
  pools
};
