'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

const initialPricing = [
  {
    modelName: 'gemini-2.0-flash',
    provider: 'gemini',
    version: 1,
    inputPricePerMillionUsd: 0.100000,
    outputPricePerMillionUsd: 0.400000,
    cachedInputPricePerMillionUsd: 0.025000,
    reasoningPricePerMillionUsd: 0.400000,
    effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    effectiveTo: null,
    isActive: true,
    notes: 'Google AI Studio standard tier for Gemini 2.0 Flash'
  },
  {
    modelName: 'gemini-2.5-flash',
    provider: 'gemini',
    version: 1,
    inputPricePerMillionUsd: 0.100000,
    outputPricePerMillionUsd: 0.400000,
    cachedInputPricePerMillionUsd: 0.025000,
    reasoningPricePerMillionUsd: 0.400000,
    effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    effectiveTo: null,
    isActive: true,
    notes: 'Google AI Studio standard tier for Gemini 2.5 Flash'
  },
  {
    modelName: 'gemini-1.5-flash',
    provider: 'gemini',
    version: 1,
    inputPricePerMillionUsd: 0.075000,
    outputPricePerMillionUsd: 0.300000,
    cachedInputPricePerMillionUsd: 0.018750,
    reasoningPricePerMillionUsd: 0.300000,
    effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    effectiveTo: null,
    isActive: true,
    notes: 'Google AI Studio standard tier for Gemini 1.5 Flash (<= 128k prompt)'
  },
  {
    modelName: 'gemini-1.5-pro',
    provider: 'gemini',
    version: 1,
    inputPricePerMillionUsd: 1.250000,
    outputPricePerMillionUsd: 5.000000,
    cachedInputPricePerMillionUsd: 0.312500,
    reasoningPricePerMillionUsd: 5.000000,
    effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    effectiveTo: null,
    isActive: true,
    notes: 'Google AI Studio standard tier for Gemini 1.5 Pro (<= 128k prompt)'
  },
  {
    modelName: 'text-embedding-004',
    provider: 'gemini',
    version: 1,
    inputPricePerMillionUsd: 0.020000,
    outputPricePerMillionUsd: 0.000000,
    cachedInputPricePerMillionUsd: 0.000000,
    reasoningPricePerMillionUsd: 0.000000,
    effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    effectiveTo: null,
    isActive: true,
    notes: 'Google AI Studio standard tier for text-embedding-004'
  }
];

async function seed() {
  console.log('Seeding initial AIModelPricing records...');
  for (const item of initialPricing) {
    const existing = await prisma.aIModelPricing.findUnique({
      where: {
        modelName_version: {
          modelName: item.modelName,
          version: item.version
        }
      }
    });

    if (!existing) {
      await prisma.aIModelPricing.create({
        data: item
      });
      console.log(`Created pricing for ${item.modelName} (v${item.version})`);
    } else {
      console.log(`Pricing for ${item.modelName} (v${item.version}) already exists.`);
    }
  }

  // Ensure default global alert config exists
  const globalAlert = await prisma.aIUsageAlertConfig.findUnique({
    where: { collegeId: null }
  }).catch(() => null);

  const existingGlobal = await prisma.aIUsageAlertConfig.findFirst({
    where: { collegeId: null }
  });

  if (!existingGlobal) {
    await prisma.aIUsageAlertConfig.create({
      data: {
        collegeId: null,
        dailyCostLimitUsd: 20.00,
        monthlyCostLimitUsd: 300.00,
        dailyTokenLimit: 10000000n, // 10M tokens/day
        isEnabled: true,
        alertEmail: 'admin@collegeshub.com'
      }
    });
    console.log('Created default global AI usage alert config.');
  }

  console.log('AI Pricing seed completed successfully.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Failed to seed AI pricing:', err);
  process.exit(1);
});

