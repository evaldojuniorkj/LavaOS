/**
 * Whitelist HTTP de `/api/auth/*` na Fundação (path relativo ao basePath, comparado exatamente).
 * Todo o resto — cadastro, convites, mutações de membro/organização, troca/reset de senha — responde 404.
 */
const PERMITIDOS: ReadonlySet<string> = new Set([
  'POST /sign-in/email',
  'POST /sign-out',
  'GET /get-session',
  'POST /lavador-pin/sign-in', // endpoint entra na tarefa 5
  // org: o hook em server.ts confere vínculo ativo antes de listar/selecionar
  'GET /organization/list',
  'POST /organization/set-active',
]);

export function isAuthHttpPathAllowed(method: string, path: string): boolean {
  return PERMITIDOS.has(`${method.toUpperCase()} ${path}`);
}

/**
 * Páginas públicas fora do matcher do proxy: /login, /acompanhar/* (só rate limit no proxy) e /primeiro-acesso.
 * /primeiro-acesso não é rota de /api/auth: a action dele autoriza pelo código de instalação (LAVAOS_SETUP_TOKEN)
 * + sistema sem lava jato, não por requirePermission; sem o token a página responde 404 e a action recusa.
 */

/** Telas internas existentes; o retorno pós-login só aceita uma delas, por igualdade exata. */
export const ROTAS_INTERNAS: readonly string[] = ['/inicio', '/painel', '/fila', '/nova-os', '/caixa', '/despesas', '/clientes', '/configuracoes/equipe', '/configuracoes/catalogo', '/lavador', '/lavador/nova'];

export function destinoPosLogin(next: unknown): string {
  return typeof next === 'string' && ROTAS_INTERNAS.includes(next) ? next : '/inicio';
}
