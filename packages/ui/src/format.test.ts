import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPhone, formatRwf, formatUpdatedAgo, groupDigits, parseAmount, percent } from './format';

test('formatRwf writes every amount as "RWF 1,500,000"', () => {
  assert.equal(formatRwf(1500000), 'RWF 1,500,000');
  assert.equal(formatRwf(0), 'RWF 0');
  assert.equal(formatRwf(999), 'RWF 999');
  assert.equal(formatRwf(-250000), '−RWF 250,000');
  assert.equal(formatRwf(1234.6), 'RWF 1,235');
});

test('groupDigits and parseAmount round-trip what a user types', () => {
  assert.equal(groupDigits('0015000'), '15,000');
  assert.equal(groupDigits(''), '');
  assert.equal(parseAmount('1,500,000'), 1500000);
  assert.equal(parseAmount('RWF 12 000'), 12000);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('99999999999999999999'), null);
});

test('formatUpdatedAgo stays honest about data age', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  assert.equal(formatUpdatedAgo(new Date('2026-10-08T11:59:40Z'), now), 'just now');
  assert.equal(formatUpdatedAgo('2026-10-08T11:55:00Z', now), '5 min ago');
  assert.equal(formatUpdatedAgo('2026-10-08T09:00:00Z', now), '3 h ago');
  assert.equal(formatUpdatedAgo('2026-10-07T10:00:00Z', now), '1 day ago');
  assert.equal(formatUpdatedAgo('2026-09-01T10:00:00Z', now), '1 Sept 2026');
});

test('percent clamps to 0–100', () => {
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(5, 0), 0);
  assert.equal(percent(12, 10), 100);
});

test('formatPhone groups Rwandan numbers for reading', () => {
  assert.equal(formatPhone('+250722345678'), '+250 72 234 5678');
  assert.equal(formatPhone('+32470123456'), '+32470123456');
});
