import { USER_AGENT } from '../config.ts';

async function get(fetcher: typeof fetch, url: string, accept: string): Promise<Response> {
  // Without a stated language some sites answer in English; titles should stay as the venue wrote them.
  const res = await fetcher(url, { headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'cs' } });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res;
}

export const getText = async (fetcher: typeof fetch, url: string) => (await get(fetcher, url, 'text/html, text/calendar, application/xml, */*')).text();

export const getJson = async (fetcher: typeof fetch, url: string): Promise<unknown> => (await get(fetcher, url, 'application/json')).json();
