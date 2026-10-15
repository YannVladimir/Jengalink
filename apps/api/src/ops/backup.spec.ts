import { randomBytes } from 'node:crypto';
import {
  decryptBuffer,
  encryptBuffer,
  keyId,
  parseBackupKey,
  runsToKeep,
} from './backup';

describe('backups', () => {
  it('encrypts files so only the same key reads them, and notices any change', () => {
    const key = randomBytes(32);
    const data = Buffer.from('a site photo');
    const sealed = encryptBuffer(data, key);
    expect(sealed.includes(data)).toBe(false);
    expect(decryptBuffer(sealed, key)).toEqual(data);
    expect(() => decryptBuffer(sealed, randomBytes(32))).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[20] ^= 1;
    expect(() => decryptBuffer(tampered, key)).toThrow();
    // No key: stored as is.
    expect(encryptBuffer(data, null)).toBe(data);
  });

  it('takes a 32-byte hex key and identifies it without revealing it', () => {
    expect(parseBackupKey('')).toBeNull();
    expect(() => parseBackupKey('short')).toThrow(/64 hex/);
    const key = parseBackupKey('ab'.repeat(32))!;
    expect(key).toHaveLength(32);
    expect(keyId(key)).toMatch(/^[0-9a-f]{16}$/);
    expect(keyId(key)).not.toContain('abab');
  });

  it('keeps the newest daily runs and one run per month', () => {
    // One run a day from 1 January to 30 April.
    const ids: string[] = [];
    for (
      let d = new Date('2026-01-01');
      d < new Date('2026-05-01');
      d.setUTCDate(d.getUTCDate() + 1)
    )
      ids.push(`${d.toISOString().slice(0, 10)}T02-00-00-000Z`);
    const keep = runsToKeep(ids, 14, 3);
    const kept = [...keep].sort();
    expect(kept).toHaveLength(14 + 2); // April is covered by the dailies; plus March and February
    expect(kept.slice(-14)[0]).toBe('2026-04-17T02-00-00-000Z');
    expect(keep.has('2026-03-31T02-00-00-000Z')).toBe(true);
    expect(keep.has('2026-02-28T02-00-00-000Z')).toBe(true);
    expect(keep.has('2026-01-31T02-00-00-000Z')).toBe(false);
    expect(runsToKeep([], 14, 12).size).toBe(0);
  });
});
