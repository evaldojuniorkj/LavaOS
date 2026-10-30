/**
 * Aceitação adversarial da Fundação por HTTP real contra o servidor de produção sob teste.
 * As actions são as reais da equipe: o corpo enviado pela UI é adulterado (page.route) ou reenviado
 * com o cookie de outro perfil. Toda negação confere também que nada mudou no banco.
 */
import { expect, test, type APIRequestContext, type Browser, type Page, type Request } from '@playwright/test';
import pg from 'pg';
import { testUrls } from '../helpers/test-db';
import { E2E_PILOT_SLUG } from './global-setup';
import { entrarLavador, entrarStaff, pin, senha, SUFIXO } from './login';

const pool = new pg.Pool({ connectionString: testUrls.owner, max: 1 });
test.afterAll(() => pool.end());
const um = async <T = Record<string, string>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T;

/** Tudo o que pertence ao tenant B (inclusive sessões dos usuários dele), serializado para comparar antes/depois. */
const estadoB = async () =>
  JSON.stringify(
    await um(
      `select (select row_to_json(t) from lava_jatos t where slug = $1) as tenant,
        (select json_agg(m order by m.id) from membros m join lava_jatos t on t.id = m.tenant_id where t.slug = $1) as membros,
        (select json_agg(c order by c.id) from credenciais_lavador c join lava_jatos t on t.id = c.tenant_id where t.slug = $1) as credenciais,
        (select json_agg(s order by s.id) from session s join membros m on m.user_id = s.user_id join lava_jatos t on t.id = m.tenant_id where t.slug = $1) as sessoes,
        (select count(*) from convites) as convites`,
      [`${E2E_PILOT_SLUG}-b`],
    ),
  );
const contagens = async () =>
  JSON.stringify(await um('select (select count(*) from "user") u, (select count(*) from lava_jatos) t, (select count(*) from membros) m, (select count(*) from convites) c'));
const membroB = (perfil: string) =>
  um<{ id: string }>(`select m.id from membros m join lava_jatos t on t.id = m.tenant_id where t.slug = $1 and m.perfil = $2`, [`${E2E_PILOT_SLUG}-b`, perfil]);
const membroPorNome = (nome: string) => um<{ id: string; ativo: boolean }>('select id, ativo from membros where nome_exibicao = $1', [nome]);

/** Opções do projeto atual (viewport, dispositivo, x-real-ip) para contextos extras. */
function opcoesProjeto(): Record<string, unknown> {
  const opcoes: Record<string, unknown> = { ...test.info().project.use };
  delete opcoes.defaultBrowserType;
  return opcoes;
}
const novoContexto = async (browser: Browser) => (await browser.newContext(opcoesProjeto())).newPage();

const linha = (page: Page, nome: string) => page.getByRole('listitem').filter({ hasText: nome });

async function cadastrarLavador(page: Page, nome: string, usuario: string, p: string) {
  const form = page.getByRole('form', { name: 'Novo membro' });
  await form.getByLabel('Perfil').selectOption({ label: 'Lavador' });
  await form.getByLabel('Nome de exibição').fill(nome);
  await form.getByLabel('Usuário', { exact: true }).fill(usuario);
  await form.getByLabel('PIN', { exact: true }).fill(p);
  await form.getByRole('button', { name: 'Cadastrar membro' }).click();
  await expect(linha(page, nome)).toBeVisible();
}

type Capturada = { headers: Record<string, string>; args: unknown[] };

/** Intercepta a próxima chamada de server action da página e reescreve os argumentos antes de chegar ao servidor. */
async function adulterarAction(page: Page, trocar: (args: unknown[]) => unknown[]): Promise<() => Capturada> {
  let capturada: Capturada | undefined;
  await page.route('**/configuracoes/equipe', async (route, req: Request) => {
    const headers = await req.allHeaders();
    // só a primeira action; depois cede a vez para as próximas interceptações (fallback)
    if (capturada || req.method() !== 'POST' || !headers['next-action']) return route.fallback();
    const args = trocar(JSON.parse(req.postData()!) as unknown[]);
    capturada = { headers, args };
    await route.continue({ postData: JSON.stringify(args) });
  });
  return () => {
    if (!capturada) throw new Error('nenhuma action interceptada');
    return capturada;
  };
}

