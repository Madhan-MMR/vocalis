import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeCalls, toCsv } from '../utils/insights.js';

test('summarizeCalls totals risk bands and averages', () => {
  const summary = summarizeCalls([
    { risk: 0.82, band: 'high', phoneNumber: '+91 90000 0001', createdAt: '2026-01-01T00:00:00Z' },
    { risk: 0.42, band: 'elevated', phoneNumber: '+91 90000 0002', createdAt: '2026-01-01T00:00:00Z' },
    { risk: 0.31, band: 'watch', phoneNumber: '+91 90000 0001', createdAt: '2026-01-01T00:00:00Z' },
    { risk: 0.09, band: 'low', phoneNumber: '+91 90000 0003', createdAt: '2026-01-01T00:00:00Z' },
    { risk: 0.55, band: 'high', phoneNumber: '+91 90000 0004', createdAt: '2026-01-01T00:00:00Z' }
  ]);

  assert.equal(summary.total, 5);
  assert.equal(summary.byBand.high, 2);
  assert.equal(summary.byBand.elevated, 1);
  assert.equal(summary.uniqueNumbers, 4);
  assert.equal(Math.round(summary.averageRisk * 100), 44);
});

test('toCsv exports the record list with headers', () => {
  const csv = toCsv([
    { phoneNumber: '+91 90000 0001', risk: 0.82, band: 'high', headline: 'Cloned voice flagged' },
    { phoneNumber: '+91 90000 0002', risk: 0.42, band: 'elevated', headline: 'Suspicious call' }
  ]);

  assert.ok(csv.startsWith('phoneNumber,risk,band,headline'));
  assert.match(csv, /\+91 90000 0001/);
  assert.match(csv, /Cloned voice flagged/);
});
