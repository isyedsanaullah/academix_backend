const fs = require('fs');
const F = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_implementation_plan_v3.md';
let t = fs.readFileSync(F, 'utf8');
console.log('check marks:', (t.match(/\u2705/g) || []).length, ' literal ?-before-Phase:', (t.match(/"\? Phase/g) || []).length);
const before = t;
t = t.replace('**\tokenEpoch per-request', '**`tokenEpoch` per-request');
for (const n of [1, 2, 3, 4, 5]) t = t.replace(new RegExp('\\["\\? Phase ' + n + ':'), '["\u2705 Phase ' + n + ':');
t = t.replace(/subgraph P6\["\? Phase 6:/, 'subgraph P6["\u2705 Phase 6:').replace(/subgraph P7\["\? Phase 7:/, 'subgraph P7["\u2705 Phase 7:');
t = t.replace(/P8\["\? Phase 8:[^"]*"\]/, 'P8["\u23f3 Phase 8: Operational Services (#29, #28, #27, #80, #79, messaging layer, #83, #81, #86, #87; #82 adapter only)"]');
t = t.replace(/P9\["\? Phase 9:[^"]*"\]/, 'P9["\u23f3 Phase 9: Security, Governance & Export Center (N07, N01, N10, N11, N06, N05, N08, N03, N02, N04)"]');
t = t.replace(/P10\["\? Phase 10:[^"]*"\]/, 'P10["\u23f3 Phase 10: Audit, Retention & Multi-Campus (N15, N17, N16, N20, N18, N19; N13 removed)"]');
t = t.replace(/P11\["\? Phase 11:/, 'P11["\u23f3 Phase 11:').replace(/P12\["\? Phase 12:/, 'P12["\u23f3 Phase 12:').replace(/P13\["\? Phase 13/, 'P13["\u23f3 Phase 13');
fs.writeFileSync(F, t, 'utf8');
const rest = t.split('\n').map((l, i) => [i + 1, l]).filter(([i, l]) => /"\? |\t/.test(l));
console.log('remaining "? " or tab lines:', rest.map(([i, l]) => i + ': ' + l.slice(0, 80)).join('\n') || 'none');
console.log('changed:', before !== t);

