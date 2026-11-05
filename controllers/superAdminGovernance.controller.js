/**
 * superAdminGovernance.controller.js — Phase 6B
 * Super Admin Governance Deck:
 * - Dynamic Quota Overrides (all 16 metrics, -1 = unlimited sentinel)
 * - Feature Overrides (blocks FORCE_ON for coming_soon features)
 * - Governance Actions: Suspend (bumps tokenEpoch), Reactivate, Clear Read-Only, Extend Trial (max 2)
 * - Credit Adjustments
 * - Full audit trail via CollegeEntitlementAudit with DB trigger immutability
 */

const { getSystemClient } = require('../config/prismaManager');
const { FEATURE_REGISTRY } = require('../config/featureRegistry');
const { getEntitlements } = require('../services/entitlements');

// Map features by key for O(1) status lookup
const registryMap = new Map();
for (const f of FEATURE_REGISTRY) {
  registryMap.set(f.key, f);
}

/**
 * PUT /api/super-admin/colleges/:id/quotas
 * Upserts or removes overrides in CollegeQuotaOverride table.
 */
async function setCollegeQuotas(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const reason = body.reason;
    const overrides = body.overrides && typeof body.overrides === 'object' ? body.overrides : body;
    const prisma = getSystemClient();

    if (!overrides || typeof overrides !== 'object') {
      return res.status(400).json({ success: false, message: 'Overrides object is required' });
    }

    const cleanOverrides = { ...overrides };
    delete cleanOverrides.reason;

    const college = await prisma.college.findUnique({
      where: { id },
      include: { quotaOverrides: true }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const beforeState = {};
    for (const qo of college.quotaOverrides) {
      beforeState[qo.metric] = qo.overrideValue.toString();
    }

    const afterState = { ...beforeState };

    // Process each metric override
    for (const [metric, val] of Object.entries(cleanOverrides)) {
      if (val === null || val === undefined || val === 'REMOVE' || val === '') {
        // Delete override if exists
        await prisma.collegeQuotaOverride.deleteMany({
          where: { college_id: id, metric }
        });
        delete afterState[metric];
      } else {
        const numVal = BigInt(val);
        await prisma.collegeQuotaOverride.upsert({
          where: {
            college_id_metric: { college_id: id, metric }
          },
          update: {
            overrideValue: numVal,
            reason: reason || 'SuperAdmin quota override',
            createdBy: req.user?.id || 'SUPER_ADMIN'
          },
          create: {
            college_id: id,
            metric,
            overrideValue: numVal,
            reason: reason || 'SuperAdmin quota override',
            createdBy: req.user?.id || 'SUPER_ADMIN'
          }
        });
        afterState[metric] = numVal.toString();
      }
    }

    // Write immutable audit record
    await prisma.collegeEntitlementAudit.create({
      data: {
        college_id: id,
        actorUserId: req.user?.id || 'SUPER_ADMIN',
        actorEmail: req.user?.email || null,
        action: 'QUOTA_OVERRIDE',
        beforeStateJson: beforeState,
        afterStateJson: afterState,
        reason: reason || 'Updated quota overrides',
        ipAddress: req.ip || null
      }
    });

    const updatedEntitlements = await getEntitlements(id);

    return res.json({
      success: true,
      message: 'Quota overrides updated successfully',
      overrides: afterState,
      entitlements: updatedEntitlements
    });
  } catch (error) {
    console.error('[setCollegeQuotas] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update quota overrides', error: error.message });
  }
}

/**
 * PUT /api/super-admin/colleges/:id/features
 * Updates feature overrides. Blocks FORCE_ON for coming_soon features.
 */
