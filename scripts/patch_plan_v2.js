const fs=require('fs');
const F='C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_implementation_plan_v2.md';
let L=fs.readFileSync(F,'utf8').split('\n');
const fix=(i,fn)=>{L[i-1]=fn(L[i-1]);};
fix(8,s=>s.replace('162 services','161 services'));
fix(196,s=>s.replace('162 services','161 services'));
fix(581,s=>s.replace('162-Service','161-Service'));
fix(819,s=>s.replace('90 Live + 72 Roadmap = 162 Total','90 Live + 71 Roadmap = 161 Total').replace('86 Live + 76 Roadmap = 162 Total','86 Live + 76 Roadmap = 162 Total (pre-N13 removal)'));
L[12]='- ✅ **Phase 6 [COMPLETED]:** Settlement Engine, Plan Versioning, Governance Deck. 16/16 contract tests passing.';
L[13]='';L[14]='';L[15]='';
// find phase 7 line and following sub-bullets
const i7=L.findIndex(x=>x.includes('Phase 7 [QUEUED'));
if(i7>=0){L[i7]='- ✅ **Phase 7 [COMPLETED]:** #26 File Vault, #25 Circulars, #78 Timetable, #98 Canteen POS. 19/19 contract tests passing. 90 Live + 71 Roadmap = 161.';}
fs.writeFileSync(F,L.join('\n'),'utf8');
console.log(L.slice(5,26).map(x=>x.slice(0,110)).join('\n'));

