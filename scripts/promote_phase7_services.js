const fs = require('fs');
const path = require('path');

const regPath = path.join(__dirname, '../config/featureRegistry.js');
let code = fs.readFileSync(regPath, 'utf8');

const targets = ['#25', '#26', '#78', '#98'];
for (const id of targets) {
  const regex = new RegExp(`(id:\\s*'${id}',[\\s\\S]*?status:\\s*)'coming_soon'`);
  if (regex.test(code)) {
    code = code.replace(regex, `$1'live'`);
    console.log(`Promoted ${id} to 'live'`);
  } else {
    console.log(`Could not find coming_soon for ${id} or already live`);
  }
}

fs.writeFileSync(regPath, code, 'utf8');

const { FEATURE_REGISTRY } = require('../config/featureRegistry');
const live = FEATURE_REGISTRY.filter(x => x.status === 'live').length;
const coming = FEATURE_REGISTRY.filter(x => x.status === 'coming_soon').length;
console.log(`Registry summary: TOTAL: ${FEATURE_REGISTRY.length}, LIVE: ${live}, ROADMAP: ${coming}`);

