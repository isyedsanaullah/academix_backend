'use strict';

const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

class AssetService {
  /**
   * Register a new fixed asset with straight-line depreciation calculation.
   */
  async registerAsset({
    collegeId,
    campusId = null,
    assetCode,
    name,
    category,
    location,
    purchaseDate,
    purchaseCostPkr,
    salvageValuePkr = 0,
    usefulLifeYears = 5,
    serialNumber = null,
    vendorId = null,
  }) {
    if (!collegeId || !assetCode || !name || !category || !location || !purchaseDate || purchaseCostPkr === undefined) {
      const err = new Error('collegeId, assetCode, name, category, location, purchaseDate, and purchaseCostPkr are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const cost = Number(purchaseCostPkr);
    const salvage = Number(salvageValuePkr) || 0;
    const lifeYears = Number(usefulLifeYears) || 5;

    if (lifeYears <= 0) {
      const err = new Error('usefulLifeYears must be greater than 0');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    // Straight-line depreciation rate
    const annualDepreciation = (cost - salvage) / lifeYears;
    const depreciationRate = cost > 0 ? (annualDepreciation / cost) * 100 : 0;

    return await prisma.fixedAsset.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        assetCode,
        name,
        category,
        location,
        purchaseDate: new Date(purchaseDate),
        purchaseCostPkr: cost,
        salvageValuePkr: salvage,
        usefulLifeYears: lifeYears,
        currentValuePkr: cost,
        depreciationRate: parseFloat(depreciationRate.toFixed(2)),
        serialNumber,
        vendorId,
        status: 'IN_USE',
      },
    });
  }

  /**
   * Compute straight-line net book value as of a given date.
   */
  calculateNetBookValue(asset, asOfDate = new Date()) {
    const pDate = new Date(asset.purchaseDate);
    const targetDate = new Date(asOfDate);

    const diffMs = targetDate.getTime() - pDate.getTime();
    let elapsedYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
    if (Math.abs(elapsedYears - Math.round(elapsedYears)) < 0.05) {
      elapsedYears = Math.round(elapsedYears);
    }
    elapsedYears = Math.max(0, elapsedYears);

    const cost = Number(asset.purchaseCostPkr);
    const salvage = Number(asset.salvageValuePkr) || 0;
    const lifeYears = Number(asset.usefulLifeYears);

    const annualDepreciation = (cost - salvage) / lifeYears;
    const totalDepreciable = Math.max(0, cost - salvage);

    const accumulatedDepreciation = Math.min(totalDepreciable, Math.round(elapsedYears * annualDepreciation));
    const netBookValue = Math.max(salvage, cost - accumulatedDepreciation);

    return {
      assetCode: asset.assetCode,
      purchaseCostPkr: cost,
      salvageValuePkr: salvage,
      elapsedYears: parseFloat(elapsedYears.toFixed(2)),
      accumulatedDepreciationPkr: accumulatedDepreciation,
      netBookValuePkr: netBookValue,
    };
  }

  /**
   * Update fixed asset current value to reflect elapsed depreciation.
   */
  async applyDepreciation({ collegeId, assetId, asOfDate = new Date() }) {
    const asset = await prisma.fixedAsset.findFirst({
      where: { id: assetId, college_id: collegeId },
    });
    if (!asset) {
      const err = new Error('Asset not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const { netBookValuePkr } = this.calculateNetBookValue(asset, asOfDate);

    return await prisma.fixedAsset.update({
      where: { id: assetId },
      data: { currentValuePkr: netBookValuePkr },
    });
  }

  /**
   * Log maintenance or repair service for an asset.
   */
  async logMaintenance({ collegeId, assetId, serviceDate, costPkr = 0, description, servicedBy }) {
    if (!collegeId || !assetId || !serviceDate || !description || !servicedBy) {
      const err = new Error('collegeId, assetId, serviceDate, description, and servicedBy are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    return await prisma.assetMaintenanceLog.create({
      data: {
        college_id: collegeId,
        assetId,
        serviceDate: new Date(serviceDate),
        costPkr: Number(costPkr) || 0,
        description,
        servicedBy,
      },
    });
  }

  /**
   * List assets with maintenance logs.
   */
  async listAssets({ collegeId, category = null, status = null }) {
    const where = { college_id: collegeId };
    if (category) where.category = category;
    if (status) where.status = status;

    return await prisma.fixedAsset.findMany({
      where,
      include: {
        maintenanceLogs: {
          orderBy: { serviceDate: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

module.exports = new AssetService();
