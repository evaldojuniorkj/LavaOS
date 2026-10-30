import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

// Só redirecionamento otimista de quem nem tem cookie, guardando o retorno; a autorização real é no servidor (layout/página/action).
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const login = new URL('/login', request.url);
  login.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = { matcher: ['/inicio', '/fila', '/nova-os', '/configuracoes/:path*'] };
