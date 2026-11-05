const fs = require('fs');

const artifactPath = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_plan_and_services_split_implementation_plan.md';
let content = fs.readFileSync(artifactPath, 'utf8');

const p7Start = content.indexOf('### Phase 7 [COMPLETED]');
const p8Start = content.indexOf('### Phase 8: College Operational');

if (p7Start !== -1 && p8Start !== -1) {
  let p7Section = content.substring(p7Start, p8Start);
  p7Section = p7Section.replace(/- \[ \] /g, '- [x] ');
  content = content.substring(0, p7Start) + p7Section + content.substring(p8Start);
  fs.writeFileSync(artifactPath, content, 'utf8');
  console.log('Successfully checked all Phase 7 checkboxes!');
} else {
  console.error('Could not locate markers for Phase 7 or Phase 8');
}
