import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTitles, decodeEntities, plainText, titleKey, truncate } from './text.ts';

test('decodes the entities the city feed uses', () => {
  assert.equal(decodeEntities('Symposium Brno &#8211; Konference o&nbsp;víně &amp; jídle'), 'Symposium Brno – Konference o víně & jídle');
  assert.equal(decodeEntities('&#x159;eka &unknown; &#0;'), 'řeka &unknown; &#0;');
});

test('plain text drops tags and collapses whitespace', () => {
  assert.equal(plainText('<p>Stovky  škol,</p>\n<b>tisíce&nbsp;dětí</b>'), 'Stovky škol, tisíce dětí');
});

test('truncates at a word', () => {
  assert.equal(truncate('one two three four', 15), 'one two three…');
  assert.equal(truncate('unbreakablestring', 5), 'unbre…');
  assert.equal(truncate('short', 13), 'short');
});

test('title keys ignore case, diacritics and punctuation', () => {
  assert.equal(titleKey('  Vypsaná fiXa: Ideál tour 2026! '), 'vypsana fixa ideal tour 2026');
});

test('compares titles', () => {
  const key = (s: string) => titleKey(s);
  assert.equal(compareTitles(key('Malý princ'), key('MALÝ PRINC')), 'exact');
  assert.equal(compareTitles(key('Vypsaná fixa'), key('Vypsaná fixa: Ideál tour 2026')), 'similar');
  assert.equal(compareTitles(key('Brněnské Vánoce 2026 na náměstí'), key('Brněnské Vánoce na náměstí Svobody 2026')), 'similar');
  assert.equal(compareTitles(key('Metastavy + support: DOHOR'), key('Metastavy x Dohor')), 'similar');
  assert.equal(compareTitles(key('Macocha (křest alba) + Adacta + Märnø'), key('Macocha (křest) + Adacta (SK) + Märno')), 'different');
  assert.equal(compareTitles(key('Richard Autner & Band'), key('Richard Autner (SK)')), 'similar');
  assert.equal(compareTitles(key('Koncert pro klavír'), key('Koncert pro housle')), 'different');
  assert.equal(compareTitles(key('Jazz Night: Trio Alfa'), key('Jazz Night: Trio Beta')), 'different');
  assert.equal(compareTitles(key('Malý princ'), key('Malý Bobeš')), 'different');
  assert.equal(compareTitles(key('Jazz'), key('Jazz night with friends')), 'different');
  assert.equal(compareTitles('', ''), 'different');
});
