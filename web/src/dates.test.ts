import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agoLabel, dayLabel, presetRange, timeLabel } from './dates.ts';

test('preset ranges', () => {
  assert.deepEqual(presetRange('today', '2026-11-13'), { from: '2026-11-13', to: '2026-11-13' });
  assert.deepEqual(presetRange('past', '2026-11-03'), { from: '2026-10-27', to: '2026-11-02' });
  assert.deepEqual(presetRange('week', '2026-11-13'), { from: '2026-11-13', to: '2026-11-19' });
  assert.deepEqual(presetRange('weekend', '2026-11-10'), { from: '2026-11-13', to: '2026-11-15' });
  assert.deepEqual(presetRange('weekend', '2026-11-13'), { from: '2026-11-13', to: '2026-11-15' });
  assert.deepEqual(presetRange('weekend', '2026-11-14'), { from: '2026-11-14', to: '2026-11-15' });
  assert.deepEqual(presetRange('weekend', '2026-11-15'), { from: '2026-11-15', to: '2026-11-15' });
});

test('day labels', () => {
  assert.equal(dayLabel('2026-11-13', '2026-11-13'), 'Today · Fri 13 Nov');
  assert.equal(dayLabel('2026-11-14', '2026-11-13'), 'Tomorrow · Sat 14 Nov');
  assert.equal(dayLabel('2027-01-02', '2026-11-13'), 'Sat 2 Jan 2027');
});

test('time labels', () => {
  assert.equal(timeLabel({ startDate: '2026-11-13', startTime: '19:00', endDate: '2026-11-13', endTime: null }), '19:00');
  assert.equal(timeLabel({ startDate: '2026-11-13', startTime: '19:00', endDate: '2026-11-13', endTime: '21:30' }), '19:00–21:30');
  assert.equal(timeLabel({ startDate: '2026-11-13', startTime: '22:00', endDate: '2026-11-14', endTime: '04:00' }), '22:00');
  assert.equal(timeLabel({ startDate: '2026-11-13', startTime: null, endDate: '2026-11-13', endTime: null }), 'Time not given');
  assert.equal(timeLabel({ startDate: '2026-11-01', startTime: null, endDate: '2027-02-14', endTime: null }), 'until 14 Feb');
});

test('ago labels', () => {
  const at = 1_000_000_000;
  assert.equal(agoLabel(at, at + 20_000), 'just now');
  assert.equal(agoLabel(at, at + 5 * 60_000), '5 min ago');
  assert.equal(agoLabel(at, at + 3 * 3_600_000), '3 h ago');
  assert.equal(agoLabel(at, at + 49 * 3_600_000), '2 days ago');
});
