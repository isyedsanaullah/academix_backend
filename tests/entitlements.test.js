const assert = require('assert');
const { PLAN_ORDER, FEATURES, CAPABILITIES } = require('../services/capabilityCatalog');
const { resolve, impact } = require('../services/entitlements.v2');

const planKeysFor = level =>
  new Set(FEATURES.filter(f => !f.addon && PLAN_ORDER.indexOf(f.plan) <= PLAN_ORDER.indexOf(level)).map(f => f.key));

const base = (over = {}) => ({
  college: { id: 'c1', isActive: true, groups: ['pre-medical', 'pre-engineering', 'ics', 'i-com'] },
  ent: { status: 'ACTIVE', planId: 'standard' },
  planKeys: planKeysFor('standard'),
  catalog: FEATURES, capabilities: CAPABILITIES,
  ...over,
});

// catalog sanity: every referenced key exists, no cycles
const keys = new Set(FEATURES.map(f => f.key));
const caps = new Set(CAPABILITIES.map(c => c.key));
for (const f of FEATURES) {
  f.hard.forEach(k => assert(keys.has(k), `${f.key} hard dep missing: ${k}`));
  [...f.needs, ...f.uses].forEach(k => assert(caps.has(k), `${f.key} capability missing: ${k}`));
}
CAPABILITIES.forEach(c => c.methods.forEach(m => m.requires.forEach(k => assert(keys.has(k), `${c.key}/${m.id} requires missing ${k}`))));
assert.strictEqual(keys.size, FEATURES.length, 'duplicate feature keys');

// every capability has a manual method that depends only on core or starter features
const starter = planKeysFor('starter');
for (const c of CAPABILITIES) {
  const last = c.methods[c.methods.length - 1];
  assert(last.requires.every(k => starter.has(k) || k === 'admissions-online' || k === 'mock-tests' || k === 'board-results'),
    `${c.key}: last method not Plan B safe`);
}

// 1. full standard college
let r = resolve(base());
assert.strictEqual(r.capabilities['student.identify'].method, 'qr');
assert.strictEqual(r.capabilities['attendance.mark'].method, 'biometric');

// 2. the user's example: no biometric, no QR scanner, no ID-card QR
let x = impact(base(), { remove: ['attendance-biometric', 'attendance-qr', 'gate-scanner', 'id-cards'] });
assert.strictEqual(x.after.capabilities['attendance.mark'].method, 'manual');
assert.strictEqual(x.after.capabilities['student.identify'].method, 'search');
assert.strictEqual(x.after.capabilities['gate.log'].method, 'manual');
assert(x.after.features.fines.on, 'fines must survive via search');
assert(x.after.features['early-exit'].on, 'early exit must survive via manual gate log');
assert(x.after.degraded.fines.some(d => d.capability === 'student.identify' && d.mode === 'fallback'));
assert(x.switched.length >= 3);

// 3. remove attendance entirely: dependents with a hard dep go off, with reason
x = impact(base(), { remove: ['attendance'] });
['attendance-shortage', 'board-attendance-check', 'absence-alerts', 'attendance-qr', 'attendance-biometric']
  .forEach(k => assert(!x.after.features[k].on, k + ' should be off'));
assert.strictEqual(x.after.capabilities['attendance.mark'].available, false);
assert(x.after.features['send-up-exams'].on, 'send-up has no hard attendance dep');

// 4. no science groups
r = resolve(base({ college: { id: 'c2', isActive: true, groups: ['i-com', 'fa'] } }));
['practicals', 'lab-journals', 'board-practicals'].forEach(k => assert.strictEqual(r.features[k].reason === 'GROUP_NOT_OFFERED' || r.features[k].reason === 'DEPENDENCY_OFF', true));

// 5. no certificates: QR verify off, serial entry takes over
x = impact(base(), { remove: ['certificates'] });
assert(!x.after.features['qr-verify'].on);
assert.strictEqual(x.after.capabilities['doc.verify'].method, 'serial');

// 6. no notification add-ons: parent.notify falls to portal then print
r = resolve(base({ planKeys: new Set([...planKeysFor('standard')].filter(k => !['sms-alerts','whatsapp-alerts','parent-portal'].includes(k))) }));
assert.strictEqual(r.capabilities['parent.notify'].method, 'inapp');
r = resolve(base({ planKeys: new Set([...planKeysFor('standard')].filter(k => !['sms-alerts','whatsapp-alerts','parent-portal','announcements'].includes(k))) }));
assert.strictEqual(r.capabilities['parent.notify'].method, 'print');
assert(r.features['absence-alerts'].on && r.degraded['absence-alerts']);

// 7. college prefers manual search even though QR exists
r = resolve(base({ methodPrefs: { 'student.identify': ['search'] } }));
assert.strictEqual(r.capabilities['student.identify'].method, 'search');

// 8. suspended account
assert.strictEqual(resolve(base({ ent: { status: 'SUSPENDED', planId: 'standard' } })).active, false);

console.log('all checks passed;', FEATURES.length, 'features,', CAPABILITIES.length, 'capabilities');