async function setCollegeFeatures(req, res) {
  try {
    const { id } = req.params;
    const { overrides, reason } = req.body;
    const prisma = getSystemClient();

    if (!overrides || typeof overrides !== 'object') {
      return res.status(400).json({ success: false, message: 'Overrides object is required' });
    }

    const cleanOverrides = { ...overrides };
    delete cleanOverrides.reason;

    // Validation: FORCE_ON cannot be applied to coming_soon features
    for (const [key, state] of Object.entries(overrides)) {
      if (state === 'FORCE_ON') {
        const feat = registryMap.get(key);
        if (feat && feat.status === 'coming_soon') {
          return res.status(400).json({
            success: false,
            code: 'CANNOT_FORCE_ON_COMING_SOON',
            message: `Feature '${key}' is coming soon and cannot be forced on`
          });
        }
      }
    }

    const college = await prisma.college.findUnique({
      where: { id }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const beforeState = college.feature_overrides || {};
    const afterState = { ...beforeState, ...overrides };

    // Clean up DEFAULT entries (delete key)
    for (const [k, v] of Object.entries(afterState)) {
      if (v === 'DEFAULT' || v === null || v === undefined) {
        delete afterState[k];
      }
    }

    const existingSub = (college.subscription && typeof college.subscription === 'object') ? college.subscription : {};

    await prisma.college.update({
      where: { id },
      data: {
        feature_overrides: afterState,
        subscription: {
          ...existingSub,
          featureOverrides: afterState
        }
      }
    });

    // Write immutable audit record
    await prisma.collegeEntitlementAudit.create({
      data: {
        college_id: id,
        actorUserId: req.user?.id || 'SUPER_ADMIN',
        actorEmail: req.user?.email || null,
        action: 'FEATURE_OVERRIDE',
        beforeStateJson: beforeState,
        afterStateJson: afterState,
        reason: reason || 'Updated feature overrides',
        ipAddress: req.ip || null
      }
    });

    return res.json({
      success: true,
      message: 'Feature overrides updated successfully',
      featureOverrides: afterState
    });
  } catch (error) {
    console.error('[setCollegeFeatures] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update feature overrides', error: error.message });
  }
}

/**
 * POST /api/super-admin/colleges/:id/actions
 * Handles governance actions: suspend, reactivate, clear-readonly, extend-trial
 */
async function handleCollegeAction(req, res) {
  try {
    const { id } = req.params;
    const { action, days, reason } = req.body;
    const prisma = getSystemClient();

    const college = await prisma.college.findUnique({
      where: { id }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const beforeState = {
      subStatus: college.subStatus,
      status: college.status,
      forceReadOnly: college.forceReadOnly,
      readOnlyReason: college.readOnlyReason,
      trialEndsAt: college.trialEndsAt,
      trialExtensionCount: college.trialExtensionCount,
      tokenEpoch: college.tokenEpoch
    };

    if (action === 'suspend') {
      const updated = await prisma.college.update({
        where: { id },
        data: {
          subStatus: 'SUSPENDED',
          status: 'suspended',
          preSuspendStatus: college.subStatus,
          tokenEpoch: { increment: 1 }
        }
      });

      await prisma.collegeEntitlementAudit.create({
        data: {
          college_id: id,
          actorUserId: req.user?.id || 'SUPER_ADMIN',
          actorEmail: req.user?.email || null,
          action: 'SUSPEND',
          beforeStateJson: beforeState,
          afterStateJson: {
            subStatus: updated.subStatus,
            preSuspendStatus: updated.preSuspendStatus,
            tokenEpoch: updated.tokenEpoch
          },
          reason: reason || 'SuperAdmin administrative suspension',
          ipAddress: req.ip || null
        }
      });

      return res.json({
        success: true,
        message: 'College suspended successfully. All active sessions revoked.',
        subStatus: updated.subStatus,
        tokenEpoch: updated.tokenEpoch
      });
    }

    if (action === 'reactivate') {
      const restoredStatus = college.preSuspendStatus || 'ACTIVE';
      const updated = await prisma.college.update({
        where: { id },
        data: {
          subStatus: restoredStatus,
          status: 'active',
          preSuspendStatus: null,
          tokenEpoch: { increment: 1 }
        }
      });

      await prisma.collegeEntitlementAudit.create({
        data: {
          college_id: id,
          actorUserId: req.user?.id || 'SUPER_ADMIN',
          actorEmail: req.user?.email || null,
          action: 'REACTIVATE',
          beforeStateJson: beforeState,
          afterStateJson: {
            subStatus: updated.subStatus,
            preSuspendStatus: null,
            tokenEpoch: updated.tokenEpoch
          },
          reason: reason || 'SuperAdmin reactivated college',
          ipAddress: req.ip || null
        }
      });

      return res.json({
        success: true,
        message: `College reactivated to ${restoredStatus}. Fresh logins permitted.`,
        subStatus: updated.subStatus,
        tokenEpoch: updated.tokenEpoch
      });
    }

    if (action === 'clear-readonly') {
      const updated = await prisma.college.update({
        where: { id },
        data: {
          forceReadOnly: false,
          readOnlyReason: null
        }
      });

      await prisma.collegeEntitlementAudit.create({
        data: {
          college_id: id,
          actorUserId: req.user?.id || 'SUPER_ADMIN',
          actorEmail: req.user?.email || null,
          action: 'CLEAR_READONLY',
          beforeStateJson: beforeState,
          afterStateJson: {
            forceReadOnly: false,
            readOnlyReason: null
          },
          reason: reason || 'SuperAdmin cleared read-only lock',
          ipAddress: req.ip || null
        }
      });

      return res.json({
        success: true,
        message: 'Read-only lock cleared successfully',
        forceReadOnly: false,
        readOnlyReason: null
      });
    }

    if (action === 'extend-trial') {
      if ((college.trialExtensionCount || 0) >= 2) {
        return res.status(422).json({
          success: false,
          code: 'MAX_TRIAL_EXTENSIONS_EXCEEDED',
          message: 'Maximum 2 trial extensions permitted per college'
        });
      }

      const extensionDays = Number(days) || 7;
      const currentEnd = college.trialEndsAt ? new Date(college.trialEndsAt) : new Date();
      const baseMs = Math.max(Date.now(), currentEnd.getTime());
      const newTrialEndsAt = new Date(baseMs + extensionDays * 86400000);

      const updateData = {
        trialEndsAt: newTrialEndsAt,
        trialExtensionCount: { increment: 1 }
      };

      // If locked because of TRIAL_EXPIRED, unlock
      if (college.readOnlyReason === 'TRIAL_EXPIRED') {
        updateData.forceReadOnly = false;
        updateData.readOnlyReason = null;
      }

      const updated = await prisma.college.update({
        where: { id },
        data: updateData
      });

      await prisma.collegeEntitlementAudit.create({
        data: {
          college_id: id,
          actorUserId: req.user?.id || 'SUPER_ADMIN',
          actorEmail: req.user?.email || null,
          action: 'EXTEND_TRIAL',
          beforeStateJson: beforeState,
          afterStateJson: {
            trialEndsAt: updated.trialEndsAt,
            trialExtensionCount: updated.trialExtensionCount,
            forceReadOnly: updated.forceReadOnly,
            readOnlyReason: updated.readOnlyReason
          },
          reason: reason || `Extended trial by ${extensionDays} days`,
          ipAddress: req.ip || null
        }
      });

      return res.json({
        success: true,
        message: `Trial extended by ${extensionDays} days. Total extensions used: ${updated.trialExtensionCount}/2`,
        trialEndsAt: updated.trialEndsAt,
        trialExtensionCount: updated.trialExtensionCount,
        forceReadOnly: updated.forceReadOnly
      });
    }

    if (action === 'reset-2fa') {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, message: 'userId is required for reset-2fa action' });
      }
      if (!reason || !reason.trim()) {
        return res.status(400).json({ success: false, message: 'Mandatory reason is required for reset-2fa action' });
      }

      // Step-up verification for reset-2fa
      if (!req.stepUpSession) {
        const stepUpToken = req.headers['x-step-up-token'];
        if (!stepUpToken) {
          return res.status(401).json({
            success: false,
            code: 'STEP_UP_REQUIRED',
            message: 'Step-up authentication required for reset-2fa'
          });
        }
        try {
          const jwt = require('jsonwebtoken');
          const { STEP_UP_SECRET } = require('../middleware/stepUpAuth');
          const decoded = jwt.verify(stepUpToken, STEP_UP_SECRET);
          // Check single-use
          const used = await prisma.usedStepUpToken.findUnique({ where: { jti: decoded.jti } });
          if (used) {
            return res.status(401).json({ success: false, code: 'STEP_UP_TOKEN_ALREADY_USED', message: 'Step-up token already used' });
          }
          await prisma.usedStepUpToken.create({
            data: { jti: decoded.jti, kind: 'stepup', expiresAt: new Date(decoded.exp * 1000) }
          });
        } catch (e) {
          return res.status(401).json({
            success: false,
            code: 'INVALID_STEP_UP_TOKEN',
            message: 'Step-up token invalid or expired: ' + e.message
          });
        }
      }

      const targetUser = await prisma.user.findFirst({
        where: { id: userId, college_id: id }
      });
      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'User not found in this college' });
      }

      const userBefore = {
        totpEnabled: targetUser.totpEnabled,
        twofaEnrolledAt: targetUser.twofaEnrolledAt
      };

      await prisma.user.update({
        where: { id: targetUser.id },
        data: {
          totpEnabled: false,
          totpSecretEnc: null,
          totpLastStep: null,
          totpBackupCodes: null,
          twofaEnrolledAt: null,
          totpFailedAttempts: 0,
          totpLockedUntil: null
        }
      });

      await prisma.knownDevice.deleteMany({
        where: { userId: targetUser.id }
      });

      await prisma.collegeEntitlementAudit.create({
        data: {
          college_id: id,
          actorUserId: req.user?.id || 'SUPER_ADMIN',
          actorEmail: req.user?.email || null,
          action: 'RESET_2FA',
          beforeStateJson: userBefore,
          afterStateJson: { totpEnabled: false, resetAt: new Date().toISOString() },
          reason: reason,
          ipAddress: req.ip || null
        }
      });

      return res.json({
        success: true,
        message: `2FA reset successfully for user ${targetUser.email}. User re-enrols at next login.`
      });
    }

    if (action === 'disable-ip-allowlist') {
      if (!reason) {
        return res.status(400).json({ success: false, message: 'Reason is required to disable IP allow-list' });
      }

      const beforeState = { ipAllowlistMode: college.ipAllowlistMode };
      const updated = await prisma.college.update({
        where: { id },
        data: { ipAllowlistMode: 'OFF' }
      });

      await prisma.collegeEntitlementAudit.create({
        data: {
          college_id: id,
          actorUserId: req.user?.id || 'SUPER_ADMIN',
          actorEmail: req.user?.email || null,
          action: 'DISABLE_IP_ALLOWLIST',
          beforeStateJson: beforeState,
          afterStateJson: { ipAllowlistMode: 'OFF' },
          reason: reason,
          ipAddress: req.ip || null
        }
      });

      return res.json({
        success: true,
        message: 'IP allow-list perimeter disabled. Access restored to all IP addresses.',
        ipAllowlistMode: 'OFF'
      });
    }

    return res.status(400).json({
      success: false,
      message: `Unknown action: '${action}'. Supported: suspend, reactivate, clear-readonly, extend-trial, reset-2fa, disable-ip-allowlist`
    });
  } catch (error) {
    console.error('[handleCollegeAction] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to execute governance action', error: error.message });
  }
}

