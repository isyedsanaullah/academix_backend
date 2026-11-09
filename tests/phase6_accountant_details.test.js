'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getAccountantsList } = require('../modules/superAdminFinance/services/accountants.service');
const { FORBIDDEN_USER_FIELDS } = require('../utils/safeUser');
const { closeAllClients } = require('../config/prismaManager');

async function runTests() {
  console.log('='.repeat(70));
  console.log('RUNNING PHASE 6: ACCOUNTANT DETAILS CONTRACT TESTS');
  console.log('='.repeat(70));

  let passed = 0;
  let failed = 0;

  function assert(desc, condition) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  try {
    // 1. Accountant List
    console.log('\n--- 1. Testing getAccountantsList ---');
    const result = await getAccountantsList({ page: 1, limit: 10 });
    console.log(`Retrieved ${result.accountants.length} accountants out of ${result.pagination.total}`);
    assert('Returns accountants array', Array.isArray(result.accountants));
    assert('Total accountants matches pagination total', result.pagination.total === result.metrics.totalAccountants);
    assert('Metrics contain college coverage details',
      typeof result.metrics.totalColleges === 'number' &&
      typeof result.metrics.collegesWithAccountant === 'number' &&
      typeof result.metrics.coveragePercentage === 'number'
    );

    // 2. Strict Credential & PII Sanitization Assertion
    console.log('\n--- 2. Testing Strict FINANCE_SAFE_USER_SELECT Projection ---');
    let hasLeak = false;
    let leakedField = null;

    for (const accountant of result.accountants) {
      for (const forbidden of FORBIDDEN_USER_FIELDS) {
        if (accountant[forbidden] !== undefined) {
          hasLeak = true;
          leakedField = forbidden;
          break;
        }
      }
      if (hasLeak) break;
      if (accountant.cnic !== undefined) {
        hasLeak = true;
        leakedField = 'cnic';
        break;
      }
    }

    assert('Zero credential or PII leaks in accountant response', !hasLeak);
    if (hasLeak) {
      console.error(`[FAIL DETAIL] Leaked forbidden field: ${leakedField}`);
    }

    // 3. College Attachment
    console.log('\n--- 3. Testing College Association ---');
    const assignedAccountant = result.accountants.find(a => a.college !== null);
    if (assignedAccountant) {
      console.log(`Sample assigned accountant: ${assignedAccountant.email} -> College: ${assignedAccountant.college.name} (${assignedAccountant.college.code})`);
      assert('Assigned accountant has populated college object with plan and price',
        assignedAccountant.college.name &&
        assignedAccountant.college.code &&
        assignedAccountant.college.planId &&
        typeof assignedAccountant.college.billingPrice === 'number'
      );
    }

    // 4. Search query q
    console.log('\n--- 4. Testing Search Query ---');
    const sample = result.accountants[0];
    if (sample) {
      const qResult = await getAccountantsList({ q: sample.email });
      assert(`Search query q='${sample.email}' finds accountant`,
        qResult.accountants.some(a => a.email === sample.email)
      );
    }

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await closeAllClients();
  }

  console.log('\n' + '='.repeat(70));
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(70));

  if (failed > 0) process.exit(1);
}

runTests();

