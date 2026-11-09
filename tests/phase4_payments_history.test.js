'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getPaymentsList, getPaymentDetail } = require('../modules/superAdminFinance/services/paymentsHistory.service');
const { exportPaymentsStream } = require('../modules/superAdminFinance/services/exportService');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

async function runTests() {
  console.log('='.repeat(70));
  console.log('RUNNING PHASE 4: PAYMENTS HISTORY & EXPORT CONTRACT TESTS');
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
    const prisma = getSystemClient();

    // 1. Paginated list with includeTest = true
    console.log('\n--- 1. Testing getPaymentsList (includeTest=true) ---');
    const listAll = await getPaymentsList({ includeTest: true, page: 1, limit: 10 });
    assert('Returns 10 payments for page 1', listAll.payments.length === 10);
    assert('Total pagination count is 200', listAll.pagination.total === 200);
    assert('Pagination totalPages is 20', listAll.pagination.totalPages === 20);
    assert('College relation is populated', Boolean(listAll.payments[0].college && listAll.payments[0].college.name));
    assert('Summary has all 200 payments accounted for',
      listAll.summary.totalCount === 200 &&
      listAll.summary.approvedCount === 131 &&
      listAll.summary.pendingCount === 55 &&
      listAll.summary.rejectedCount === 14
    );

    // 2. Test isolation (includeTest = false)
    console.log('\n--- 2. Testing getPaymentsList (includeTest=false) ---');
    const listNonTest = await getPaymentsList({ includeTest: false });
    console.log('Non-test payments count:', listNonTest.payments.length);
    assert('Excludes test college payments',
      listNonTest.payments.every(p => p.college && p.college.isTest === false)
    );
    assert('Total non-test payments matches expected (1 pending)',
      listNonTest.pagination.total === 1 && listNonTest.summary.pendingCount === 1
    );

    // 3. Filter by Status = APPROVED
    console.log('\n--- 3. Testing Status and Method Filters ---');
    const listApproved = await getPaymentsList({ includeTest: true, status: 'APPROVED', limit: 20 });
    assert('All returned records have status APPROVED',
      listApproved.payments.length === 20 &&
      listApproved.payments.every(p => p.status === 'APPROVED')
    );

    // 4. Search q on College Code
    const samplePayment = listAll.payments[0];
    const searchCode = samplePayment.college.code;
    const searchResult = await getPaymentsList({ includeTest: true, q: searchCode });
    assert(`Search q='${searchCode}' finds matching payments`,
      searchResult.payments.length > 0 &&
      searchResult.payments.some(p => p.college.code === searchCode)
    );

    // 5. Payment Detail
    console.log('\n--- 4. Testing getPaymentDetail ---');
    const detail = await getPaymentDetail(samplePayment.id);
    assert('getPaymentDetail returns full record with college info',
      detail && detail.id === samplePayment.id && detail.college && detail.college.code === searchCode
    );
    assert('getPaymentDetail includes suspectedDuplicates array',
      Array.isArray(detail.suspectedDuplicates)
    );

    // 6. CSV Export Stream
    console.log('\n--- 5. Testing exportPaymentsStream ---');
    let csvChunks = [];
    let headersCaptured = {};
    const mockRes = {
      setHeader: (k, v) => { headersCaptured[k] = v; },
      write: (chunk) => { csvChunks.push(chunk); },
      end: () => {}
    };

    await exportPaymentsStream({ includeTest: true }, mockRes, { email: 'superadmin@test.com' });
    const fullCsv = csvChunks.join('');

    assert('Export sets Content-Type text/csv; charset=utf-8',
      headersCaptured['Content-Type'] === 'text/csv; charset=utf-8'
    );
    assert('Export contains UTF-8 BOM',
      fullCsv.startsWith('\uFEFF')
    );
    assert('Export contains header columns',
      fullCsv.includes('Receipt Number') && fullCsv.includes('College Code') && fullCsv.includes('Amount Paid (PKR)')
    );
    const lineCount = fullCsv.trim().split('\r\n').length;
    console.log(`Exported CSV lines (header + rows): ${lineCount}`);
    assert('Export contains all 200 payment rows plus header (201 lines)',
      lineCount === 201
    );

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

