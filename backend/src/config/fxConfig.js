/**
 * Foreign Exchange (FX) Conversion Configuration for FundTraceAI Express Backend.
 * Standardizes international & crypto transactions to canonical INR baseline
 * for accurate scenario threshold and AML CTR/STR evaluations.
 */

const STATIC_FX_TO_INR = {
  'INR': 1.0,
  'RUPEE': 1.0,
  'INDIAN RUPEE': 1.0,
  'USD': 83.50,
  'US DOLLAR': 83.50,
  'EUR': 90.75,
  'EURO': 90.75,
  'GBP': 105.60,
  'UK POUND': 105.60,
  'POUND': 105.60,
  'AED': 22.74,
  'UAE DIRHAM': 22.74,
  'DIRHAM': 22.74,
  'SGD': 62.40,
  'SINGAPORE DOLLAR': 62.40,
  'CAD': 61.20,
  'CANADIAN DOLLAR': 61.20,
  'AUD': 54.80,
  'AUSTRALIAN DOLLAR': 54.80,
  'JPY': 0.55,
  'YEN': 0.55,
  'JAPANESE YEN': 0.55,
  'CHF': 93.10,
  'SWISS FRANC': 93.10,
  'CNY': 11.50,
  'CHINESE YUAN': 11.50,
  'HKD': 10.68,
  'HONG KONG DOLLAR': 10.68,
  'SAR': 22.25,
  'SAUDI RIYAL': 22.25,
  'QAR': 22.90,
  'QATARI RIYAL': 22.90,
  'RUB': 0.90,
  'RUSSIAN RUBLE': 0.90,
  'RUBLE': 0.90,
  'BRL': 15.20,
  'BRAZILIAN REAL': 15.20,
  'ZAR': 4.50,
  'SOUTH AFRICAN RAND': 4.50,
  'BITCOIN': 5500000.0,
  'BTC': 5500000.0,
  'ETH': 250000.0,
  'ETHEREUM': 250000.0
};

const CURRENCY_NAME_TO_ISO = {
  'US DOLLAR': 'USD',
  'EURO': 'EUR',
  'UK POUND': 'GBP',
  'POUND': 'GBP',
  'UAE DIRHAM': 'AED',
  'DIRHAM': 'AED',
  'SINGAPORE DOLLAR': 'SGD',
  'CANADIAN DOLLAR': 'CAD',
  'AUSTRALIAN DOLLAR': 'AUD',
  'YEN': 'JPY',
  'JAPANESE YEN': 'JPY',
  'SWISS FRANC': 'CHF',
  'CHINESE YUAN': 'CNY',
  'HONG KONG DOLLAR': 'HKD',
  'SAUDI RIYAL': 'SAR',
  'QATARI RIYAL': 'QAR',
  'RUSSIAN RUBLE': 'RUB',
  'RUBLE': 'RUB',
  'BRAZILIAN REAL': 'BRL',
  'SOUTH AFRICAN RAND': 'ZAR',
  'INDIAN RUPEE': 'INR',
  'RUPEE': 'INR',
  'BITCOIN': 'BTC',
  'ETHEREUM': 'ETH'
};

/**
 * Normalizes input currency code/name to canonical 3-letter ISO 4217 code.
 */
const normalizeCurrency = (currency) => {
  if (!currency) return 'INR';
  const clean = String(currency).trim().toUpperCase();
  return CURRENCY_NAME_TO_ISO[clean] || clean;
};

/**
 * Retrieves the exchange rate to INR for a given currency code.
 */
const getFxRate = (currency) => {
  if (!currency) return 1.0;
  const iso = normalizeCurrency(currency);
  return STATIC_FX_TO_INR[iso] || STATIC_FX_TO_INR[String(currency).trim().toUpperCase()] || 1.0;
};

/**
 * Calculates conversion to INR with rate and timestamp metadata.
 * Returns: { amount, currency, amount_inr, fx_rate, fx_date }
 */
const convertToINR = (amount, currency = 'INR', date = null) => {
  const numAmount = parseFloat(amount) || 0;
  const iso = normalizeCurrency(currency);
  const fxRate = getFxRate(iso);
  const amountInr = parseFloat((numAmount * fxRate).toFixed(2));
  const fxDate = date ? new Date(date) : new Date();

  return {
    amount: numAmount,
    currency: iso,
    amount_inr: amountInr,
    fx_rate: fxRate,
    fx_date: fxDate.toISOString()
  };
};

module.exports = {
  STATIC_FX_TO_INR,
  normalizeCurrency,
  getFxRate,
  convertToINR
};
