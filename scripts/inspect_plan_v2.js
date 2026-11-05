const fs=require('fs');
const F='C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_implementation_plan_v2.md';
const t=fs.readFileSync(F,'utf8');
const L=t.split('\n');
const p8=L.findIndex(x=>x.startsWith('### Phase 8'));
console.log('phase8 idx',p8+1);
const bad=[];
L.slice(0,p8).forEach((l,i)=>{
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\t]/.test(l)||l.includes('\ufffd')) bad.push(i+1);
});
console.log('lines with ctrl/tab/replacement chars:',bad.length);
console.log(bad.join(','));
let q=0; L.slice(0,p8).forEach(l=>{ if(/ \? /.test(l)) q++;});
console.log('lines with " ? ":',q);
const heads=L.map((l,i)=>[i+1,l]).filter(([i,l])=>/^#{3,5} (6[ABC]|7[ABCD])/.test(l)).map(([i,l])=>i+': '+l.slice(0,70));
console.log(heads.join('\n'));

