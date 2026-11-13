const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

export const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export const plainText = (html: string) => collapse(decodeEntities(html.replace(/<[^>]*>/g, ' ')));

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > max * 0.6 ? space : max).trimEnd()}…`;
}

export const titleKey = (title: string) =>
  collapse(
    title
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' '),
  );

export type TitleMatch = 'exact' | 'similar' | 'different';

// Short words are mostly prepositions and country codes ("pro", "sk"); numbers stay, a year or an age is distinctive.
const words = (key: string) => new Set(key.split(' ').filter((w) => w.length >= 4 || /^\d+$/.test(w)));

// Both arguments are title keys. "similar" covers sources wording one title differently: a tour name or support act
// added, "&" against "+", a country code after a band. It is only ever trusted together with place and day.
export function compareTitles(a: string, b: string): TitleMatch {
  if (!a || !b) return 'different';
  if (a === b) return 'exact';
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 6 && ` ${long} `.includes(` ${short} `)) return 'similar';
  const wa = words(a);
  const wb = words(b);
  const [fewer, more] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  return fewer.size >= 2 && [...fewer].every((w) => more.has(w)) ? 'similar' : 'different';
}
