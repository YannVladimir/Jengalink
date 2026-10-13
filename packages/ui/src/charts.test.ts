import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claimSentence,
  claimSteps,
  moneySegments,
  moneySentence,
  ringGeometry,
  ringSentence,
  towerLayout,
  towerSentence,
  walletSummary,
} from './charts';

test('ring: big number is accepted only; reported cannot push past 100%', () => {
  const g = ringGeometry({ accepted: 70, reported: 50 }, 100, 10);
  assert.equal(g.acceptedPct, 70);
  assert.equal(g.reportedPct, 30);
  assert.equal(ringSentence({ accepted: 42, reported: 14 }), '42% of the work is accepted. 14% more is reported and waiting for review.');
  assert.equal(ringSentence({ accepted: 100, reported: 0 }), 'All work is accepted.');
});

test('tower stacks the first stage at the bottom', () => {
  const t = towerLayout(
    [
      { id: 'a', name: 'Foundation', status: 'accepted' },
      { id: 'b', name: 'Walls', status: 'in_progress' },
    ],
    300,
    40,
    6,
  );
  assert.equal(t.height, 86);
  assert.equal(t.blocks[0].y, 46);
  assert.equal(t.blocks[1].y, 0);
  assert.equal(towerSentence(t.blocks), '1 of 2 stages accepted · Walls: in progress.');
});

test('money bar totals the contract value and never overflows it', () => {
  const s = moneySegments({ contract: 100, paid: 60, approvedUnpaid: 70 });
  assert.deepEqual(s.map((x) => x.amount), [60, 40, 0]);
  assert.equal(
    moneySentence({ contract: 48_500_000, paid: 18_400_000, approvedUnpaid: 6_200_000 }),
    'RWF 18,400,000 paid of RWF 48,500,000 (38%). RWF 6,200,000 approved and waiting to be paid.',
  );
});

test('claim tracker marks the next open step as current and flags disputes', () => {
  const steps = claimSteps({ requestedAt: '2026-10-01T09:00:00Z', approvedAt: '2026-10-03T09:00:00Z' });
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'current']);
  const disputed = claimSteps({ requestedAt: '2026-10-01T09:00:00Z', disputedStep: 'approved' });
  assert.deepEqual(disputed.map((s) => s.state), ['done', 'disputed', 'upcoming']);
  assert.equal(claimSentence({ requestedAt: '2026-10-01T09:00:00Z', paidAt: '2026-10-05T09:00:00Z' }), 'Paid on 5 Oct.');
});

test('wallet calls a difference "to explain", never "lost"', () => {
  assert.equal(walletSummary({ expected: 420_000, counted: 405_000 }).sentence, 'RWF 15,000 less than expected · to explain.');
  assert.equal(walletSummary({ expected: 1, counted: 1 }).sentence, 'Cash matches the records.');
  assert.ok(!walletSummary({ expected: 5, counted: 1 }).sentence.includes('lost'));
});
