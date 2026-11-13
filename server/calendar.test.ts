import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toIcs } from './calendar.ts';
import type { EventView, When } from './contract.ts';

const event = (when: When): EventView => ({
  id: 7,
  title: 'Vypsaná fixa; Ideál tour, 2026',
  category: 'Music',
  venue: 'První patro',
  address: 'Dominikánská 3, Brno',
  priceText: null,
  isFree: null,
  description: null,
  when,
  ongoing: false,
  moreDates: 0,
  sources: [{ source: 'goout', label: 'GoOut', url: 'https://goout.net/cs/x/' }],
  rating: 'save',
  hidden: false,
  score: null,
  reason: null,
});

const NOW = Date.parse('2026-11-13T09:00:00Z');

test('a timed event without an end lasts two hours, across midnight if need be', () => {
  const ics = toIcs(event({ startDate: '2026-11-20', startTime: '23:30', endDate: '2026-11-20', endTime: null }), 'Europe/Prague', NOW);
  assert.deepEqual(ics.split('\r\n'), [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//tattlejay//EN',
    'BEGIN:VEVENT',
    'UID:event-7-20261120@tattlejay',
    'DTSTAMP:20261113T090000Z',
    String.raw`SUMMARY:Vypsaná fixa\; Ideál tour\, 2026`,
    'DTSTART;TZID=Europe/Prague:20261120T233000',
    'DTEND;TZID=Europe/Prague:20261121T013000',
    'LOCATION:První patro\\, Dominikánská 3\\, Brno',
    'URL:https://goout.net/cs/x/',
    'DESCRIPTION:https://goout.net/cs/x/',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]);
});

test('an untimed run is an all-day entry ending the day after its last day', () => {
  const ics = toIcs(event({ startDate: '2026-11-20', startTime: null, endDate: '2026-12-31', endTime: null }), 'Europe/Prague', NOW);
  assert.match(ics, /DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20270101\r\n/);
});

test('a given end time is used', () => {
  const ics = toIcs(event({ startDate: '2026-11-20', startTime: '19:00', endDate: '2026-11-20', endTime: '21:30' }), 'Europe/Prague', NOW);
  assert.match(ics, /DTEND;TZID=Europe\/Prague:20261120T213000/);
});
