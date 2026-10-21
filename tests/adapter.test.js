const assert = require('assert');
const { resolveCollege, legacyEffectiveKeys, normalizePlan, normalizeGroup } = require('../services/collegeAdapter');

const base = (sub, settings = { programs: [{ name: 'Pre-Medical' }, { name: 'Computer Science' }] }) =>
  ({ id: 'c1', isActive: true, subscription: sub, settings });

// today's plan names
assert.strictEqual(normalizePlan('basic'), 'starter');
assert.strictEqual(normalizePlan('enterprise'), 'enterprise');
assert.strictEqual(normalizeGroup('Computer Science'), 'ics');
assert.strictEqual(normalizeGroup('I.Com'), 'i-com');

// 1. Standard college, nothing overridden. Reality mode: planned features are not sold.
let r = resolveCollege(base({ plan: 'standard', status: 'active' }));
assert.strictEqual(r.capabilities['student.identify'].method, 'qr');
assert.strictEqual(r.capabilities['attendance.mark'].method, 'qr');          // gate scan marks attendance today
assert.strictEqual(r.capabilities['parent.notify'].method, 'inapp');          // sms/whatsapp/portal are not built
assert.strictEqual(r.capabilities['doc.verify'].method, 'serial');            // certificate QR does not exist yet
assert.strictEqual(r.capabilities['fee.collect'].method, 'challan');          // gateway not built
assert(!r.features['board-registration'].on, 'planned features stay off');
assert(!r.features['attendance-biometric'].on, 'planned features stay off');
console.log('standard, today:', Object.fromEntries(Object.entries(r.capabilities).map(([k, v]) => [k, v.method])));

// 2. The user's case with today's data: entry-system switched off by the super admin
r = resolveCollege(base({ plan: 'standard', status: 'active', featureOverrides: { 'entry-system': false } }));
assert(!r.features['gate-scanner'].on && !r.features['attendance-qr'].on);
assert.strictEqual(r.capabilities['student.identify'].method, 'search');
assert.strictEqual(r.capabilities['attendance.mark'].method, 'manual');
assert(r.features.fines.on, 'fines keep working by search');
assert(!r.features['early-exit'].on, 'early exit is blocked until gate-manual-log is built');
assert.strictEqual(r.features['early-exit'].reason, 'REVOKED');
const legacy = legacyEffectiveKeys(r);
assert(!legacy.includes('entry-system') && legacy.includes('attendance') && legacy.includes('fees'));

// 3. same, after gate-manual-log exists (design mode)
r = resolveCollege(base({ plan: 'standard', status: 'active', featureOverrides: { 'gate-scanner': false } }), { includePlanned: true });
assert.strictEqual(r.capabilities['gate.log'].method, 'manual');
assert(r.features['early-exit'].on);

// 4. expiring grant
const past = new Date(Date.now() - 86400000).toISOString(), future = new Date(Date.now() + 86400000).toISOString();
r = resolveCollege(base({ plan: 'basic', featureOverrides: { 'ai-chat': { state: 'on', expiresAt: past } } }));
assert(!r.features['ai-chat'].on);
r = resolveCollege(base({ plan: 'basic', featureOverrides: { 'ai-chat': { state: 'on', expiresAt: future } } }));
assert(r.features['ai-chat'].on);

// 5. groups from onboarding
r = resolveCollege(base({ plan: 'standard' }, { programs: [{ name: 'I.Com' }, { name: 'FA' }] }), { includePlanned: true });
assert.strictEqual(r.features.practicals.reason, 'GROUP_NOT_OFFERED');
r = resolveCollege(base({ plan: 'standard' }, {}), { includePlanned: true });
assert(r.features.practicals.on, 'unknown groups hide nothing');

// 6. custom plan
r = resolveCollege(base({ plan: 'custom', customPlan: { keys: ['students', 'attendance', 'fees-basic', 'fines'] } }));
assert(r.features.fines.on && !r.features['bank-challans'].on);
assert.strictEqual(r.capabilities['fee.collect'].method, 'cash');
assert.strictEqual(r.capabilities['student.identify'].method, 'search');

// 7. suspended
assert.strictEqual(resolveCollege(base({ plan: 'standard', status: 'suspended' })).active, false);
// 8. grandfathering: a Starter college that has certificates and quizzes today keeps them
const { grandfatherOverrides } = require('../services/collegeAdapter');
const g = grandfatherOverrides(base({ plan: 'basic', status: 'active' }), ['core-academic','attendance','certificates','assignments-quizzes','announcements']);
assert.deepStrictEqual(Object.keys(g).sort(), ['assignments-quizzes','certificates']);
r = resolveCollege(base({ plan: 'basic', status: 'active', featureOverrides: g }));
assert(r.features.certificates.on && r.features.quizzes.on && r.features.assignments.on);
console.log('adapter checks passed');
