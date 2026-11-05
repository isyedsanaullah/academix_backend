const { FEATURE_REGISTRY, validateRegistryDAG } = require('../config/featureRegistry');

console.log('--- Verifying Feature Registry Status & Counts ---');

const total = FEATURE_REGISTRY.length;
const live = FEATURE_REGISTRY.filter(f => f.status === 'live').length;
const comingSoon = FEATURE_REGISTRY.filter(f => f.status === 'coming_soon').length;

console.log(`Total Services: ${total}`);
console.log(`Live Services: ${live}`);
console.log(`Coming Soon Services: ${comingSoon}`);

console.log('\nValidating Topological DAG...');
const dagResult = validateRegistryDAG();
console.log(`DAG Valid: ${dagResult.valid}`);
console.log('Tier breakdown:', dagResult.byTier);
console.log('Status breakdown:', dagResult.byStatus);

if (total === 161 && live === 98 && comingSoon === 63 && dagResult.valid) {
  console.log('\n====================================================');
  console.log('FEATURE REGISTRY VERIFICATION 100% SUCCESSFUL!');
  console.log('====================================================');
  process.exit(0);
} else {
  console.error('\nCOUNT MISMATCH OR DAG INVALID!');
  process.exit(1);
}
