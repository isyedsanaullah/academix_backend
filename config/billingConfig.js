'use strict';

/**
 * Billing & Manual Bank Transfer Configuration
 * Bank account details are read from env with safe dummy defaults for dev/testing.
 */

const BANK_DETAILS = Object.freeze({
  bankName: process.env.BILLING_BANK_NAME || 'UBL (United Bank Limited)',
  accountTitle: process.env.BILLING_BANK_ACCOUNT_TITLE || 'CollegesHub Technologies (Dummy Account)',
  accountNumber: process.env.BILLING_BANK_ACCOUNT_NUMBER || '0123-4567890123',
  iban: process.env.BILLING_BANK_IBAN || 'PK36UNIL0109000123456789',
  branch: process.env.BILLING_BANK_BRANCH || 'Islamabad Main Branch (0412)',
});

const INVOICE_DUE_DAYS = Math.max(1, parseInt(process.env.INVOICE_DUE_DAYS || '7', 10) || 7);

// Config flag to enable/disable mid-term upgrade proration (calculated from locked subscription price)
function isUpgradeProrationEnabled() {
  return String(process.env.ENABLE_UPGRADE_PRORATION || 'true').trim().toLowerCase() !== 'false';
}

const PROOF_UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const PROOF_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];

module.exports = {
  BANK_DETAILS,
  INVOICE_DUE_DAYS,
  isUpgradeProrationEnabled,
  PROOF_UPLOAD_MAX_BYTES,
  PROOF_ALLOWED_MIMES,
};

