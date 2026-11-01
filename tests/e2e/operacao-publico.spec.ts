import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { testUrls } from '../helpers/test-db';
import { E2E_PILOT_SLUG } from './global-setup';
import { entrarStaff, semRolagemHorizontal } from './login';

const pool = new pg.Pool({ connectionString: testUrls.owner, max: 1 });
test.afterAll(() => pool.end());
const um = async <T = Record<string, string>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T;

const ipAleatorio = () => `10.7.${randomInt(256)}.${randomInt(256)}`;
const tokenAleatorio = () => randomBytes(32).toString('base64url');

/** Visitante sem login, com IP próprio (cota de rate limit só dele). */
async function visitante(browser: Browser): Promise<Page> {
  const opcoes: Record<string, unknown> = { ...test.info().project.use, extraHTTPHeaders: { 'x-real-ip': ipAleatorio() } };
  delete opcoes.defaultBrowserType;
  return (await browser.newContext(opcoes)).newPage();
}

/** OS inserida direto no estado desejado (veículo da fixture); o contador acompanha para não colidir com a Nova OS. */
async function inserirOs(status: 'entregue' | 'cancelada', ha: number, totalCentavos = 0) {
  const t = await um<{ id: string }>('select id from lava_jatos where slug = $1', [E2E_PILOT_SLUG]);
  const { ultimo } = await um<{ ultimo: number }>(
    'insert into os_contadores (tenant_id, ultimo) values ($1, 1) on conflict (tenant_id) do update set ultimo = os_contadores.ultimo + 1 returning ultimo',
    [t.id],
  );
  const token = tokenAleatorio();
  const quando = new Date(Date.now() - ha);
  const os = await um<{ id: string }>(
    `insert into ordens_servico (tenant_id, numero, veiculo_id, aberta_por, status, token_publico, entregue_em, cancelada_em, motivo_cancelamento, total_centavos)
     values ($1, $2, (select id from veiculos where tenant_id = $1 and placa = 'EXP1A23'), (select id from membros where tenant_id = $1 and nome_exibicao = 'Recepcao E2E'), $3, $4, $5, $6, $7, $8) returning id`,
    [t.id, ultimo, status, token, status === 'entregue' ? quando : null, status === 'cancelada' ? quando : null, status === 'cancelada' ? 'teste' : null, totalCentavos],
  );
  return { token, tenantId: t.id, osId: os.id };
}

const DIA = 24 * 60 * 60 * 1000;
/** Corpo HTML com o próprio token trocado por um marcador (o token está na URL e, por isso, no payload do roteador). */
const corpoGenerico = async (page: Page, token: string) => {
  const r = await page.request.get(`/acompanhar/${token}`);
  expect(r.status()).toBe(200);
  return (await r.text()).replaceAll(token, 'TOKEN');
};

function placaNova() {
  const l = () => 'ABCDEFGHJKLMNPRTUVWXYZ'[Math.floor(Math.random() * 22)];
  const d = () => String(Math.floor(Math.random() * 10));
  return `${l()}${l()}${l()}${d()}${l()}${d()}${d()}`;
}
const cartao = (page: Page, placa: string) => page.getByRole('article').filter({ hasText: placa });

test('a página pública mostra o status e atualiza sem recarregar; fechar derruba a assinatura', async ({ page, browser, request }) => {
  await entrarStaff(page, 'recepcao@e2e.test');
  await expect(page).toHaveURL('/fila');
  const placa = placaNova();
  await page.goto('/nova-os');
  await page.getByLabel('Placa', { exact: true }).fill(placa);
  await page.getByRole('button', { name: 'Buscar placa' }).click();
  await page.getByLabel('Porte', { exact: true }).selectOption({ label: 'Pequeno' });
  await page.getByRole('checkbox', { name: /Lavagem completa/ }).check();
  await page.getByLabel('Modelo').fill('Onix Público');
  await page.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(cartao(page, placa)).toBeVisible();
  const { token_publico: token } = await um('select o.token_publico from ordens_servico o join veiculos v on v.id = o.veiculo_id where v.placa = $1', [placa]);

  const assinantes = async () => (await (await request.get('/api/teste/assinantes')).json()).assinantes as number;
  await expect.poll(assinantes, { timeout: 10_000 }).toBeGreaterThanOrEqual(1); // a fila da recepção
  const base = await assinantes();
  const pub = await visitante(browser);
  await pub.goto(`/acompanhar/${token}`);
  await expect(pub.getByText('Lava Jato E2E', { exact: true })).toBeVisible();
  await expect(pub.getByText(placa)).toBeVisible();
  await expect(pub.getByText('Onix Público')).toBeVisible();
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Na fila para lavar');
  await expect(pub.getByText('Lavagem completa')).toBeVisible();
  await expect(pub.getByText('R$ 50,00').first()).toBeVisible();
  await expect.poll(assinantes, { timeout: 10_000 }).toBe(base + 1);
  await semRolagemHorizontal(pub);
  await pub.evaluate(() => ((window as { marca?: number }).marca = 1));

  await cartao(page, placa).getByRole('button', { name: 'Iniciar lavagem' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Lavador E2E/ }).click();
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Em lavagem agora');
  await expect(pub.locator('[aria-current="step"]')).toContainText('Em lavagem');
  expect(await pub.evaluate(() => (window as { marca?: number }).marca)).toBe(1); // sem recarregar
  const texto = await pub.locator('body').innerText();
  for (const proibido of ['Lavador E2E', 'Recepcao E2E', 'Cliente', '988887777']) expect(texto, proibido).not.toContain(proibido);

  await pub.context().close();
  await expect.poll(assinantes, { timeout: 10_000 }).toBe(base);
  await cartao(page, placa).getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('limpeza do teste');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(cartao(page, placa)).toHaveCount(0);
});