/** Reenvia a action capturada com os cookies de `req` (não os da captura) e outros argumentos. */
async function reenviar(req: APIRequestContext, c: Capturada, args: unknown[]) {
  const headers = Object.fromEntries(Object.entries(c.headers).filter(([k]) => k !== 'cookie' && k !== 'content-length'));
  const r = await req.post('/configuracoes/equipe', { headers, data: JSON.stringify(args), maxRedirects: 0 });
  return { status: r.status(), body: await r.text() };
}

async function abrirEquipeComoDono(page: Page) {
  await entrarStaff(page, 'dono@e2e.test', senha(), '/login?next=%2Fconfiguracoes%2Fequipe');
  await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
}

test('dono de A com alvo de B: desativar, redefinir PIN e criar com tenant alheio são negados e B fica intacto', async ({ page }) => {
  await abrirEquipeComoDono(page);
  const s = SUFIXO();
  const nome = `Isca ${s}`;
  await cadastrarLavador(page, nome, `isca.${s}`, '0444');
  const lavB = await membroB('lavador');
  const gerB = await membroB('gerente');
  const antes = await estadoB();

  // redefinir PIN: a UI pede para a isca de A, o corpo chega com o lavador de B
  let cap = await adulterarAction(page, ([a]) => [{ ...(a as object), memberId: lavB.id }]);
  await linha(page, nome).getByRole('button', { name: 'Redefinir PIN' }).click();
  await linha(page, nome).getByLabel('Novo PIN').fill('0555');
  await linha(page, nome).getByRole('button', { name: 'Salvar PIN' }).click();
  await expect(linha(page, nome).getByRole('alert')).toHaveText('Membro não encontrado.');
  expect(cap().args).toEqual([{ memberId: lavB.id, pin: '0555' }]);
  await linha(page, nome).getByRole('button', { name: 'Cancelar' }).click();

  // desativar: alvo trocado pelo gerente de B
  cap = await adulterarAction(page, () => [{ memberId: gerB.id }]);
  await linha(page, nome).getByRole('button', { name: 'Desativar' }).click();
  await linha(page, nome).getByRole('button', { name: 'Confirmar desativação' }).click();
  await expect(linha(page, nome).getByRole('alert')).toHaveText('Membro não encontrado.');
  const desativar = cap();
  expect(desativar.args).toEqual([{ memberId: gerB.id }]);
  await linha(page, nome).getByRole('button', { name: 'Cancelar' }).click();

  // reenvio direto (sem UI) para cada alvo de B e um id inexistente
  for (const memberId of [lavB.id, gerB.id, crypto.randomUUID()]) {
    const r = await reenviar(page.request, desativar, [{ memberId }]);
    expect(r.body).toContain('NAO_ENCONTRADO');
  }

  // criação com tenant alheio no corpo: schema estrito recusa, nada é criado em lugar nenhum
  const tenantB = await um<{ id: string }>('select id from lava_jatos where slug = $1', [`${E2E_PILOT_SLUG}-b`]);
  const nomeNovo = `Intruso ${s}`;
  cap = await adulterarAction(page, ([a]) => [{ ...(a as object), tenantId: tenantB.id }]);
  const form = page.getByRole('form', { name: 'Novo membro' });
  await form.getByLabel('Perfil').selectOption({ label: 'Lavador' });
  await form.getByLabel('Nome de exibição').fill(nomeNovo);
  await form.getByLabel('Usuário', { exact: true }).fill(`intruso.${s}`);
  await form.getByLabel('PIN', { exact: true }).fill('0666');
  await form.getByRole('button', { name: 'Cadastrar membro' }).click();
  await expect(form.getByRole('alert')).toHaveText('Revise os campos destacados.');
  expect(cap().args[0]).toMatchObject({ tenantId: tenantB.id });
  expect(await membroPorNome(nomeNovo)).toBeUndefined();

  expect(await estadoB()).toBe(antes);
  expect((await membroPorNome(nome)).ativo).toBe(true); // a isca de A também não foi tocada
});

