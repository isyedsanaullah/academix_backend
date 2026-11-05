const fs = require('fs');
const F = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_implementation_plan_v3.md';
let t = fs.readFileSync(F, 'utf8');
t = t.replace(/\? Not available/g, 'Not available').replace(/\? \*\*Included Free\*\*/g, '\u2705 **Included Free**');
fs.writeFileSync(F, t, 'utf8');
const L = t.split('\n');
const end = L.findIndex(x => x.startsWith('### Phase 8'));
const hits = [];
L.slice(0, end).forEach((l, i) => { if (/\?(?!\w)/.test(l.replace(/`[^`]*`/g, ''))) hits.push((i + 1) + ': ' + l.slice(0, 110)); });
console.log('lines with ? in sealed region:', hits.length);
console.log(hits.slice(0, 40).join('\n'));
console.log('total lines', L.length);

