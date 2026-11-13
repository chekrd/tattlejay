import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIcs } from './ics.ts';

const calendar = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e.trim().split('\n'), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test('reads a UTC time into local time, with place, link and folded text', () => {
  const [event] = parseIcs(
    calendar(`
DESCRIPTION:Lednové Pyvo\\, poslední čtvrtek\\n\\nJanuary Pyvo at
  ArtBar
GEO:49.207792;16.603872
LOCATION:ArtBar Druhý Pád\\, Štefánikova 836/1\\, Brno
DTSTART:20270128T180000Z
DTEND:20270128T210000Z
SUMMARY:Brněnské Pyvo - Anotované
UID:brno-pyvo-2027-01-28@pyvo.cz
URL:https://pyvo.cz/brno-pyvo/2027-01/`),
    'Europe/Prague',
  );
  assert.deepEqual(event, {
    uid: 'brno-pyvo-2027-01-28@pyvo.cz',
    summary: 'Brněnské Pyvo - Anotované',
    description: 'Lednové Pyvo, poslední čtvrtek\n\nJanuary Pyvo at ArtBar',
    location: 'ArtBar Druhý Pád, Štefánikova 836/1, Brno',
    url: 'https://pyvo.cz/brno-pyvo/2027-01/',
    lat: 49.207792,
    lon: 16.603872,
    when: { startDate: '2027-01-28', startTime: '19:00', endDate: '2027-01-28', endTime: '22:00' },
    cancelled: false,
    recurring: false,
  });
});

test('takes a zoned time as written and a bare day as a whole day', () => {
  const events = parseIcs(
    calendar(
      `
SUMMARY:rust meetup
DTSTART;TZID=Europe/Prague:20261119T180000
DTEND;TZID=Europe/Prague:20261119T220000
URL;VALUE=URI:https://www.meetup.com/x/events/1/`,
      `
SUMMARY:Hackathon
DTSTART;VALUE=DATE:20261128
DTEND;VALUE=DATE:20261130
STATUS:CANCELLED
RRULE:FREQ=WEEKLY`,
      `
SUMMARY:One day
DTSTART;VALUE=DATE:20261201`,
      `
SUMMARY:No date`,
    ),
    'Europe/Prague',
  );
  assert.deepEqual(
    events.map((e) => [e.summary, e.when, e.url, e.cancelled, e.recurring]),
    [
      ['rust meetup', { startDate: '2026-11-19', startTime: '18:00', endDate: '2026-11-19', endTime: '22:00' }, 'https://www.meetup.com/x/events/1/', false, false],
      ['Hackathon', { startDate: '2026-11-28', startTime: null, endDate: '2026-11-29', endTime: null }, null, true, true],
      ['One day', { startDate: '2026-12-01', startTime: null, endDate: '2026-12-01', endTime: null }, null, false, false],
    ],
  );
});
