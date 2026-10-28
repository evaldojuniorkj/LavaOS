import { GET, POST } from '@/app/api/auth/[...all]/route';
import { getAuth } from '@/lib/auth/server';

export const ORIGIN = 'http://localhost:3000';

type Options = { body?: unknown; origin?: string | null; cookie?: string; headers?: Record<string, string> };

/**
 * Cliente HTTP do teste: chama o route handler do Next (GET/POST) ou o handler Better Auth direto (demais métodos).
 * Com `handler`, usa outra instância auth (ex.: `createAuth({ now })`) para todos os métodos.
 */
export function createHttp(handler?: (req: Request) => Promise<Response>) {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  async function call(method: string, path: string, opts: Options = {}): Promise<Response> {
    const headers = new Headers(opts.headers);
    if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN);
    if (opts.body !== undefined) headers.set('content-type', 'application/json');
    const c = opts.cookie ?? cookie();
    if (c) headers.set('cookie', c);
    const req = new Request(`${ORIGIN}/api/auth${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const res = await (handler ? handler(req) : method === 'GET' ? GET(req) : method === 'POST' ? POST(req) : getAuth().handler(req));
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';');
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      if (!value || attrs.some((a) => /^\s*max-age=0$/i.test(a))) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  }

  return {
    call,
    get: (path: string, opts?: Options) => call('GET', path, opts),
    post: (path: string, body?: unknown, opts?: Options) => call('POST', path, { ...opts, body: body ?? {} }),
    /** Cookie atual do jar, para reenviar como "cookie velho". */
    cookie,
    headers: () => new Headers({ cookie: cookie() }),
  };
}