test('lavador e recepção reenviando as actions reais do dono recebem acesso negado, sem escrita', async ({ page, browser }) => {
  await abrirEquipeComoDono(page);
  const s = SUFIXO();
  // captura a action de criação com PIN inválido: o servidor recusa por validação, nada é gravado
  const cap = await adulterarAction(page, (a) => a);
  const form = page.getByRole('form', { name: 'Novo membro' });
  await form.getByLabel('Perfil').selectOption({ label: 'Lavador' });
  await form.getByLabel('Nome de exibição').fill(`Captura ${s}`);
  await form.getByLabel('Usuário', { exact: true }).fill(`captura.${s}`);
  await form.getByLabel('PIN', { exact: true }).fill('12');
  await form.getByRole('button', { name: 'Cadastrar membro' }).click();
  await expect(page.getByText('O PIN deve ter de 4 a 6 dígitos.')).toBeVisible();
  const criar = cap();
  const alvoA = await membroPorNome('Lavador E2E');

  const lav = await novoContexto(browser);
  await entrarLavador(lav, 'lavador.e2e', pin());
  await expect(lav).toHaveURL('/lavador');
  const rec = await novoContexto(browser);
  await entrarStaff(rec, 'recepcao@e2e.test');
  await expect(rec).toHaveURL('/fila');

  const antes = await contagens();
  for (const quem of [lav, rec]) {
    // rota de staff por navegação: nada da equipe é renderizado
    await quem.goto('/configuracoes/equipe');
    if (quem === lav) await expect(quem).toHaveURL('/lavador'); // o lavador é mandado ao app dele
    else await expect(quem.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
    await expect(quem.getByText('Dono E2E')).toHaveCount(0);
    for (const perfil of ['dono', 'gerente', 'lavador']) {
      const r = await reenviar(quem.request, criar, [{ perfil, nomeExibicao: `Promovido ${s}`, ...(perfil === 'lavador' ? { usuario: `promo.${s}`, pin: '1234' } : { email: `promo.${s}@e2e.test`, senha: 'senha-forte-123' }) }]);
      expect(r.body).toContain('ACESSO_NEGADO');
    }
  }
  expect(await contagens()).toBe(antes);
  expect(await membroPorNome(`Promovido ${s}`)).toBeUndefined();
  expect((await membroPorNome('Lavador E2E')).ativo).toBe(alvoA.ativo);
  await lav.context().close();
  await rec.context().close();
});

test('cadastro público e rotas nativas de organização respondem 404 por HTTP, anônimo ou dono, sem escrita', async ({ page }) => {
  await abrirEquipeComoDono(page);
  const tenantB = await um<{ id: string }>('select id from lava_jatos where slug = $1', [`${E2E_PILOT_SLUG}-b`]);
  const dono = await um<{ user_id: string }>(`select user_id from membros where nome_exibicao = 'Dono E2E'`);
  const s = SUFIXO();
  const tentativas: [string, unknown][] = [
    ['/api/auth/sign-up/email', { email: `novo.${s}@e2e.test`, password: 'senha-forte-123', name: 'Novo' }],
    ['/api/auth/organization/create', { name: 'Paralelo', slug: `paralelo-${s}` }],
    ['/api/auth/organization/add-member', { userId: dono.user_id, organizationId: tenantB.id, role: 'dono' }],
    ['/api/auth/organization/update-member-role', { memberId: crypto.randomUUID(), role: 'dono', organizationId: tenantB.id }],
    ['/api/auth/organization/invite-member', { email: `conv.${s}@e2e.test`, role: 'dono', organizationId: tenantB.id }],
    ['/api/auth/organization/accept-invitation', { invitationId: crypto.randomUUID() }],
    ['/api/auth/organization/delete', { organizationId: tenantB.id }],
    ['/api/auth/change-password', { currentPassword: senha(), newPassword: 'outra-senha-123' }],
  ];
  const antes = await contagens();
  const antesB = await estadoB();
  const anonimo = await page.context().browser()!.newContext(opcoesProjeto());
  for (const [path, data] of tentativas) {
    for (const req of [page.request, anonimo.request]) {
      const r = await req.post(path, { data, headers: { origin: test.info().project.use.baseURL! } });
      expect(r.status(), path).toBe(404);
    }
  }
  expect((await anonimo.request.get(`/api/auth/sign-up/email`)).status()).toBe(404);
  await anonimo.close();
  expect(await contagens()).toBe(antes);
  expect(await estadoB()).toBe(antesB);
  // a senha do dono continua a mesma
  await page.getByRole('button', { name: 'Sair' }).click();
  await entrarStaff(page, 'dono@e2e.test');
  await expect(page).toHaveURL('/fila');
});

test('cookie antigo após desativação ou reset de PIN perde get-session, páginas e actions', async ({ page, browser, playwright }) => {
  await abrirEquipeComoDono(page);
  const s = SUFIXO();
  const senhaG = `senha-${crypto.randomUUID()}`;
  const form = page.getByRole('form', { name: 'Novo membro' });
  await form.getByLabel('Perfil').selectOption({ label: 'Gerente' });
  await form.getByLabel('Nome de exibição').fill(`Velho ${s}`);
  await form.getByLabel('E-mail', { exact: true }).fill(`velho.${s}@e2e.test`);
  await form.getByLabel('Senha', { exact: true }).fill(senhaG);
  await form.getByRole('button', { name: 'Cadastrar membro' }).click();
  await expect(linha(page, `Velho ${s}`)).toBeVisible();
  await cadastrarLavador(page, `Antigo ${s}`, `antigo.${s}`, '0777');

  // gerente entra e tem uma action real capturada (validação, sem escrita) com o próprio cookie
  const ger = await novoContexto(browser);
  await entrarStaff(ger, `velho.${s}@e2e.test`, senhaG, '/login?next=%2Fconfiguracoes%2Fequipe');
  await expect(ger.getByRole('heading', { name: 'Equipe' })).toBeVisible();
  const cap = await adulterarAction(ger, (a) => a);
  await ger.getByRole('form', { name: 'Novo membro' }).getByRole('button', { name: 'Cadastrar membro' }).click();
  await expect(ger.getByRole('form', { name: 'Novo membro' }).getByRole('alert')).toHaveText('Revise os campos destacados.');
  const criar = cap();
  const lav = await novoContexto(browser);
  await entrarLavador(lav, `antigo.${s}`, '0777');
  await expect(lav).toHaveURL('/lavador');
  // o cookie salvo antes da revogação vai fixo em todo pedido: o servidor apagar o cookie não muda o teste
  const { baseURL, extraHTTPHeaders } = test.info().project.use;
  const velhos: APIRequestContext[] = [];
  for (const ctx of [ger.context(), lav.context()]) {
    const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const velho = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { ...extraHTTPHeaders, cookie } });
    expect(await (await velho.get('/api/auth/get-session')).json()).toHaveProperty('session'); // controle: o cookie vale antes
    velhos.push(velho);
  }
  // controle: com o cookie ainda válido, o reenvio chega à action e cai na validação (não em acesso negado)
  expect((await reenviar(velhos[0], criar, [{}])).body).toContain('VALIDACAO');

  await linha(page, `Velho ${s}`).getByRole('button', { name: 'Desativar' }).click();
  await linha(page, `Velho ${s}`).getByRole('button', { name: 'Confirmar desativação' }).click();
  await expect(linha(page, `Velho ${s}`)).toContainText('Inativo');
  await linha(page, `Antigo ${s}`).getByRole('button', { name: 'Redefinir PIN' }).click();
  await linha(page, `Antigo ${s}`).getByLabel('Novo PIN').fill('0888');
  await linha(page, `Antigo ${s}`).getByRole('button', { name: 'Salvar PIN' }).click();
  await expect(page.getByRole('status')).toContainText('PIN redefinido.');

  const antes = await contagens();
  for (const velho of velhos) {
    const r = await reenviar(velho, criar, [{ perfil: 'lavador', nomeExibicao: `Fantasma ${s}`, usuario: `fantasma.${s}`, pin: '1234' }]);
    expect(r.body).toContain('ACESSO_NEGADO');
    expect(await (await velho.get('/api/auth/get-session')).text()).toBe('null');
    for (const rota of ['/inicio', '/configuracoes/equipe']) {
      const res = await velho.get(rota, { maxRedirects: 0 });
      expect([307, 308], rota).toContain(res.status());
      expect(res.headers().location, rota).toMatch(/^\/login\?motivo=sessao/);
    }
    await velho.dispose();
  }
  expect(await contagens()).toBe(antes);
  expect(await membroPorNome(`Fantasma ${s}`)).toBeUndefined();
  await ger.context().close();
  await lav.context().close();
});