/**
 * POST /api/super-admin/colleges/:id/adjust-credits
 * Adjusts billing credits with mandatory reason and entitlement audit
 */
async function adjustCollegeCredits(req, res) {
  try {
    const { id } = req.params;
    const { amountPkr, reason } = req.body;
    const prisma = getSystemClient();

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Mandatory reason is required for credit adjustments' });
    }

    const college = await prisma.college.findUnique({
      where: { id }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const delta = Number(amountPkr) || 0;
    const currentCredits = Number(college.creditBalancePkr || 0);
    const newCredits = currentCredits + delta;

    await prisma.collegeEntitlementAudit.create({
      data: {
        college_id: id,
        actorUserId: req.user?.id || 'SUPER_ADMIN',
        actorEmail: req.user?.email || null,
        action: 'CREDIT_ADJUSTMENT',
        beforeStateJson: { creditBalancePkr: currentCredits },
        afterStateJson: { creditBalancePkr: newCredits, adjustment: delta },
        reason: reason.trim(),
        ipAddress: req.ip || null
      }
    });

    return res.json({
      success: true,
      message: `Credit balance adjusted by PKR ${delta}. New balance: PKR ${newCredits}`,
      creditBalancePkr: newCredits
    });
  } catch (error) {
    console.error('[adjustCollegeCredits] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to adjust credits', error: error.message });
  }
}

module.exports = {
  setCollegeQuotas,
  setCollegeFeatures,
  handleCollegeAction,
  adjustCollegeCredits
};
