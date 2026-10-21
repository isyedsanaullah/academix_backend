require('dotenv').config();
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const { FEATURES } = require('../services/capabilityCatalog');

async function seedFeatureFlags() {
  const prisma = getSystemClient();
  console.log(`Seeding FeatureFlags for ${FEATURES.length} features from capabilityCatalog...`);

  let createdCount = 0;
  let existingCount = 0;

  for (const feature of FEATURES) {
    const release = feature.status === 'live' ? 'GA' : 'HIDDEN';

    const existing = await prisma.featureFlag.findUnique({
      where: { key: feature.key }
    });

    if (existing) {
      if (existing.release !== release) {
        await prisma.featureFlag.update({
          where: { key: feature.key },
          data: { release }
        });
      }
      existingCount++;
    } else {
      await prisma.featureFlag.create({
        data: {
          key: feature.key,
          release,
          killSwitch: false,
          betaColleges: []
        }
      });
      createdCount++;
    }
  }

  console.log(`FeatureFlag seed complete: ${createdCount} created, ${existingCount} already existed.`);
}

if (require.main === module) {
  seedFeatureFlags()
    .catch(err => {
      console.error('Failed to seed feature flags:', err);
      process.exit(1);
    })
    .finally(async () => {
      await closeAllClients();
    });
}

module.exports = { seedFeatureFlags };
