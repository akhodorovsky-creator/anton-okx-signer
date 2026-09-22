'use strict';
// Convert decimal/scientific notation to integers before rounding down.
function decimal(value) {
  if (!['number', 'string'].includes(typeof value)) throw Error('INVALID_DECIMAL');
  const match = String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw Error('INVALID_DECIMAL');
  const exponent = Number(match[3] || 0), fraction = match[2] || '';
  if (Math.abs(exponent) > 24 || fraction.length > 24) throw Error('DECIMAL_RANGE');
  let units = BigInt(match[1] + fraction), scale = fraction.length - exponent;
  if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
  if (scale > 24) throw Error('DECIMAL_RANGE');
  return {units, scale};
}
function sellSize(qty, available, lot, min) {
  try {
    const values = [qty, available, lot, min].map(decimal);
    if (values.some(v => v.units <= 0n)) return null;
    const scale = Math.max(...values.map(v => v.scale));
    const [q, a, l, m] = values.map(v => v.units * 10n ** BigInt(scale - v.scale));
    const value = ((q < a ? q : a) / l) * l;
    if (value < m) return null;
    const digits = value.toString().padStart(scale + 1, '0');
    return scale ? (digits.slice(0, -scale) + '.' + digits.slice(-scale)).replace(/\.?0+$/, '') : digits;
  } catch { return null; }
}
module.exports = {sellSize};
