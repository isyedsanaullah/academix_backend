/**
 * Payment Proof Service
 * ─────────────────────────────────────────────────────────────
 * Business logic for screenshot-based payment proofs:
 * - Validation rules (transactionId, balance bounds, max pending)
 * - Forensic warning calculations for accountant verification queue
 * - State machine transitions
 */

const { Prisma } = require('@prisma/client');

const ALLOWED_PAYMENT_METHODS = ['easypaisa', 'jazzcash', 'bank', 'raast', 'other'];

/**
 * Valid state transitions for PaymentProof
 */
const PAYMENT_PROOF_STATES = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  DUPLICATE: 'duplicate'
};

const VALID_TRANSITIONS = {
  pending: ['verified', 'rejected', 'duplicate'],
  verified: [],
  rejected: [],
  duplicate: []
};

/**
 * Validate transaction ID format (6-30 alphanumeric characters)
 *
 * @param {string} txId
 * @returns {boolean}
 */
function isValidTransactionId(txId) {
  if (!txId || typeof txId !== 'string') return false;
  const trimmed = txId.trim();
  return /^[A-Za-z0-9]{6,30}$/.test(trimmed);
}

/**
 * Check if state transition is allowed
 *
 * @param {string} currentStatus
 * @param {string} nextStatus
 * @returns {boolean}
 */
function canTransition(currentStatus, nextStatus) {
  const allowed = VALID_TRANSITIONS[currentStatus?.toLowerCase()] || [];
  return allowed.includes(nextStatus?.toLowerCase());
}

/**
 * Compute accountant queue forensic warnings for a payment proof
 *
 * Checks:
 * 1. Submitted amount differs from voucher outstanding balance
 * 2. Payment date is older than voucher creation date
 * 3. Sender phone number was previously used for a different student
 * 4. Image checksum (SHA-256) matches an earlier uploaded screenshot
 *
 * @param {Object} params
 * @param {Object} params.proof - PaymentProof record
 * @param {Object} params.fee - Fee record
 * @param {Object} params.tenantDb - Prisma client for tenant
 * @returns {Promise<Array<{ code: string, message: string, severity: string }>>}
 */
async function computeProofWarnings({ proof, fee, tenantDb }) {
  const warnings = [];

  if (!proof || !fee || !tenantDb) return warnings;

  const proofAmount = Number(proof.amount || 0);
  const totalAmount = Number(fee.totalAmount || 0);
  const paidAmount = Number(fee.paidAmount || 0);
  const balance = Math.max(0, totalAmount - paidAmount);

  // 1. Amount mismatch check
  if (Math.abs(proofAmount - balance) > 0.01) {
    warnings.push({
      code: 'AMOUNT_MISMATCH',
      message: `Amount Rs. ${proofAmount.toLocaleString()} differs from outstanding balance Rs. ${balance.toLocaleString()}`,
      severity: 'warning'
    });
  }

  // 2. Paid date precedes voucher creation date
  if (proof.paidOn && fee.createdAt) {
    const paidTime = new Date(proof.paidOn).getTime();
    const feeCreatedTime = new Date(fee.createdAt).getTime();
    // Allow small 5-minute clock drift
    if (paidTime < feeCreatedTime - 5 * 60 * 1000) {
      warnings.push({
        code: 'PAID_BEFORE_VOUCHER',
        message: 'Payment date is prior to voucher generation date',
        severity: 'caution'
      });
    }
  }

  // 3. Sender phone collision across different students
  if (proof.senderPhone && proof.senderPhone.trim().length >= 7) {
    const cleanPhone = proof.senderPhone.trim();
    const otherStudentProof = await tenantDb.paymentProof.findFirst({
      where: {
        college_id: proof.college_id,
        senderPhone: cleanPhone,
        student_id: { not: proof.student_id }
      },
      select: { id: true, student_id: true }
    });

    if (otherStudentProof) {
      warnings.push({
        code: 'SHARED_SENDER_PHONE',
        message: `Sender phone (${cleanPhone}) has also been used for another student's payment proof`,
        severity: 'danger'
      });
    }
  }

  // 4. Image checksum collision (duplicate screenshot)
  if (proof.file_id) {
    const currentFile = await tenantDb.storedFile.findUnique({
      where: { id: proof.file_id },
      select: { checksumSha256: true }
    });

    if (currentFile?.checksumSha256) {
      const duplicateFile = await tenantDb.storedFile.findFirst({
        where: {
          college_id: proof.college_id,
          checksumSha256: currentFile.checksumSha256,
          id: { not: proof.file_id }
        },
        select: { id: true }
      });

      if (duplicateFile) {
        warnings.push({
          code: 'DUPLICATE_IMAGE_HASH',
          message: 'Screenshot file hash matches an earlier uploaded payment proof',
          severity: 'danger'
        });
      }
    }
  }

  return warnings;
}

module.exports = {
  ALLOWED_PAYMENT_METHODS,
  PAYMENT_PROOF_STATES,
  VALID_TRANSITIONS,
  isValidTransactionId,
  canTransition,
  computeProofWarnings
};
