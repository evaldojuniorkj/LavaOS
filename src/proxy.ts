import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import { ipDoCliente } from '@/lib/auth/ip';
import { limitar, respostaLimitada } from '@/lib/rate-limit';

const JANELA_MS = 60_000;
const PAGINA_POR_JANELA = 30; // por IP, contando os refresh do tempo real
// o token na URL não pode vazar por Referer nem cair em buscador
const PUBLICO = { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };

export function proxy(request: NextRequest) {
  // link público: sem login, só rate limit (o SSE público limita na própria rota)
  if (request.nextUrl.pathname.startsWith('/acompanhar/')) {
    const res = limitar(`pagina:${ipDoCliente(request.headers)}`, PAGINA_POR_JANELA, JANELA_MS) ? NextResponse.next() : respostaLimitada(JANELA_MS);
    for (const [k, v] of Object.entries(PUBLICO)) res.headers.set(k, v);
    return res;
  }
  // Só redirecionamento otimista de quem nem tem cookie, guardando o retorno; a autorização real é no servidor (layout/página/action).
  if (getSessionCookie(request)) return NextResponse.next();
  const login = new URL('/login', request.url);
  login.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

// /primeiro-acesso fica de fora de propósito: é público (ver route-policy.ts)
export const config = { matcher: ['/inicio', '/painel', '/fila', '/caixa', '/lavador/:path*', '/nova-os', '/clientes', '/configuracoes/:path*', '/acompanhar/:path*'] };
