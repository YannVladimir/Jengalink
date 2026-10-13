import {
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizeRwandanMobile,
} from './contact';

describe('normalizeRwandanMobile', () => {
  it.each([
    ['0788123456', '+250788123456', 'MTN'],
    ['078 812 3456', '+250788123456', 'MTN'],
    ['+250 79 123 4567', '+250791234567', 'MTN'],
    ['250721234567', '+250721234567', 'Airtel'],
    ['0731234567', '+250731234567', 'Airtel'],
  ])('%s → %s (%s)', (input, e164, operator) => {
    expect(normalizeRwandanMobile(input)).toEqual({ e164, operator });
  });

  it.each([
    ['a landline', '0252123456'],
    ['too short', '078812345'],
    ['a Belgian mobile', '+32470123456'],
    ['letters', 'call me'],
  ])('rejects %s', (_label, input) => {
    expect(normalizeRwandanMobile(input)).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lower-cases and trims', () => {
    expect(normalizeEmail('  Aline.Uwase@Example.COM ')).toBe(
      'aline.uwase@example.com',
    );
  });
  it('rejects invalid addresses', () => {
    expect(normalizeEmail('aline@')).toBeNull();
    expect(normalizeEmail('no-at-sign.com')).toBeNull();
  });
});

describe('masking for logs', () => {
  it('keeps only enough to recognise the contact', () => {
    expect(maskPhone('+250788123456')).toBe('+250 78* *** 456');
    expect(maskEmail('aline@example.com')).toBe('a***@example.com');
  });
});
