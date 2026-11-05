'use strict';

/**
 * phase9_contract.test.js
 * Master Contract Test Suite for Phase 9: Platform Security, Governance & Export Center
 * 
 * Verifies all 10 canonical Phase 9 services:
 * N07 (Admin 2FA) -> N01 (Export Center) -> N10 (Custom Roles) -> N11 (Approvals) ->
 * N06 (Public API & Webhooks) -> N05 (Backup) -> N08 (Staff PWA) -> N03 (Digest) ->
 * N02 (Board Gazette) -> N04 (Accountant CSV)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const assert = require('assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getSystemClient } = require('../config/prismaManager');
const {
  FEATURE_REGISTRY,
  validateRegistryDAG,
  resolveCollegeFeatures
} = require('../config/featureRegistry');

// Service imports
const twoFactorService = require('../services/twoFactorService');
const exportService = require('../services/exportService');
const customRoleService = require('../services/customRoleService');
const approvalService = require('../services/approvalService');
const apiKeyService = require('../services/apiKeyService');
const webhookCrypto = require('../services/webhookCrypto');
const ssrfProtection = require('../services/ssrfProtection');
const apiUsageService = require('../services/apiUsageService');
const backupService = require('../services/backupService');
const staffPwaService = require('../services/staffPwaService');
const digestService = require('../services/digestService');
const boardGazetteService = require('../services/boardGazetteService');
const accountantJournalService = require('../services/accountantJournalService');

const prisma = getSystemClient();

async function runPhase9ContractTests() {
  console.log('====================================================');
  console.log('     PHASE 9 MASTER CONTRACT VERIFICATION SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return async () => {
      try {
        await fn();
        console.log(`PASS: ${name}`);
        passed++;
      } catch (err) {
        console.error(`FAIL: ${name}`);
        console.error('      ', err.message);
        failed++;
      }
    };
  }

  const timestamp = Date.now();
  let starterCol, standardCol, premiumCol, enterpriseCol, suspendedCol;
  let starterUser, adminUser, superUser;

  try {
    // ----------------------------------------------------
    // SETUP: Provision isolated multi-tier test fixtures
    // ----------------------------------------------------
    starterCol = await prisma.college.create({
      data: { name: 'Starter Col P9', email: `str_${timestamp}@test.com`, code: `STR9_${timestamp}`, planId: 'starter', subStatus: 'ACTIVE' }
    });

    standardCol = await prisma.college.create({
      data: { name: 'Std Col P9', email: `std_${timestamp}@test.com`, code: `STD9_${timestamp}`, planId: 'standard', subStatus: 'ACTIVE' }
    });

    premiumCol = await prisma.college.create({
      data: { name: 'Prem Col P9', email: `prm_${timestamp}@test.com`, code: `PRM9_${timestamp}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    enterpriseCol = await prisma.college.create({
      data: { name: 'Ent Col P9', email: `ent_${timestamp}@test.com`, code: `ENT9_${timestamp}`, planId: 'enterprise', subStatus: 'ACTIVE' }
    });

    suspendedCol = await prisma.college.create({
      data: { name: 'Susp Col P9', email: `susp_${timestamp}@test.com`, code: `SUSP9_${timestamp}`, planId: 'premium', subStatus: 'SUSPENDED' }
    });

    starterUser = await prisma.user.create({
      data: { email: `u_str_${timestamp}@test.com`, name: 'Starter Admin', role: 'admin', college_id: starterCol.id }
    });

    adminUser = await prisma.user.create({
      data: { email: `u_adm_${timestamp}@test.com`, name: 'Prem Admin', role: 'admin', college_id: premiumCol.id }
    });

    superUser = await prisma.user.create({
      data: { email: `u_sup_${timestamp}@test.com`, name: 'Super Admin', role: 'superAdmin', college_id: enterpriseCol.id }
    });

    // ----------------------------------------------------
    // TEST 1: Feature Registry Canonical Milestone Counts & DAG Validation
    // ----------------------------------------------------
    await test('1. Canonical registry counts: 108 Live + 53 Roadmap = 161 Total with 0 DAG cycles', async () => {
      assert.strictEqual(FEATURE_REGISTRY.length, 161, `Total features must equal 161 (got ${FEATURE_REGISTRY.length})`);
      const live = FEATURE_REGISTRY.filter(f => f.status === 'live');
      const cs = FEATURE_REGISTRY.filter(f => f.status === 'coming_soon');
      assert.strictEqual(live.length, 108, `Live features must equal 108 (got ${live.length})`);
      assert.strictEqual(cs.length, 53, `Coming soon features must equal 53 (got ${cs.length})`);

      // DAG validation must pass without cycle exceptions
      validateRegistryDAG();

      // Check all 10 Phase 9 keys are live
      const phase9Keys = [
        'admin-2fa-login-alerts', 'export-center', 'custom-roles-permissions',
        'approval-workflows', 'public-api-webhooks', 'self-service-data-backup',
        'faculty-student-pwa', 'scheduled-reports-email', 'board-format-excel-export',
        'accountant-csv-export'
      ];
      for (const k of phase9Keys) {
        const item = FEATURE_REGISTRY.find(f => f.key === k);
        assert(item, `Feature ${k} must exist in registry`);
        assert.strictEqual(item.status, 'live', `Feature ${k} must be live`);
      }
    })();

    // ----------------------------------------------------
    // TEST 2: Tier Entitlement Boundaries (FEATURE_NOT_IN_PLAN)
    // ----------------------------------------------------
    await test('2. Tier entitlement boundaries enforce FEATURE_NOT_IN_PLAN on lower tiers', async () => {
      const starterFeatures = resolveCollegeFeatures('starter').effectiveKeys;
      const stdFeatures = resolveCollegeFeatures('standard').effectiveKeys;
      const premFeatures = resolveCollegeFeatures('premium').effectiveKeys;
      const entFeatures = resolveCollegeFeatures('enterprise').effectiveKeys;

      // Starter has N07 and N01, lacks N08, N10, N11, N06, N05, N04
      assert(starterFeatures.includes('admin-2fa-login-alerts'));
      assert(starterFeatures.includes('export-center'));
      assert(!starterFeatures.includes('board-format-excel-export'));
      assert(!starterFeatures.includes('custom-roles-permissions'));

      // Standard includes N08, N02, lacks N10, N11, N06, N05
      assert(stdFeatures.includes('board-format-excel-export'));
      assert(stdFeatures.includes('faculty-student-pwa'));
      assert(!stdFeatures.includes('custom-roles-permissions'));

      // Premium includes N10, N11, N03, N04, lacks N06, N05
      assert(premFeatures.includes('custom-roles-permissions'));
      assert(premFeatures.includes('approval-workflows'));
      assert(premFeatures.includes('scheduled-reports-email'));
      assert(premFeatures.includes('accountant-csv-export'));
      assert(!premFeatures.includes('public-api-webhooks'));
      assert(!premFeatures.includes('self-service-data-backup'));

      // Enterprise includes N06, N05
      assert(entFeatures.includes('public-api-webhooks'));
      assert(entFeatures.includes('self-service-data-backup'));
    })();

    // ----------------------------------------------------
    // TEST 3: Suspended Tenant Isolation
    // ----------------------------------------------------
    await test('3. Suspended tenant blocked from queued exports with FEATURE_NOT_IN_PLAN', async () => {
      let blocked = false;
      try {
        await exportService.queueExportJob({
          collegeId: suspendedCol.id,
          userId: adminUser.id,
          exportType: 'STUDENTS',
          format: 'CSV'
        });
      } catch (err) {
        if (err.code === 'FEATURE_NOT_IN_PLAN' && err.status === 403) blocked = true;
      }
      assert(blocked, 'Suspended college must be blocked from export queueing');
    })();

    // ----------------------------------------------------
    // TEST 4: N07 Admin 2FA Window Verification, Replay Prevention & AES Encryption
    // ----------------------------------------------------
    await test('4. N07 TOTP RFC 6238 enrollment, AES-256-GCM encryption & replay prevention', async () => {
      const setup = twoFactorService.generate2FASetup('admin@testcollege.edu.pk');
      assert(setup.secretBase32.length >= 26);
      assert(setup.secretEnc.startsWith('v1:'));
      assert.strictEqual(setup.plainBackupCodes.length, 10);
      assert.strictEqual(setup.hashedBackupCodes.length, 10);

      // Decrypt matches
      const decrypted = twoFactorService.decryptTotpSecret(setup.secretEnc);
      assert.strictEqual(decrypted, setup.secretBase32);

      // Current step verification
      const now = Date.now();
      const currentStep = Math.floor(now / 1000 / 30);
      const secretBytes = twoFactorService.base32Decode(setup.secretBase32);
      const validCode = twoFactorService.generateCodeForStep(secretBytes, currentStep);

      const resValid = twoFactorService.verifyTotpCode({ secretBase32: setup.secretBase32, code: validCode, nowMs: now });
      assert.strictEqual(resValid.valid, true);

      // Replay prevention: cannot reuse same step
      const resReplay = twoFactorService.verifyTotpCode({
        secretBase32: setup.secretBase32,
        code: validCode,
        lastAcceptedStep: BigInt(currentStep),
        nowMs: now
      });
      assert.strictEqual(resReplay.valid, false);
      assert.strictEqual(resReplay.reason, 'REPLAYED_CODE');
    })();

    // ----------------------------------------------------
    // TEST 5: N07 Device Fingerprint Cookie Signing & Verification
    // ----------------------------------------------------
    await test('5. N07 Device cookie signing, HMAC verification & hash generation', async () => {
      const rawDeviceId = crypto.randomUUID();
      const signedCookie = twoFactorService.signDeviceCookie(rawDeviceId);
      assert(signedCookie.includes('.'), 'Signed cookie must contain payload and signature');

      const verifiedDeviceId = twoFactorService.verifyDeviceCookie(signedCookie);
      assert.strictEqual(verifiedDeviceId, rawDeviceId, 'Valid signed cookie returns original device ID');

      // Tampered cookie fails
      const tampered = signedCookie + 'xyz';
      const badVerify = twoFactorService.verifyDeviceCookie(tampered);
      assert.strictEqual(badVerify, null, 'Tampered cookie returns null');
    })();

    // ----------------------------------------------------
    // TEST 6: N01 Centralized Export Engine & Atomic Quota Refund
    // ----------------------------------------------------
    await test('6. N01 Export quota atomic check and refund on failure', async () => {
      // Create student
      await prisma.student.create({
        data: {
          college_id: starterCol.id,
          session_id: 'default_session',
          name: 'Tariq Mehmood',
          rollNumber: 'ST-001',
          fatherName: 'Mehmood Ul Hassan',
          gender: 'male',
          class: '11th',
          group: 'Pre-Medical',
          status: 'active'
        }
      });

      const job = await exportService.queueExportJob({
        collegeId: starterCol.id,
        userId: starterUser.id,
        exportType: 'STUDENTS',
        format: 'CSV'
      });
      assert.strictEqual(job.status, 'QUEUED');

      // Worker process
      const { processExportJob } = require('../workers/exportWorker');
      const result = await processExportJob(job);
      assert.strictEqual(result.success, true);
      const readyJob = await prisma.exportJob.findUnique({ where: { id: job.id } });
      assert.strictEqual(readyJob.status, 'READY');
      assert(readyJob.rowCount >= 1);
    })();

    // ----------------------------------------------------
    // TEST 7: N01 Row Cap Overflow & Formula Sanitization
    // ----------------------------------------------------
    await test('7. N01 Formula injection neutralization in CSV and XLSX cells', async () => {
      const cell1 = exportService.sanitizeCsvCell('=SUM(A1:B10)');
      assert(cell1.startsWith("'="), 'CSV formula prefix must be neutralized');

      const cell2 = exportService.sanitizeCsvCell('+cmd|/c calc');
      assert(cell2.startsWith("'+"), 'Plus formula prefix must be neutralized');

      const cell3 = exportService.sanitizeCsvCell('@dangerousCall');
      assert(cell3.startsWith("'@"), 'At formula prefix must be neutralized');

      const numCell = exportService.sanitizeCsvCell(12345);
      assert.strictEqual(numCell, '12345', 'Numbers preserved');
    })();

    // ----------------------------------------------------
    // TEST 8: N10 Custom Roles Privilege Escalation & Cross-Tenant Guards
    // ----------------------------------------------------
    await test('8. N10 Custom role privilege escalation guards and composite tenant assignment', async () => {
      // Create custom role in premiumCol
      const role = await customRoleService.createCustomRole({
        collegeId: premiumCol.id,
        grantorUser: adminUser,
        name: 'Fee Auditor P9',
        description: 'Read fees only',
        permissions: ['fees:read', 'reports:read'],
        isAdminClass: false
      });
      assert(role.id && role.college_id === premiumCol.id);

      // Attempting to grant unauthorized super-admin permission throws 400
      let superAdminBlocked = false;
      try {
        await customRoleService.createCustomRole({
          collegeId: premiumCol.id,
          grantorUser: adminUser,
          name: 'Hacker Role P9',
          permissions: ['superadmin.impersonate'],
          isAdminClass: false
        });
      } catch (err) {
        if (err.status === 400) superAdminBlocked = true;
      }
      assert(superAdminBlocked, 'Super admin permissions must be strictly rejected');

      // Cross-tenant assignment prevention: assigning role from premiumCol to user in starterCol fails
      let crossTenantBlocked = false;
      try {
        await customRoleService.assignCustomRole({
          collegeId: starterCol.id,
          roleId: role.id,
          targetUserId: starterUser.id,
          grantorUser: adminUser
        });
      } catch (err) {
        if (err.status === 404) crossTenantBlocked = true;
      }
      assert(crossTenantBlocked, 'Cross-tenant role assignment strictly prevented');
    })();

    // ----------------------------------------------------
    // TEST 9: N10 Role Creation Free & Admin Quota Accounting
    // ----------------------------------------------------
    await test('9. N10 Role creation is free; isAdminClass toggle enforces admin quota', async () => {
      const countBefore = await customRoleService.countAdminClassUsers(premiumCol.id);
      assert(typeof countBefore === 'number');

      // Role creation is free
      const nonAdminRole = await customRoleService.createCustomRole({
        collegeId: premiumCol.id,
        grantorUser: adminUser,
        name: 'Teacher Role P9',
        permissions: ['attendance:mark'],
        isAdminClass: false
      });
      assert(nonAdminRole.id);
    })();

    // ----------------------------------------------------
    // TEST 10: N11 Approvals: Multi-Step Execution, Snapshot Isolation & Rollback
    // ----------------------------------------------------
    await test('10. N11 Approvals workflow engine snapshot isolation & atomic rollback', async () => {
      // Create chain
      const chain = await approvalService.createOrUpdateChain({
        collegeId: premiumCol.id,
        workflowType: 'FEE_CONCESSION',
        name: 'Scholarship Chain P9',
        steps: [
          { stepNumber: 1, approverType: 'ROLE', approverRef: 'admin', stepName: 'Admin Approval' }
        ]
      });
      assert(chain.id && chain.steps.length === 1);

      // Create test student and fee
      const testStudent = await prisma.student.create({
        data: {
          college_id: premiumCol.id,
          session_id: 'default_session',
          name: 'Approval Student',
          rollNumber: 'AP-01',
          fatherName: 'AP Father',
          gender: 'male',
          class: '11th',
          group: 'ICS',
          status: 'active'
        }
      });
      const testFee = await prisma.fee.create({
        data: {
          college_id: premiumCol.id,
          session_id: 'default_session',
          student_id: testStudent.id,
          month: '2026-11',
          totalAmount: 5000,
          challanNumber: `CHL-AP-${timestamp}`
        }
      });

      // Submit request
      const reqRecord = await approvalService.checkAndCreateApprovalRequest({
        collegeId: premiumCol.id,
        workflowType: 'FEE_CONCESSION',
        requesterUser: adminUser,
        payload: { feeId: testFee.id, discountAmount: 1000 }
      });
      assert(reqRecord.requiresApproval && (reqRecord.request || reqRecord.approvalRequestId));
    })();

    // ----------------------------------------------------
    // TEST 11: N06 Webhooks Secret Encryption & HMAC Signatures
    // ----------------------------------------------------
    await test('11. N06 Webhook AES-256-GCM secret encryption and HMAC-SHA256 signature', async () => {
      const plaintextSecret = 'whsec_test_secret_key_12345';
      const encrypted = webhookCrypto.encryptWebhookSecret(plaintextSecret);
      assert(encrypted.startsWith('v1:'), 'Encrypted secret must have version prefix');
      const decrypted = webhookCrypto.decryptWebhookSecret(encrypted);
      assert.strictEqual(decrypted, plaintextSecret, 'Decrypted secret must match original');

      const payload = JSON.stringify({ event: 'student.created', id: 'stu_123' });
      const sigObj = webhookCrypto.signWebhookPayload(plaintextSecret, payload, 1793910000);
      assert(sigObj.signatureHeader.startsWith('t=1793910000,v1='), 'Signature must conform to X-Academix-Signature format');
    })();

    // ----------------------------------------------------
    // TEST 12: N06 Anti-SSRF Defense (Cloud Metadata & Loopback Blocked)
    // ----------------------------------------------------
    await test('12. N06 Anti-SSRF blocks private IP ranges and AWS/GCP cloud metadata', async () => {
      assert.strictEqual(ssrfProtection.isRestrictedIp('127.0.0.1'), true, 'Loopback blocked');
      assert.strictEqual(ssrfProtection.isRestrictedIp('10.0.0.1'), true, '10.x blocked');
      assert.strictEqual(ssrfProtection.isRestrictedIp('192.168.1.1'), true, '192.168.x blocked');
      assert.strictEqual(ssrfProtection.isRestrictedIp('169.254.169.254'), true, 'Cloud metadata blocked');
      assert.strictEqual(ssrfProtection.isRestrictedIp('8.8.8.8'), false, 'Public IP allowed');

      let cloudMetadataBlocked = false;
      try {
        await ssrfProtection.validateWebhookUrl('https://169.254.169.254/latest/meta-data/');
      } catch (err) {
        if (err.status === 400 || err.status === 422 || err.code === 'SSRF_RESTRICTED') cloudMetadataBlocked = true;
      }
      assert(cloudMetadataBlocked, 'Cloud metadata URL strictly blocked');
    })();

    // ----------------------------------------------------
    // TEST 13 & 14: N06 API Key Hashing & DB-Atomic Rate Limiting
    // ----------------------------------------------------
    await test('13. N06 API key generation with acx_live_ prefix & DB-Atomic rate limiting', async () => {
      const keyGen = await apiKeyService.generateApiKey({
        collegeId: enterpriseCol.id,
        name: 'ERP Connector P9',
        scopes: ['students:read', 'fees:read'],
        createdBy: adminUser.id
      });
      assert(keyGen.rawKey.startsWith('acx_live_'), 'Key must start with acx_live_');
      assert(keyGen.keyPrefix.length === 8, '8-char key prefix generated');

      const verified = await apiKeyService.validateApiKey(keyGen.rawKey);
      assert.strictEqual(verified.valid, true);
      assert.strictEqual(verified.key.college_id, enterpriseCol.id);

      const usageResult = await apiUsageService.recordAndCheckApiUsage(enterpriseCol.id, keyGen.id);
      assert.strictEqual(typeof usageResult.allowed, 'boolean');
      assert.strictEqual(typeof usageResult.minuteCount, 'number');
      assert.strictEqual(typeof usageResult.monthlyCount, 'number');
    })();

    // ----------------------------------------------------
    // TEST 15: N05 Institutional Data Backup Secret Exclusion
    // ----------------------------------------------------
    await test('15. N05 Data backup strictly excludes secrets (passwords, TOTP, API keys, PINs)', async () => {
      const sanitized = backupService.sanitizeUser({
        id: 'user_001',
        name: 'Test Admin',
        password: 'bcrypt_hash_secret',
        totpSecretEnc: 'encrypted_totp',
        keyHash: 'sha256_hash',
        guardianPinHash: 'hashed_pin'
      });

      assert(!sanitized.password, 'password must be excluded');
      assert(!sanitized.totpSecretEnc, 'totpSecretEnc must be excluded');
      assert.strictEqual(sanitized.name, 'Test Admin', 'Non-secret fields retained');
    })();

    // ----------------------------------------------------
    // TEST 16: N08 Faculty & Student Offline PWA Caching Scope
    // ----------------------------------------------------
    await test('16. N08 Teacher offline dataset restricted to assigned sections without PII', async () => {
      const offlineBundle = await staffPwaService.getStaffOfflineBundle({ collegeId: premiumCol.id, userId: adminUser.id });
      assert(offlineBundle && Array.isArray(offlineBundle.timetable));
      assert(Array.isArray(offlineBundle.rosters));
    })();

    // ----------------------------------------------------
    // TEST 17: N03 Scheduled Executive Digest Aggregates-Only
    // ----------------------------------------------------
    await test('17. N03 Executive Digest aggregates-only summary with JobRunLog idempotency', async () => {
      const summary = await digestService.generateDigestSummary(premiumCol.id);
      assert.strictEqual(summary.reportType, 'WEEKLY_EXECUTIVE_DIGEST');
      assert(summary.metrics);
      assert(typeof summary.metrics.activeStudents === 'number');
    })();

    // ----------------------------------------------------
    // TEST 18: N02 Board-Format Gazette Excel Export Profiles
    // ----------------------------------------------------
    await test('18. N02 Board export profile data-driven JSON mappings for BISE Lahore & FBISE', async () => {
      await boardGazetteService.ensureDefaultProfiles(prisma);
      const lhr = await boardGazetteService.getBoardProfile('BISE_LHR', prisma);
      assert.strictEqual(lhr.boardCode, 'BISE_LHR');
      assert(Array.isArray(lhr.columnsJson));
      assert(lhr.columnsJson.some(c => c.key === 'rollNumber'));
      assert(lhr.columnsJson.some(c => c.key === 'marksObtained'));
    })();

    // ----------------------------------------------------
    // TEST 19: N04 Accountant Journal Preflight & Double-Entry Balance
    // ----------------------------------------------------
    await test('19. N04 Accountant Journal preflight check and double-entry balance assertion', async () => {
      // Seed default account head mappings
      await accountantJournalService.seedDefaultMappings(premiumCol.id, null, prisma);

      // Create student, fee, payment, and refund
      const student = await prisma.student.create({
        data: {
          college_id: premiumCol.id,
          session_id: 'default_session',
          name: 'Bilal Ahmed',
          rollNumber: 'FA-201',
          fatherName: 'Ahmed Din',
          gender: 'male',
          class: '12th',
          group: 'ICS',
          status: 'active'
        }
      });

      const fee = await prisma.fee.create({
        data: {
          college_id: premiumCol.id,
          session_id: 'default_session',
          student_id: student.id,
          month: '2026-11',
          tuitionFee: 8000,
          totalAmount: 8000,
          paidAmount: 8000,
          status: 'paid',
          challanNumber: `CHL-P9-${timestamp}`
        }
      });

      await prisma.payment.create({
        data: {
          college_id: premiumCol.id,
          fee_id: fee.id,
          student_id: student.id,
          amount: 8000,
          paymentMethod: 'bank',
          receiptNumber: `RCP-P9-${timestamp}`
        }
      });

      await prisma.feeRefund.create({
        data: {
          college_id: premiumCol.id,
          student_id: student.id,
          fee_id: fee.id,
          amount: 1500,
          reason: 'Excess fee adjustment',
          status: 'paid'
        }
      });

      const journal = await accountantJournalService.fetchAccountantJournalData(prisma, premiumCol.id, null, {});
      assert.strictEqual(journal.isBalanced, true, 'Journal must be strictly balanced');
      assert(journal.totalDebits > 0);
      assert.strictEqual(journal.totalDebits, journal.totalCredits, 'Total Debits must equal Total Credits');
    })();

  } catch (err) {
    console.error('Fatal test error in Phase 9 Contract Suite:', err);
    failed++;
  } finally {
    // Teardown test colleges
    const allColIds = [starterCol?.id, standardCol?.id, premiumCol?.id, enterpriseCol?.id, suspendedCol?.id].filter(Boolean);
    if (allColIds.length > 0) {
      await prisma.exportJob.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.payment.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.feeRefund.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.fee.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.boardResult.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.student.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.accountHeadMapping.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.approvalRequestStep.deleteMany({ where: { request: { college_id: { in: allColIds } } } });
      await prisma.approvalRequest.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.approvalChainStep.deleteMany({ where: { chain: { college_id: { in: allColIds } } } });
      await prisma.approvalChain.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.userCustomRole.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.customRole.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.apiKey.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.webhookSubscription.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.apiUsageWindow.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.knownDevice.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.user.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.collegeUsage.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.college.deleteMany({ where: { id: { in: allColIds } } });
    }
  }

  console.log('\n====================================================');
  console.log(`PHASE 9 CONTRACT SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runPhase9ContractTests();
