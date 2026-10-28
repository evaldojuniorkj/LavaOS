import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth/server';

export const runtime = 'nodejs';

// Só GET/POST: os demais métodos nem chegam ao Better Auth (405 do Next).
export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
