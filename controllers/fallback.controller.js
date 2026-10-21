// controllers/fallback.controller.js
// Plan B controllers written against the real Academix models (Student.name, rollNumber, qrCode, cnic;
// Attendance.method; GateLog.verificationMethod; Certificate.certificateNumber; Notification).
// Error shape follows the app: { success:false, message, errorCode }.
//
// NOT covered here (needs the code of guard.controller.js, attendance.controller.js, fine.controller.js): see patch notes at the bottom.
const { getSystemClient } = require('../config/prismaManager');
const { CAPABILITIES } = require('../services/capabilityCatalog');

// ---------- core ----------
function methodFor(req, capabilityKey, requested) {
  const cap = req.entitlements?.capabilities?.[capabilityKey];
  if (!cap || !cap.available) {
    const e = new Error(`${capabilityKey} is not available for this college`);
    e.statusCode = 403; e.errorCode = 'CAPABILITY_UNAVAILABLE'; e.capability = capabilityKey; throw e;
  }
  if (requested && !cap.methods.includes(requested)) {
    const e = new Error(`Method "${requested}" is switched off for this college; use "${cap.method}"`);
    e.statusCode = 409; e.errorCode = 'METHOD_UNAVAILABLE'; e.useMethod = cap.method; e.available = cap.methods; throw e;
  }
  return { method: requested || cap.method, cap };
}

// Plan B usage is platform analytics, so it goes to the system database (one place, no tenant migration).
async function logFallback(req, capability, method, cap, meta) {
  if (!cap.fallbackUsed) return;
  try {
    await getSystemClient().fallbackEvent.create({ data: {
      college_id: req.collegeId, capability, method, userId: req.user?.id ?? null, role: req.user?.role ?? null, meta: meta ?? undefined } });
  } catch (_) { /* never fail the request for analytics */ }
}

const wrap = fn => (req, res, next) => fn(req, res, next).catch(err => {
  if (err.errorCode) return res.status(err.statusCode || 400).json({ success: false, message: err.message,
    errorCode: err.errorCode, capability: err.capability, useMethod: err.useMethod, available: err.available });
  next(err);
});

async function currentSessionId(db, collegeId) {
  const s = await db.session.findFirst({ where: { college_id: collegeId, isCurrent: true }, select: { id: true } });
  return s?.id || null;
}

