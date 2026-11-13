const BLOCK = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const isEvent = (type: unknown) => (Array.isArray(type) ? type : [type]).some((t) => typeof t === 'string' && t.endsWith('Event'));

// Every schema.org event a page embeds, however deeply it nests them (inside @graph, an ItemList, another event).
export function embeddedEvents(html: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
    } else if (node && typeof node === 'object') {
      const object = node as Record<string, unknown>;
      if (isEvent(object['@type'])) events.push(object);
      for (const child of Object.values(object)) if (child && typeof child === 'object') visit(child);
    }
  };
  for (const match of html.matchAll(BLOCK)) {
    try {
      visit(JSON.parse(match[1] ?? ''));
    } catch {
      continue;
    }
  }
  return events;
}

export const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
