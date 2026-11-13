import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCityFeed } from './cityFeed.ts';

const day = (date: string) => Date.parse(`${date}T00:00:00Z`);

const row = (over: Record<string, unknown> = {}) => ({
  ID: 311883,
  name: 'Symposium Brno &#8211; Konference o&nbsp;víně',
  text: '<p>Stovky spokojených&nbsp;škol</p>',
  tickets: 'Dospělí - 200Kč',
  tickets_info: '',
  url: 'https://www.gotobrno.cz/akce/symposium/',
  categories: 'Festivaly, Hudba',
  latitude: 49.195051,
  longitude: 16.608123,
  date_from: day('2026-11-20'),
  date_to: day('2026-11-20'),
  first_image: 'https://www.gotobrno.cz/image.png',
  address: 'nám. Svobody 13, 602 00 Brno',
  ...over,
});

test('turns a row into an item', () => {
  const [item] = parseCityFeed([row()], '2026-11-13');
  assert.deepEqual(item, {
    key: '311883',
    title: 'Symposium Brno – Konference o víně',
    venue: null,
    address: 'nám. Svobody 13, 602 00 Brno',
    lat: 49.195051,
    lon: 16.608123,
    category: 'Music',
    tags: ['Festivaly', 'Hudba'],
    priceText: 'Dospělí 200 Kč',
    isFree: false,
    url: 'https://www.gotobrno.cz/akce/symposium/',
    description: 'Stovky spokojených škol',
    imageUrl: 'https://www.gotobrno.cz/image.png',
    occurrences: [{ startDate: '2026-11-20', startTime: null, endDate: '2026-11-20', endTime: null }],
  });
});

test('skips what ended over a week ago, standing services and broken rows', () => {
  const items = parseCityFeed(
    [
      row({ ID: 1, date_from: day('2026-11-01'), date_to: day('2026-11-05') }),
      row({ ID: 5, date_from: day('2026-11-12'), date_to: day('2026-11-12') }),
      row({ ID: 2, date_from: day('2021-01-01'), date_to: day('2050-12-31') }),
      row({ ID: 3, name: '' }),
      { nonsense: true },
      row({ ID: 4, date_from: day('2026-09-01'), date_to: day('2027-02-14') }),
    ],
    '2026-11-13',
  );
  assert.deepEqual(
    items.map((i) => [i.key, i.occurrences[0]]),
    [
      ['5', { startDate: '2026-11-12', startTime: null, endDate: '2026-11-12', endTime: null }],
      ['4', { startDate: '2026-09-01', startTime: null, endDate: '2027-02-14', endTime: null }],
    ],
  );
});

test('reads prices', () => {
  const price = (tickets: string | null, info = '') => {
    const [item] = parseCityFeed([row({ tickets, tickets_info: info })], '2026-11-13');
    return [item?.priceText, item?.isFree];
  };
  assert.deepEqual(price('Zdarma - '), ['Zdarma', true]);
  assert.deepEqual(price('Dobrovolné - '), ['Dobrovolné', true]);
  assert.deepEqual(price('Dospělí - ', 'Vstupné od 540&nbsp;Kč.'), ['Vstupné od 540 Kč.', null]);
  assert.deepEqual(price('', 'VSTUP ZDARMA'), ['VSTUP ZDARMA', true]);
  assert.deepEqual(price(null), [null, null]);
});

test('picks one category by priority', () => {
  const category = (categories: string) => parseCityFeed([row({ categories })], '2026-11-13')[0]?.category;
  assert.equal(category('Divadlo, Pro rodiny'), 'Family and kids');
  assert.equal(category('Veletrhy / vzdělávací, Výstava'), 'Exhibitions');
  assert.equal(category('TOP akce'), 'Other');
  assert.equal(category(''), 'Other');
});
