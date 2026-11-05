/**
 * paymentGatewayAdapter.js — Sub-Phase 8K (#82 Online Fee Payment Gateway)
 * Adapter interface & stub definitions.
 * Stays coming_soon until production PSP merchant onboarding.
 */

class PaymentGatewayDriver {
  constructor(name) {
    this.name = name;
    this.isReal = false;
  }

  async initiatePayment({ collegeId, studentId, feeId, amountPkr, returnUrl }) {
    throw new Error(`Payment gateway ${this.name} is not available.`);
  }

  async handleWebhook({ collegeId, payload, headers }) {
    throw new Error(`Payment gateway ${this.name} webhook handler is not available.`);
  }

  async verifyTransaction({ collegeId, transactionId }) {
    throw new Error(`Payment gateway ${this.name} verification is not available.`);
  }
}

class JazzCashDriver extends PaymentGatewayDriver {
  constructor() {
    super('JazzCash');
    this.isReal = false;
  }
}

class EasyPaisaDriver extends PaymentGatewayDriver {
  constructor() {
    super('EasyPaisa');
    this.isReal = false;
  }
}

/**
 * Returns active online payment gateway driver, or null if none active
 */
function getActiveGatewayDriver(collegeId) {
  // Online payment gateway stays in coming_soon state without production merchant credentials
  return null;
}

module.exports = {
  PaymentGatewayDriver,
  JazzCashDriver,
  EasyPaisaDriver,
  getActiveGatewayDriver
};

