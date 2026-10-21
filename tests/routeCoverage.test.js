const assert = require('assert');
const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '..', 'routes');
const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.routes.js'));

console.log(`Checking route coverage across ${routeFiles.length} route files...`);

assert.strictEqual(routeFiles.length, 58, `Expected exactly 58 route files, but found ${routeFiles.length}`);

const failures = [];
let gatedCount = 0;
let exemptCount = 0;

for (const file of routeFiles) {
  const filePath = path.join(routesDir, file);
  try {
    const router = require(filePath);
    if (!router || !router.meta || typeof router.meta !== 'object') {
      failures.push({ file, error: 'Missing router.meta object' });
      continue;
    }

    const { feature, exempt, reason } = router.meta;

    if (feature !== undefined) {
      if (typeof feature === 'string' && feature.trim().length > 0) {
        gatedCount++;
      } else if (Array.isArray(feature) && feature.length > 0 && feature.every(f => typeof f === 'string' && f.trim().length > 0)) {
        gatedCount++;
      } else {
        failures.push({ file, error: `Invalid feature field: ${JSON.stringify(feature)}` });
      }
    } else if (exempt !== undefined) {
      if (typeof exempt === 'string' && exempt.trim().length > 0 && typeof reason === 'string' && reason.trim().length > 0) {
        exemptCount++;
      } else {
        failures.push({ file, error: `Invalid exempt field or missing reason: exempt=${exempt}, reason=${reason}` });
      }
    } else {
      failures.push({ file, error: 'router.meta has neither feature nor exempt' });
    }
  } catch (err) {
    failures.push({ file, error: `Failed to require route file: ${err.message}` });
  }
}

if (failures.length > 0) {
  console.error('Route coverage failures:', failures);
  assert.fail(`Route coverage check failed for ${failures.length} files`);
}

console.log(`Coverage check passed!`);
console.log(`- Total routes: ${routeFiles.length}`);
console.log(`- Feature-gated routes: ${gatedCount}`);
console.log(`- Exempt routes: ${exemptCount}`);
console.log(`All ${routeFiles.length} route files have valid meta coverage!`);
process.exit(0);