const digits = v => String(v || '').replace(/\D/g, '');
const dashedCnic = d => (d.length === 13 ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` : null);
const PUBLIC_STUDENT = { id: true, name: true, fatherName: true, rollNumber: true, class: true, section: true, group: true, photo: true, qrCode: true, cardId: true, status: true };

// ---------- 1. Find a student: QR first, typing as Plan B ----------
// POST /api/students/identify   body: { qrCode } | { query }
// Replaces GET /api/gate/lookup, which currently throws ReferenceError (findPersonByQR is not defined).
const identifyStudent = wrap(async (req, res) => {
  const db = req.tenantClient, collegeId = req.collegeId;
  const { qrCode, query } = req.body || {};
  const { method, cap } = methodFor(req, 'student.identify', qrCode ? 'qr' : 'search');
  let students = [];

  if (method === 'qr') {
    const code = String(qrCode).trim();
    students = await db.student.findMany({
      where: { college_id: collegeId, status: 'active', OR: [{ qrCode: code }, { cardId: code }] },
      select: PUBLIC_STUDENT, take: 2 });
  } else {
    const q = String(query || '').trim();
    if (q.length < 2) return res.status(400).json({ success: false, message: 'Type at least 2 characters', errorCode: 'QUERY_TOO_SHORT' });
    const sessionId = await currentSessionId(db, collegeId);          // rollNumber is only unique per session
    const d = digits(q);
    const or = [
      { rollNumber: { equals: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { fatherName: { contains: q, mode: 'insensitive' } },
    ];
    if (d.length >= 5) {                                              // CNIC / B-Form is stored raw, with or without dashes
      or.push({ cnic: d }, { guardianPhone: { contains: d } });
      const dashed = dashedCnic(d); if (dashed) or.push({ cnic: dashed });
    }
    students = await db.student.findMany({
      where: { college_id: collegeId, status: 'active', ...(sessionId ? { session_id: sessionId } : {}), OR: or },
      select: PUBLIC_STUDENT, orderBy: { name: 'asc' }, take: 10 });
  }
  await logFallback(req, 'student.identify', method, cap);
  res.json({ success: true, method, fallbackUsed: cap.fallbackUsed, needsConfirmation: method !== 'qr' || students.length !== 1, students });
});

// ---------- 2. Gate without a scanner: guard types roll number or name ----------
// POST /api/gate/manual   body: { studentId, action?: 'entry'|'exit' }
// Reuses scanQR so early-exit approval, GateLog and the daily Attendance row behave exactly as with a scan.
// Needs: scanQR to accept method 'MANUAL' (see patch note 1). Route gate: featureGate(['gate-scanner','gate-manual-log']).
const makeGateManual = scanQR => wrap(async (req, res, next) => {
  const { method, cap } = methodFor(req, 'gate.log', 'manual');
  const student = await req.tenantClient.student.findFirst({
    where: { id: req.body.studentId, college_id: req.collegeId, status: 'active' }, select: { id: true, qrCode: true, cardId: true } });
  if (!student) return res.status(404).json({ success: false, message: 'Student not found', errorCode: 'PERSON_NOT_FOUND' });
  const identifier = student.qrCode || student.cardId;
  if (!identifier) return res.status(409).json({ success: false, message: 'Student has no card id yet', errorCode: 'NO_CARD_ID' });
  req.body = { ...req.body, identifier, qrCode: identifier, method: 'MANUAL', verificationMethod: 'MANUAL' };
  await logFallback(req, 'gate.log', method, cap);
  return scanQR(req, res, next);
});

// ---------- 3. Verify a certificate or result at the office ----------
// POST /api/verify   body: { certificateNumber } | { rollNumber, examId }     (QR option arrives with qr-verify)
const verifyDocument = wrap(async (req, res) => {
  const db = req.tenantClient, collegeId = req.collegeId;
  const { token, voucherNumber, challanNumber, certificateNumber, rollNumber, examId } = req.body || {};
  const requestedMethod = (token || req.body.method === 'qr') ? 'qr' : 'serial';
  const { method, cap } = methodFor(req, 'doc.verify', requestedMethod);
  let found = null;

  if (token) {
    const t = String(token).trim();
    // 1. Check Certificate
    const c = await db.certificate.findFirst({ where: { college_id: collegeId, verifyToken: t } });
    if (c) {
      const s = await db.student.findFirst({ where: { id: c.student_id, college_id: collegeId }, select: { name: true, fatherName: true, rollNumber: true, class: true, group: true } });
      found = { kind: 'certificate', type: c.type, number: c.certificateNumber, issueDate: c.issueDate, status: c.status, valid: c.status === 'issued', student: s };
    } else {
      // 2. Check Fee Voucher
      const f = await db.fee.findFirst({ where: { college_id: collegeId, verifyToken: t } });
      if (f) {
        const s = await db.student.findFirst({ where: { id: f.student_id, college_id: collegeId }, select: { name: true, fatherName: true, rollNumber: true, class: true, group: true } });
        found = { kind: 'voucher', voucherNumber: f.challanNumber, amount: Number(f.totalAmount), dueDate: f.dueDate, status: f.status, valid: f.status !== 'void', student: s };
      } else {
        // 3. Check Payment Receipt
        const p = await db.payment.findFirst({ where: { college_id: collegeId, verifyToken: t } });
        if (p) {
          const s = await db.student.findFirst({ where: { id: p.student_id, college_id: collegeId }, select: { name: true, fatherName: true, rollNumber: true, class: true, group: true } });
          found = { kind: 'receipt', receiptNumber: p.receiptNumber, amount: Number(p.amount), paidDate: p.createdAt, method: p.paymentMethod, valid: true, student: s };
        }
      }
    }
  } else if (voucherNumber || challanNumber) {
    const vNum = String(voucherNumber || challanNumber).trim();
    const f = await db.fee.findFirst({ where: { college_id: collegeId, challanNumber: vNum } });
    if (f) {
      const s = await db.student.findFirst({ where: { id: f.student_id, college_id: collegeId }, select: { name: true, fatherName: true, rollNumber: true, class: true, group: true } });
      found = { kind: 'voucher', voucherNumber: f.challanNumber, amount: Number(f.totalAmount), dueDate: f.dueDate, status: f.status, valid: f.status !== 'void', student: s };
    }
  } else if (certificateNumber) {
    const c = await db.certificate.findFirst({ where: { college_id: collegeId, certificateNumber: String(certificateNumber).trim() } });
    if (c) {
      const s = await db.student.findFirst({ where: { id: c.student_id, college_id: collegeId }, select: { name: true, fatherName: true, rollNumber: true, class: true, group: true } });
      found = { kind: 'certificate', type: c.type, number: c.certificateNumber, issueDate: c.issueDate, status: c.status, valid: c.status === 'issued', student: s };
    }
  } else if (rollNumber && examId) {
    const sessionId = await currentSessionId(db, collegeId);
    const s = await db.student.findFirst({ where: { college_id: collegeId, rollNumber: String(rollNumber), ...(sessionId ? { session_id: sessionId } : {}) }, select: { id: true, name: true, rollNumber: true, class: true, group: true } });
    const r = s && await db.result.findFirst({ where: { college_id: collegeId, student_id: s.id, exam_id: examId, isPublished: true } });
    if (r) found = { kind: 'result', valid: true, student: s, totalObtained: r.totalObtained, totalMarks: r.totalMarks, percentage: r.percentage, grade: r.grade };
  } else {
    return res.status(400).json({ success: false, message: 'Send token, voucherNumber, certificateNumber, or rollNumber with examId', errorCode: 'BAD_REQUEST' });
  }

  await logFallback(req, 'doc.verify', method, cap);
  res.json({ success: true, method, fallbackUsed: cap.fallbackUsed, valid: !!found?.valid, document: found });
});

// ---------- 4. Tell parents ----------
// POST /api/notify/parents   body: { studentIds, title, message, type? }
// Built today: in-app notice to the student account (Notification) and a printable list.
// WhatsApp, SMS and the parent portal return 501 until they are built; the resolver already skips them.
const notifyParents = wrap(async (req, res) => {
  const db = req.tenantClient, collegeId = req.collegeId;
  const { studentIds = [], title, message, type = 'general' } = req.body || {};
  if (!studentIds.length || !message) return res.status(400).json({ success: false, message: 'studentIds and message are required', errorCode: 'BAD_REQUEST' });
  const { method, cap } = methodFor(req, 'parent.notify', req.body.channel);
  const students = await db.student.findMany({
    where: { college_id: collegeId, id: { in: studentIds } },
    select: { id: true, name: true, rollNumber: true, class: true, section: true, user_id: true, guardianName: true, guardianPhone: true } });

  if (method === 'inapp') {
    const rows = students.filter(s => s.user_id).map(s => ({ college_id: collegeId, recipient: s.user_id, title: title || 'Notice', message, type }));
    if (rows.length) await db.notification.createMany({ data: rows });
    await logFallback(req, 'parent.notify', method, cap, { count: rows.length });
    return res.json({ success: true, method, sent: rows.length, withoutAccount: students.length - rows.length, fallbackUsed: cap.fallbackUsed });
  }
  if (method === 'print') {
    await logFallback(req, 'parent.notify', method, cap, { count: students.length });
    return res.json({ success: true, method, fallbackUsed: true, printList: students.map(({ user_id, ...s }) => s), title, message });
  }
  return res.status(501).json({ success: false, message: `${method} sending is not built yet`, errorCode: 'NOT_BUILT', method });
});

// ---------- 5. What the UI should render ----------
// GET /api/me/capabilities   (protect, tenantContext, loadEntitlements)
const myCapabilities = (req, res) => {
  const ent = req.entitlements;
  if (!ent?.active) return res.status(403).json({ success: false, message: 'College account or subscription is not active', code: ent?.reason });
  const out = {};
  for (const c of CAPABILITIES) {
    out[c.key] = { ...ent.capabilities[c.key], name: c.name, labels: Object.fromEntries(c.methods.map(m => [m.id, m.label])) };
  }
  res.json({ success: true, capabilities: out, degraded: ent.degraded });
};

module.exports = { methodFor, identifyStudent, makeGateManual, verifyDocument, notifyParents, myCapabilities };

/* ---------- routes ----------
const { featureGate, loadEntitlements } = require('../middleware/loadEntitlements');
router.post('/students/identify', protect, tenantContext, featureGate('students'),                      identifyStudent);
router.post('/gate/manual',       protect, tenantContext, authorize('employee','admin'),
                                  featureGate(['gate-scanner','gate-manual-log']),                      makeGateManual(scanQR));
router.post('/verify',            protect, tenantContext, authorize('admin','principal','registrar'),
                                  featureGate('students'),                                              verifyDocument);
router.post('/notify/parents',    protect, tenantContext, authorize('admin','principal','teacher','registrar'),
                                  featureGate('announcements'),                                         notifyParents);
router.get ('/me/capabilities',   protect, tenantContext, loadEntitlements,                              myCapabilities);

   ---------- patch notes for code I have not seen (round 2 prompt asks for these files) ----------
 1. guard.controller.js
    - GET /api/gate/lookup calls findPersonByQR, which is not defined: ReferenceError today. Delete that route and use POST /api/students/identify,
      or define the function. FineStudent.jsx line 84-97 calls it.
    - scanQR must accept method 'MANUAL' and look the person up by Student.qrCode (it already does, via the identifier we pass); write
      GateLog.verificationMethod = 'MANUAL'.
    - Route guard.routes.js is gated by planGate('entry-system'). Switching it off today also switches off early-exit requests (same file).
      Use featureGate('gate-scanner') on /scan and featureGate(['gate-scanner','gate-manual-log']) on /manual, and featureGate('early-exit') on early-exit routes.
 2. attendance.controller.js
    - Attendance.method already exists. markAttendance and markBulkAttendance must stamp method:'manual' (default already does) and, when a row
      with method 'qr' or 'biometric' exists for that day and a teacher edits it, write remarks 'correction: <reason>' and keep markedBy.
    - qrGateScan (POST /api/attendance/qr-scan) is a second QR attendance route, ungated beyond 'attendance'. Gate it with featureGate('attendance-qr').
 3. fine.controller.js
    - Takes { student_id, amount, reason, category } and requires teacher_id: it never reads a QR code, so fines already work with or without
      the scanner. Nothing to change except gating: add featureGate('fines') (the route is ungated today).
 4. Application desk entry: the registrar route may already create applications. Confirm in registrar.controller.js before adding
    Application.source = 'DESK'.
*/
