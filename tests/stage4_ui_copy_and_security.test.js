'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function readClient(rel) {
  return fs.readFileSync(path.join(ROOT, 'client-next', rel), 'utf8');
}

function testT41AndT43PublicAndLegalCopy() {
  const join = readClient('app/join/page.js');
  assert(join.includes('monthly: 2999') && join.includes('monthly: 5999') && join.includes('monthly: 14999'));
  assert(join.includes('yearly: 32989') && join.includes('yearly: 65989') && join.includes('yearly: 164989'));
  assert(!join.includes("id: 'enterprise'"), '/join must NOT include an Enterprise plan card');
  assert(!join.includes('17,999'), '/join must NOT advertise legacy PKR 17,999');
  assert(join.includes('liveCount: 26') && join.includes('totalCount: 33'));
  assert(join.includes('liveCount: 70') && join.includes('totalCount: 88'));
  assert(join.includes('liveCount: 86') && join.includes('totalCount: 153'));
  assert(join.includes('3,000 students or 4 or more campuses'), 'Custom Quote CTA must specify >3,000 students or 4 or more campuses');
  assert(join.includes('Recycle bin only'), 'Starter/Standard restore policy must state Recycle bin only');
  assert(join.includes('Coming soon'), 'Join page must show Coming soon labels');

  const services = readClient('app/services/_client.js');
  assert(services.includes("id: 'addonOnly'") && services.includes("label: 'Add-ons'"), '/services must include Add-ons filter tab');
  assert(!services.includes("id: 'enterprise'"), '/services must NOT have Enterprise filter button');
  assert(services.includes('Coming soon'), '/services must render Coming soon badge');

  const reqSub = readClient('app/request-subscription/_client.js');
  assert(reqSub.includes('14999') && reqSub.includes('164989'));
  assert(reqSub.includes('custom_quote'), '/request-subscription must support Custom Quote option');
  assert(!reqSub.includes("planId: 'enterprise'"), '/request-subscription must NOT render Enterprise fallback card');

  const terms = readClient('app/terms/page.js');
  assert(terms.includes('14,999') && terms.includes('164,989'));
  assert(!terms.includes('17,999'), 'Terms must not contain retired PKR 17,999 or misleading notice text');
  assert(terms.includes('Recycle bin only'));
  assert(terms.includes('Proposed by the plan, not in the source file'));

  const privacy = readClient('app/privacy-policy/page.js');
  assert(privacy.includes('30 days on Starter, 90 days on Standard, and 365 days on Premium'));
  assert(privacy.includes('30 days (Proposed by the plan, not in the source file)'));
  assert(!privacy.includes('part of the Enterprise plan'), 'Privacy policy must reflect Standard + Premium AI tiers');
}

function testT42AdminAndSuperAdminUI() {
  const adminSub = readClient('app/admin/subscription/_client.js');
  assert(adminSub.includes('14999') && adminSub.includes('164989'));
  assert(!adminSub.includes('enterprise: { monthly: 17999'), 'Admin subscription must remove Enterprise upgrade pricing');
  assert(adminSub.includes('isPurchasable !== false'), 'Admin subscription must lock non-purchasable add-ons');
  assert(adminSub.includes('Approaching Plan Quota Limit'), 'Admin subscription must render >=80% utilization banner');
  assert(adminSub.includes('grandfatheredUntil'), 'Admin subscription must display grandfathering notice when active');

  const saInvite = readClient('components/superAdmin/colleges/InviteCollegeDrawer.jsx');
  assert(!saInvite.includes('planId'), 'SuperAdmin invite drawer must not pre-select any plan');
  assert(!saInvite.includes("{ id: 'enterprise'"), 'SuperAdmin invite drawer must not include enterprise plan');
}

async function run() {
  testT41AndT43PublicAndLegalCopy();
  console.log('✓ T4.1 + T4.3 Public pricing (/join, /services, /request-subscription) & legal copy checks passed');
  testT42AdminAndSuperAdminUI();
  console.log('✓ T4.2 Admin billing meters, Coming soon locks, & SuperAdmin 3-plan UI checks passed');
}

run().catch(err => {
  console.error('Stage 4 UI/copy checks FAILED:', err);
  process.exit(1);
});

