// Recognises one-time-code fields from their attributes. Pure, so it can be tested without a DOM.

export interface FieldHints {
  type: string;
  autocomplete: string;
  name: string;
  id: string;
}

const otpWords = new Set(['otp', 'totp', '2fa', 'mfa', 'code', 'otc', 'onetimecode', 'twofactor']);
const otpPrefixes = ['otp', 'totp', '2fa', 'mfa'];

// Codes that are not one-time login codes.
const otherCodes = new Set([
  'zip', 'post', 'postal', 'postcode', 'promo', 'coupon', 'voucher', 'discount', 'gift', 'referral', 'invite',
  'country', 'area', 'phone', 'captcha', 'card', 'cvc', 'cvv', 'csc',
]);

const textTypes = new Set(['text', 'tel', 'number', 'password']);

// "twoFactorCode", "otp_code", "OTPInput" -> lower-case words.
export function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function looksLikeOtp(field: FieldHints): boolean {
  const autocomplete = field.autocomplete.toLowerCase().split(/\s+/);
  if (autocomplete.includes('one-time-code')) return true;
  if (autocomplete.some(token => token.startsWith('cc-'))) return false;
  if (!textTypes.has(field.type.toLowerCase())) return false;

  const hints = [...words(field.name), ...words(field.id)];
  if (hints.some(word => otherCodes.has(word))) return false;
  return hints.some(word => otpWords.has(word) || otpPrefixes.some(prefix => word.startsWith(prefix)));
}
