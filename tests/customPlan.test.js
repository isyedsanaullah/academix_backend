const assert = require('assert');
const { FEATURES, PLAN_ORDER } = require('../services/capabilityCatalog');
const { preview, price, closeSelection } = require('../services/customPlan');
const { resolve, impact } = require('../services/entitlements.v2');
const { CAPABILITIES } = require('../services/capabilityCatalog');
const college = { id: 'c1', isActive: true, groups: ['pre-medical', 'ics', 'i-com'] };

// A: small college, no QR/biometric/gate scanner/ID cards. Fines and early exit wanted.
let sel = ['core-academic','students','attendance','fees-basic','fines','early-exit','exams-results','groups-subjects'];
let p = preview({ keys: sel, college });
assert(p.addedAutomatically.includes('gate-manual-log'), 'closure adds manual gate log for early-exit');
assert.strictEqual(p.methods['student.identify'].method, 'search');
assert.strictEqual(p.methods['gate.log'].method, 'manual');
assert(p.on.includes('fines') && p.on.includes('early-exit'));
console.log('A added:', p.addedAutomatically.join(', '));
console.log('A price:', price({ keys: closeSelection(sel).keys, students: 450 }));

// B: everything in Standard -> capped at Standard price
const std = FEATURES.filter(f => !f.addon && PLAN_ORDER.indexOf(f.plan) <= 1).map(f => f.key);
const pb = price({ keys: new Set(std), students: 1000 });
assert.strictEqual(pb.final, 19999); console.log('B price:', pb.final, pb.note);

// C: Standard + SMS add-on + 300 extra students on top of 1000
const pc = price({ keys: new Set([...std, 'sms-alerts']), students: 1300 });
assert.strictEqual(pc.final, 19999 + 300*18); console.log('C price:', pc.final);

// D: tiny selection never below Starter floor
assert.strictEqual(price({ keys: new Set(['core-academic','students']), students: 100 }).final, 7999);

// E: no science group -> practicals hidden even though selected
const pe = preview({ keys: ['practicals'], college: { id: 'c3', isActive: true, groups: ['i-com'] } });
assert(!pe.on.includes('practicals'));

// F: fees-basic removal from Standard plan, as documented
const base = { college, ent: { status: 'ACTIVE', planId: 'standard' }, planKeys: new Set(std), catalog: FEATURES, capabilities: CAPABILITIES };
const x = impact(base, { remove: ['fees-basic'] });
const off = x.turnedOff.map(o => o.key);
['fines','bank-challans','defaulters-dues','treasury-ledger','fee-college-types','fee-discounts','fee-refunds','fee-board-alert','group-fee-seats','fees-online-payments'].forEach(k => assert(off.includes(k), k));
assert(x.after.features['board-registration'].on);
// G: exams-results removal
const y = impact(base, { remove: ['exams-results'] }).turnedOff.map(o => o.key);
['internal-tests','send-up-exams','eligibility-lists','practicals','lab-journals','board-practicals','ptm'].forEach(k => assert(y.includes(k), k));
console.log('custom plan checks passed');
