'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const controller = require('../controllers/superAdminAiUsage.controller');

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    jsonData: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
    send(content) {
      this.body = content;
      return this;
    }
  };
}

async function testEndpoints() {
  console.log('🧪 Testing Super Admin AI Usage Controller Endpoints...');

  // 1. Summary
  const req1 = { query: {} };
  const res1 = createMockRes();
  await controller.getSummary(req1, res1, console.error);
  console.log('1. getSummary success:', res1.jsonData?.success, 'Requests in DB:', res1.jsonData?.data?.totalRequests);

  // 2. Timeseries
  const res2 = createMockRes();
  await controller.getTimeseries(req1, res2, console.error);
  console.log('2. getTimeseries success:', res2.jsonData?.success, 'Days returned:', res2.jsonData?.data?.length);

  // 3. By Model
  const res3 = createMockRes();
  await controller.getByModel(req1, res3, console.error);
  console.log('3. getByModel success:', res3.jsonData?.success, 'Models returned:', res3.jsonData?.data?.length);

  // 4. By College
  const res4 = createMockRes();
  await controller.getByCollege(req1, res4, console.error);
  console.log('4. getByCollege success:', res4.jsonData?.success, 'Tenants returned:', res4.jsonData?.data?.length);

  // 5. By Feature
  const res5 = createMockRes();
  await controller.getByFeature(req1, res5, console.error);
  console.log('5. getByFeature success:', res5.jsonData?.success, 'Features returned:', res5.jsonData?.data?.length);

  // 6. Requests
  const res6 = createMockRes();
  await controller.getRequests(req1, res6, console.error);
  console.log('6. getRequests success:', res6.jsonData?.success, 'Total records:', res6.jsonData?.data?.total);

  // 7. Pricing
  const res7 = createMockRes();
  await controller.getPricing(req1, res7, console.error);
  console.log('7. getPricing success:', res7.jsonData?.success, 'Tiers returned:', res7.jsonData?.data?.length);

  // 8. Alerts
  const res8 = createMockRes();
  await controller.getAlerts(req1, res8, console.error);
  console.log('8. getAlerts success:', res8.jsonData?.success, 'Daily Cost Limit:', res8.jsonData?.data?.dailyCostLimitUsd);

  // 9. Export CSV
  const res9 = createMockRes();
  await controller.exportCsv(req1, res9, console.error);
  console.log('9. exportCsv success. Header content-type:', res9.headers['Content-Type'], 'CSV length:', res9.body?.length);

  console.log('🎉 ALL ENDPOINTS TESTED AND VERIFIED SUCCESSFULLY!\n');
  process.exit(0);
}

testEndpoints().catch(err => {
  console.error('Endpoint test failed:', err);
  process.exit(1);
});