test('token inválido, truncado, inexistente ou expirado: a mesma página genérica, com no-referrer e noindex', async ({ browser }) => {
  const pub = await visitante(browser);
  const valida = await inserirOs('entregue', 6 * DIA);
  const entregue8 = await inserirOs('entregue', 8 * DIA);
  const cancelada8 = await inserirOs('cancelada', 8 * DIA);
  const tokens = [tokenAleatorio(), valida.token.slice(0, -1), `${valida.token}A`, 'abc', entregue8.token, cancelada8.token];
  const corpos = await Promise.all(tokens.map((t) => corpoGenerico(pub, t)));
  expect(new Set(corpos).size).toBe(1);
  expect(corpos[0]).toContain('Link indisponível ou expirado');
  expect(corpos[0]).not.toContain('EXP1A23');

  for (const token of [valida.token, tokens[0]]) {
    const r = await pub.request.get(`/acompanhar/${token}`);
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
    expect(r.headers()['x-robots-tag']).toBe('noindex');
    expect(r.headers()['cache-control']).toContain('no-store');
    const html = await r.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(html).toContain('<meta name="referrer" content="no-referrer"/>');
  }
  await pub.goto(`/acompanhar/${valida.token}`); // entregue há 6 dias: ainda visível
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Entregue');
  await expect(pub.getByText('EXP1A23')).toBeVisible();
  await pub.goto(`/acompanhar/${cancelada8.token}`);
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Link indisponível ou expirado');
  await pub.context().close();
});

test('rate limit: a 31ª requisição do mesmo IP no minuto recebe 429 genérico', async ({ request }) => {
  const ip = ipAleatorio();
  const token = tokenAleatorio();
  for (let i = 0; i < 30; i++) expect((await request.get(`/acompanhar/${token}`, { headers: { 'x-real-ip': ip } })).status()).toBe(200);
  const r = await request.get(`/acompanhar/${token}`, { headers: { 'x-real-ip': ip } });
  expect(r.status()).toBe(429);
  expect(r.headers()['retry-after']).toBe('60');
  expect(await r.text()).toBe('Muitas requisições. Aguarde um minuto e tente de novo.');
  expect((await request.get(`/acompanhar/${token}`, { headers: { 'x-real-ip': ipAleatorio() } })).status()).toBe(200); // outro IP segue
});

test('SSE com token inválido ou expirado recebe a mesma resposta genérica, sem stream', async ({ request }) => {
  const expirada = await inserirOs('cancelada', 8 * DIA);
  const corpos = new Set<string>();
  for (const token of [tokenAleatorio(), 'abc', expirada.token]) {
    const r = await request.get(`/api/acompanhar/${token}/eventos`, { headers: { 'x-real-ip': ipAleatorio() } });
    corpos.add(`${r.status()} ${r.headers()['content-type']} ${await r.text()}`);
  }
  expect([...corpos]).toEqual(['404 application/json {"ok":false,"message":"Link indisponível ou expirado"}']);
});

test('SSE do token A nunca entrega eventos de outra OS', async ({ browser }) => {
  const a = await inserirOs('entregue', DIA);
  const pub = await visitante(browser);
  await pub.goto(`/acompanhar/${a.token}`);
  await pub.evaluate(
    (url) =>
      new Promise<void>((pronto) => {
        const w = window as unknown as { recebidos: string[] };
        w.recebidos = [];
        const es = new EventSource(url);
        es.addEventListener('ready', () => pronto());
        es.addEventListener('message', (e) => w.recebidos.push(e.data));
      }),
    `/api/acompanhar/${a.token}/eventos`,
  );
  const notificar = (tenantId: string, osId: string, tipo: string) => pool.query(`select pg_notify('lavaos_eventos', $1)`, [JSON.stringify({ tenantId, osId, tipo })]);
  await notificar(a.tenantId, randomUUID(), 'itens'); // outra OS do mesmo lava jato
  await notificar(randomUUID(), a.osId, 'itens'); // mesmo id em outro tenant
  await notificar(a.tenantId, a.osId, 'valor');
  await expect.poll(() => pub.evaluate(() => (window as unknown as { recebidos: string[] }).recebidos)).toEqual(['{"tipo":"valor"}']);
  await pub.context().close();
});

test('desconto ou acréscimo aparece numa linha só entre os serviços e o total; sem ajuste, nenhuma linha', async ({ browser }) => {
  const pub = await visitante(browser);
  for (const [total, linha] of [
    [6000, /Desconto\s*−R\$ 10,00/],
    [8500, /Acréscimo\s*\+R\$ 15,00/],
    [7000, null],
  ] as const) {
    const os = await inserirOs('entregue', DIA, total);
    for (const [nome, valor] of [['Lavagem completa', 5000], ['Cera', 2000]] as const) {
      await pool.query(
        `insert into os_itens (tenant_id, os_id, servico_id, porte_id, nome_servico, valor_centavos, comissao_tipo, comissao_valor)
         values ($1, $2, (select id from servicos where tenant_id = $1 and nome = $3), (select id from portes where tenant_id = $1 and nome = 'Pequeno'), $3, $4, 'percentual', 3000)`,
        [os.tenantId, os.osId, nome, valor],
      );
    }
    await pub.goto(`/acompanhar/${os.token}`);
    const servicos = pub.getByRole('region', { name: 'Serviços' });
    await expect(servicos).toContainText(`Total${total === 6000 ? 'R$ 60,00' : total === 8500 ? 'R$ 85,00' : 'R$ 70,00'}`);
    if (linha) await expect(servicos).toContainText(linha);
    else for (const t of ['Desconto', 'Acréscimo']) await expect(servicos).not.toContainText(t);
  }
  await pub.context().close();
});
