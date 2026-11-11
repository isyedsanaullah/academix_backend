'use strict';

const assert = require('assert');
process.env.INTERNAL_SERVICE_SECRET = 'test-secret-at-least-32-characters-long!!';
process.env.AI_SERVICE_URL = 'http://127.0.0.1:10001';

const client = require('../services/aiMicroserviceClient');

console.log('Testing aiMicroserviceClient.js...');

// 1. URL parsing check
assert.strictEqual(client.AI_SERVICE_URL, 'http://127.0.0.1:10001');

// 2. Health check handles unreachable endpoint without throwing
client.checkHealth().then((health) => {
  assert.strictEqual(typeof health.ok, 'boolean');
  console.log('Health check test passed.');
});

// 3. deliverOutboxEvent parameter validation
assert.rejects(async () => {
  await client.deliverOutboxEvent({ eventType: 'TEST' });
}, /eventId and eventType are required/);

console.log('✅ aiMicroserviceClient unit tests passed successfully.');
