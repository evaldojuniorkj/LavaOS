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
