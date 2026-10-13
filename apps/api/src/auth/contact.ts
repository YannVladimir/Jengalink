import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export type Operator = 'MTN' | 'Airtel';

// Rwandan mobile prefixes after +250: MTN 78/79, Airtel 72/73.
const operatorByPrefix: Record<string, Operator> = {
  '78': 'MTN',
  '79': 'MTN',
  '72': 'Airtel',
  '73': 'Airtel',
};

/**
 * Normalises a Rwandan mobile number to E.164 (+2507XXXXXXXX), as the spec
 * requires (§26.5). Returns null for anything that is not an MTN or Airtel
 * Rwanda mobile; owners abroad sign in by email instead.
 */
export function normalizeRwandanMobile(
  input: string,
): { e164: string; operator: Operator } | null {
  const phone = parsePhoneNumberFromString(input.trim(), 'RW');
  if (!phone || phone.country !== 'RW' || !phone.isValid()) return null;
  const operator = operatorByPrefix[phone.nationalNumber.slice(0, 2)];
  if (!operator) return null;
  return { e164: phone.number, operator };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : null;
}

/** "+250 78* *** 456" — enough to recognise, not enough to reuse. Safe for logs. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)} ${e164.slice(4, 6)}* *** ${e164.slice(-3)}`;
}

/** "a***@example.com". Safe for logs. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name[0]}***@${domain}`;
}
