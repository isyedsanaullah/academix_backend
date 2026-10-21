// services/customPlan.js
// Custom plan builder helpers: dependency closure, live impact preview and a price proposal.
// Prices are a PROPOSAL (see doc section 8); confirm against the cost model before publishing.
const { FEATURES, CAPABILITIES, PLAN_ORDER } = require('./capabilityCatalog');
const { resolve } = require('./entitlements.v2');

const byKey = new Map(FEATURES.map(f => [f.key, f]));

const PRICING = {
  floorPkr: 7999,                       // never below Starter
  baseFeePkr: 5999,                     // platform, core features, 300 students, 5 GB
  includedStudents: 300,
  extraStudentPkr: 18,
  extraStoragePer10GbPkr: 150,
  includedStorageGb: 5,
  // charged once per service when any non-Starter feature of that service is selected
  packPkr: {
    'srv-erp': 4000, 'srv-security': 3500, 'srv-board': 5000, 'srv-exams': 2500, 'srv-practicals': 2500,
    'srv-admissions': 3500, 'srv-comms': 3000, 'srv-lms': 1500, 'srv-intelligence': 2500,
    'srv-entrytest': 6000, 'srv-guidance': 1500, 'srv-academic': 2000, 'srv-college': 0,
    'srv-ai': 25000, 'srv-governance': 0,
  },
  planStudents: { starter: 300, standard: 1000, premium: 2500, enterprise: 5000 },
  planPricePkr: { starter: 7999, standard: 19999, premium: 44999, enterprise: 119999 },
};

// Selecting a feature also selects everything it hard-depends on (and its capability base methods).
function closeSelection(keys) {
  const out = new Set(keys);
  const added = [];
  const add = k => { if (!out.has(k) && byKey.has(k)) { out.add(k); added.push(k); visit(k); } };
  const visit = k => byKey.get(k).hard.forEach(add);
  [...out].forEach(visit);
  // make sure each capability the selection touches has its manual base available
  for (const c of CAPABILITIES) {
    const touched = FEATURES.some(f => out.has(f.key) && [...f.needs, ...f.uses].includes(c.key));
    if (touched) c.methods[c.methods.length - 1].requires.forEach(add);
  }
  return { keys: out, added };
}

function groupKeysFor(groups) { return groups; }

function preview({ keys, college, ent = { status: 'ACTIVE', planId: 'custom' }, methodPrefs = {} }) {
  const { keys: closed, added } = closeSelection(keys);
  const r = resolve({ college, ent, planKeys: closed, catalog: FEATURES, capabilities: CAPABILITIES, methodPrefs });
  return {
    addedAutomatically: added,
    on: r.keys,
    off: Object.entries(r.features).filter(([, s]) => !s.on && s.reason !== 'NOT_IN_PLAN').map(([k, s]) => ({ key: k, reason: s.reason, blockedBy: s.blockedBy || null })),
    methods: Object.fromEntries(Object.entries(r.capabilities).map(([k, c]) => [k, { method: c.method, fallbackUsed: c.fallbackUsed, available: c.methods }])),
    degraded: r.degraded,
  };
}

function coveringPlan(keys) {
  // add-ons are priced separately, so they never decide which plan covers the selection
  const need = [...keys].filter(k => { const f = byKey.get(k); return f && !f.core && !f.addon; });
  return PLAN_ORDER.find(p => need.every(k => PLAN_ORDER.indexOf(byKey.get(k).plan) <= PLAN_ORDER.indexOf(p))) || null;
}

// add-on charges: entry-test pack once if any entry-test feature is selected; SMS/WhatsApp are prepaid credits (no monthly fee)
const ADDON_PKR = { 'srv-entrytest': 6000 };

async function getPricingConfig(db) {
  if (!db) return PRICING;
  try {
    const row = await db.subscription.findFirst({
      where: { planId: 'custom-pricing' }
    });
    if (row && row.limits && typeof row.limits === 'object') {
      return { ...PRICING, ...row.limits };
    }
  } catch (_) {}
  return PRICING;
}

async function updateCustomPricing(db, newPricing) {
  if (!db) return PRICING;
  const merged = { ...PRICING, ...newPricing };
  await db.subscription.upsert({
    where: { planId: 'custom-pricing' },
    update: { limits: merged, updatedAt: new Date() },
    create: {
      planId: 'custom-pricing',
      name: 'Custom Plan Pricing Blueprint',
      price: 0,
      limits: merged
    }
  });
  return merged;
}

function price({ keys, students = 300, storageGb = 5, pricing = PRICING }) {
  const pConfig = pricing || PRICING;
  const sel = [...keys].map(k => byKey.get(k)).filter(Boolean);
  const main = sel.filter(f => !f.addon);
  const addonSvcs = new Set(sel.filter(f => f.addon).map(f => f.svc));
  const addons = [...addonSvcs].reduce((t, id) => t + (ADDON_PKR[id] || 0), 0);

  const services = new Set(main.filter(f => !f.core && f.plan !== 'starter').map(f => f.svc));
  const packs = [...services].reduce((t, id) => t + (pConfig.packPkr?.[id] || 0), 0);
  const extraStudents = Math.max(0, students - pConfig.includedStudents) * pConfig.extraStudentPkr;
  const extraStorage = Math.ceil(Math.max(0, storageGb - pConfig.includedStorageGb) / 10) * pConfig.extraStoragePer10GbPkr;
  const computed = pConfig.baseFeePkr + packs + extraStudents + extraStorage;

  // a custom plan never costs more than the cheapest ready-made plan that already covers the non-add-on selection
  const plan = coveringPlan(keys);
  let cap = null;
  if (plan) cap = pConfig.planPricePkr[plan] + Math.max(0, students - pConfig.planStudents[plan]) * pConfig.extraStudentPkr;
  const core = Math.max(pConfig.floorPkr, cap === null ? computed : Math.min(computed, cap));
  return { computed, coveringPlan: plan, coveringPlanPrice: cap, addonsPkr: addons, final: core + addons,
    packs: [...services], note: cap !== null && cap < computed ? `Capped at ${plan} price` : null };
}

module.exports = { PRICING, closeSelection, preview, price, coveringPlan, getPricingConfig, updateCustomPricing };
