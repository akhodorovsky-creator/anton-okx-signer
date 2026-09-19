'use strict';
// Administrative audit only. This module has no order submission, account access or credentials.
const MAX_CAPITAL_EUR = 100;
const REQUIRED = Object.freeze([
  'accountVerified', 'spotEligibilityVerified', 'dedicatedApiKeyConfigured',
  'withdrawalPermissionDisabled', 'actualFeeVerified', 'pairRulesVerified',
  'authenticatedBalancesVerified', 'freshSynchronizedBooksVerified',
  'orderExecutionImplemented', 'partialFillRecoveryTested',
  'durableReservationsTested', 'restartReconciliationTested',
  'killSwitchTested', 'isolatedAccountCapitalVerified', 'operatorFinalApproval'
]);
function audit(input = {}) {
  const checks = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const missing = REQUIRED.filter(name => checks[name] !== true);
  const amount = checks.capitalEUR;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MAX_CAPITAL_EUR) missing.push('validCapitalEURAtMost100');
  // Readiness is informational only. A distinct reviewed execution gateway must enforce these checks.
  return Object.freeze({ mode: 'PAPER', capitalLimitEUR: MAX_CAPITAL_EUR,
    readyForReview: missing.length === 0, liveOrdersAuthorized: false, ordersSubmitted: 0,
    missingChecks: missing, note: 'Passing this audit never submits or authorizes an order. Separate audited execution and confirmed account required.' });
}
module.exports = {audit, REQUIRED, MAX_CAPITAL_EUR};
