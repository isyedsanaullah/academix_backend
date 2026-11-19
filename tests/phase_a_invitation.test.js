'use strict';

const assert = require('assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase-a-test-secret';

const { getFrontendBaseUrl } = require('../config/env');
const { TRIAL_DAYS, TRIAL_ENTITLEMENT_PLAN } = require('../config/trialConfig');
const { hashToken } = require('../utils/token');

function withEnv(vars, fn) {
  const backup = {};
  for (const k of Object.keys(vars)) {
    backup[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  const restore = () => {
    for (const k of Object.keys(vars)) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

function makeRes() {
  const res = {
    statusCode: 200,
    cookies: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    cookie(name, val, opts) {
      this.cookies[name] = { val, opts };
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

async function run() {
  console.log('🧪 Running Phase (a) Invitation & No-Plan Verification Tests...\n');

  // 1. Canonical URL resolution (must NEVER return comma-separated CORS list)
  withEnv(
    {
      NODE_ENV: 'production',
      ROOT_DOMAIN: 'collegeshub.org',
      FRONTEND_URL: undefined,
      APP_URL: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      CLIENT_URL: 'https://academix-frontend-two.vercel.app,https://collegeshub.org,https://www.collegeshub.org'
    },
    () => {
      const url = getFrontendBaseUrl();
      assert.strictEqual(url, 'https://www.collegeshub.org', `Expected www.collegeshub.org, got ${url}`);
      assert(!url.includes(','), 'Invite base URL must never contain commas');
    }
  );
  console.log('  ✔ Canonical frontend base URL strips comma-separated CLIENT_URL and selects https://www.collegeshub.org');

  // 2. Trial constants sanity
  assert.strictEqual(TRIAL_DAYS, 14);
  assert.strictEqual(TRIAL_ENTITLEMENT_PLAN, 'standard');
  console.log('  ✔ TRIAL_DAYS=14 and TRIAL_ENTITLEMENT_PLAN=standard verified');

  // 3. Mock Prisma + Controller tests (inviteCollege, verifyInvitationToken, requestNewInvitation, acceptInvitation)
  const store = {
    invitations: new Map(),
    colleges: new Map(),
    users: new Map(),
    audits: [],
    notifications: []
  };

  const mockPrisma = {
    college: {
      findUnique: async ({ where }) => {
        if (where.email) {
          return Array.from(store.colleges.values()).find(c => c.email === where.email) || null;
        }
        return store.colleges.get(where.id) || null;
      },
      create: async ({ data }) => {
        const row = { id: crypto.randomUUID(), tokenEpoch: 0, ...data, createdAt: new Date() };
        store.colleges.set(row.id, row);
        return row;
      }
    },
    user: {
      findUnique: async ({ where }) => {
        if (where.email) {
          return Array.from(store.users.values()).find(u => u.email === where.email) || null;
        }
        return store.users.get(where.id) || null;
      },
      findMany: async () => [],
      create: async ({ data }) => {
        const row = { id: crypto.randomUUID(), ...data, createdAt: new Date() };
        store.users.set(row.id, row);
        return row;
      }
    },
    collegeInvitation: {
      findFirst: async ({ where }) => {
        for (const inv of store.invitations.values()) {
          if (where.email && inv.email !== where.email) continue;
          if (where.status && inv.status !== where.status) continue;
          if (where.expiresAt?.gt && !(new Date(inv.expiresAt) > where.expiresAt.gt)) continue;
          return inv;
        }
        return null;
      },
      findUnique: async ({ where }) => {
        if (where.id) return store.invitations.get(where.id) || null;
        if (where.tokenHash) {
          return Array.from(store.invitations.values()).find(i => i.tokenHash === where.tokenHash) || null;
        }
        return null;
      },
      create: async ({ data }) => {
        assert.strictEqual('planId' in data, false, 'CollegeInvitation must NOT store planId');
        assert.strictEqual('token' in data, false, 'CollegeInvitation must NOT store plaintext token');
        assert.ok(data.tokenHash && data.tokenHash.length === 64, 'CollegeInvitation must store SHA-256 tokenHash');
        const row = { id: crypto.randomUUID(), ...data, acceptedAt: null, renewalRequestedAt: null, collegeId: null, createdAt: new Date() };
        store.invitations.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const cur = store.invitations.get(where.id);
        const updated = { ...cur, ...data };
        store.invitations.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const [k, inv] of store.invitations.entries()) {
          if (where.id && inv.id !== where.id) continue;
          if (where.status && inv.status !== where.status) continue;
          if ('acceptedAt' in where && where.acceptedAt === null && inv.acceptedAt !== null) continue;
          if (where.expiresAt?.gt && !(new Date(inv.expiresAt) > where.expiresAt.gt)) continue;
          store.invitations.set(k, { ...inv, ...data });
          count++;
        }
        return { count };
      },
      count: async () => store.invitations.size,
      findMany: async () => Array.from(store.invitations.values())
    },
    auditLog: {
      create: async ({ data }) => {
        store.audits.push(data);
        return data;
      }
    },
    notification: {
      createMany: async ({ data }) => {
        store.notifications.push(...data);
        return { count: data.length };
      }
    },
    $transaction: async (fn) => fn(mockPrisma)
  };

  // Inject mock prismaManager into require cache
  const prismaManagerPath = require.resolve('../config/prismaManager');
  require.cache[prismaManagerPath] = {
    id: prismaManagerPath,
    filename: prismaManagerPath,
    loaded: true,
    exports: { getSystemClient: () => mockPrisma, closeAllClients: async () => {} }
  };

  const invitationCtrl = require('../controllers/invitation.controller');

  // 3a. Super Admin sends invite (even if caller tries passing planId, it must be ignored/omitted)
  await withEnv(
    {
      NODE_ENV: 'production',
      ROOT_DOMAIN: 'collegeshub.org',
      CLIENT_URL: 'https://academix-frontend-two.vercel.app,https://www.collegeshub.org'
    },
    async () => {
      const req = {
        user: { id: 'sa-1' },
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
        body: { email: '  Principal@LahoreCollege.edu.pk ', collegeName: 'Lahore College', planId: 'premium' }
      };
      const res = makeRes();
      await invitationCtrl.inviteCollege(req, res, (e) => { throw e; });

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.inviteUrl.startsWith('https://www.collegeshub.org/register/invitation/'));
      assert.strictEqual(res.body.data.invitation.planId, undefined);
      assert.strictEqual(res.body.data.invitation.tokenHash, undefined, 'tokenHash must never be leaked in API response');

      const rawToken = res.body.data.inviteUrl.split('/').pop();
      assert.strictEqual(rawToken.length, 64);

      // 3b. Verify token (with whitespace and uppercase tolerance) -> valid, no planId
      const verifyReq = { params: { token: `  ${rawToken.toUpperCase()}  ` } };
      const verifyRes = makeRes();
      await invitationCtrl.verifyInvitationToken(verifyReq, verifyRes, (e) => { throw e; });
      assert.strictEqual(verifyRes.statusCode, 200);
      assert.strictEqual(verifyRes.body.valid, true);
      assert.strictEqual(verifyRes.body.state, 'valid');
      assert.strictEqual(verifyRes.body.data.email, 'principal@lahorecollege.edu.pk');
      assert.strictEqual(verifyRes.body.data.collegeName, 'Lahore College');
      assert.strictEqual(verifyRes.body.data.planId, undefined);

      // 3c. Invalid token -> state: 'invalid'
      const badRes = makeRes();
      await invitationCtrl.verifyInvitationToken({ params: { token: 'not-a-valid-token' } }, badRes, (e) => { throw e; });
      assert.strictEqual(badRes.body.state, 'invalid');

      // 3d. Expired token -> state: 'expired', canRequestNew: true, and requestNewInvitation works
      const invId = res.body.data.invitation.id;
      const savedInv = store.invitations.get(invId);
      store.invitations.set(invId, { ...savedInv, expiresAt: new Date(Date.now() - 60000) });

      const expRes = makeRes();
      await invitationCtrl.verifyInvitationToken({ params: { token: rawToken } }, expRes, (e) => { throw e; });
      assert.strictEqual(expRes.body.state, 'expired');
      assert.strictEqual(expRes.body.canRequestNew, true);

      const reqNewRes = makeRes();
      await invitationCtrl.requestNewInvitation(
        { body: { token: rawToken }, headers: {}, socket: { remoteAddress: '127.0.0.1' } },
        reqNewRes,
        (e) => { throw e; }
      );
      assert.strictEqual(reqNewRes.statusCode, 200);
      assert.strictEqual(reqNewRes.body.success, true);
      assert.ok(store.invitations.get(invId).renewalRequestedAt instanceof Date);

      // Restore expiry to valid for acceptance test
      store.invitations.set(invId, { ...store.invitations.get(invId), status: 'pending', expiresAt: new Date(Date.now() + 3600000) });

      // 3e. Accept invitation -> creates College in TRIAL (14 days) + signs JWT with decoded.userId
      const acceptRes = makeRes();
      await invitationCtrl.acceptInvitation(
        {
          body: {
            token: rawToken,
            name: 'Dr. Ayesha Khan',
            designation: 'Principal',
            password: 'StrongPassword#2026'
          },
          headers: {},
          socket: { remoteAddress: '127.0.0.1' }
        },
        acceptRes,
        (e) => { throw e; }
      );
      assert.strictEqual(acceptRes.statusCode, 201);
      assert.strictEqual(acceptRes.body.success, true);
      assert.strictEqual(acceptRes.body.data.college.subStatus, 'TRIAL');
      assert.strictEqual(acceptRes.body.data.college.status, 'onboarding');
      assert.strictEqual(acceptRes.body.data.college.planId, 'standard');
      assert.ok(acceptRes.body.data.college.trialStartedAt);
      assert.ok(acceptRes.body.data.college.trialEndsAt);
      const diffDays = Math.round(
        (new Date(acceptRes.body.data.college.trialEndsAt) - new Date(acceptRes.body.data.college.trialStartedAt)) / 86400000
      );
      assert.strictEqual(diffDays, 14);
      assert.ok(acceptRes.body.data.user.college, 'user.college must be populated for AuthGuard');

      // Verify JWT payload matches middleware/auth.js (decoded.userId)
      const decoded = jwt.verify(acceptRes.body.token, process.env.JWT_SECRET);
      assert.strictEqual(decoded.userId, acceptRes.body.data.user.id, 'JWT must include userId for auth.js');
      assert.strictEqual(decoded.role, 'admin');

      // 3f. Re-verifying used token -> state: 'used'
      const usedVerifyRes = makeRes();
      await invitationCtrl.verifyInvitationToken({ params: { token: rawToken } }, usedVerifyRes, (e) => { throw e; });
      assert.strictEqual(usedVerifyRes.body.state, 'used');

      // 3g. Double-accepting used token -> 409 state: 'used'
      const dupAcceptRes = makeRes();
      await invitationCtrl.acceptInvitation(
        {
          body: { token: rawToken, name: 'Duplicate', designation: 'Principal', password: 'StrongPassword#2026' },
          headers: {},
          socket: { remoteAddress: '127.0.0.1' }
        },
        dupAcceptRes,
        (e) => { throw e; }
      );
      assert.strictEqual(dupAcceptRes.statusCode, 409);
      assert.strictEqual(dupAcceptRes.body.state, 'used');
    }
  );

  console.log('  ✔ inviteCollege (no plan, SHA-256 tokenHash), verifyInvitationToken (valid/expired/used/invalid), requestNewInvitation, and acceptInvitation (TRIAL + valid JWT) all passed!');
}

run().catch((err) => {
  console.error('❌ Phase (a) tests failed:', err);
  process.exit(1);
});

