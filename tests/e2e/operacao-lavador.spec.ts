import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { testUrls } from '../helpers/test-db';
import { E2E_PILOT_SLUG } from './global-setup';
import { entrarLavador, entrarStaff, pin, semRolagemHorizontal } from './login';

// Roda só nos projetos android (412×915) e android-small (360×640): app do lavador.
const pool = new pg.Pool({ connectionString: testUrls.owner, max: 1 });
const um = async <T = Record<string, string>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T;

const PLACA_EXISTENTE = 'EXS1A23';
// nada disso pode chegar ao lavador: valores, telefone do cliente da fixture, comissão e token público
const PROIBIDOS = ['R$', 'Centavos', 'telefone', '988887777', 'comissao', 'token'];
// campos só da visão de gestão da OS (a busca por placa devolve `clienteId` do veículo, então valem só nas telas do balcão)
const CAMPOS_GESTAO = ['lavaJato', 'clienteId', 'urlAcompanhar'];

// placas só deste spec; ao fim toda OS criada aqui é encerrada (lavadores voltam a ficar livres para os outros specs)
const criadas: string[] = [];
function placaNova() {
  const l = () => 'ABCDEFGHJKLMNPRTUVWXYZ'[Math.floor(Math.random() * 22)];
  const d = () => String(Math.floor(Math.random() * 10));
  const p = `L${l()}${l()}${d()}${l()}${d()}${d()}`;
  criadas.push(p);
  return p;
}
test.afterEach(async () => {
  await pool.query(
    `update ordens_servico set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = 'limpeza e2e'
     where status in ('aguardando', 'em_lavagem', 'pronto') and veiculo_id in (select id from veiculos where placa = any($1))`,
    [criadas],
  );
});
test.afterAll(() => pool.end());

type Quem = 'eu' | 'outro' | null;
/** Veículo e OS inseridos direto no estado desejado, com o item "Lavagem completa" (R$ 50,00). */
async function semear(status: 'aguardando' | 'em_lavagem' | 'pronto', quem: Quem) {
  const t = await um<{ id: string }>('select id from lava_jatos where slug = $1', [E2E_PILOT_SLUG]);
  const placa = placaNova();
  const nome = quem === 'eu' ? 'Lavador E2E' : 'Lavador Dois E2E';
  const { ultimo } = await um<{ ultimo: number }>(
    'insert into os_contadores (tenant_id, ultimo) values ($1, 1) on conflict (tenant_id) do update set ultimo = os_contadores.ultimo + 1 returning ultimo',
    [t.id],
  );
  const v = await um<{ id: string; porte_id: string }>(
    `insert into veiculos (tenant_id, placa, modelo, cor, porte_id) values ($1, $2, 'Gol Lavador', 'Prata', (select id from portes where tenant_id = $1 and nome = 'Pequeno')) returning id, porte_id`,
    [t.id, placa],
  );
  const os = await um<{ id: string }>(
    `insert into ordens_servico (tenant_id, numero, veiculo_id, aberta_por, status, responsavel_id, atribuido_em, inicio_lavagem_em, pronto_em, token_publico, subtotal_centavos, total_centavos)
     values ($1, $2, $3, (select id from membros where tenant_id = $1 and nome_exibicao = 'Recepcao E2E'), $4,
       (select id from membros where tenant_id = $1 and nome_exibicao = $5 and $6), case when $6 then now() end,
       case when $4 <> 'aguardando' then now() end, case when $4 = 'pronto' then now() end, $7, 5000, 5000) returning id`,
    [t.id, ultimo, v.id, status, nome, quem !== null, randomBytes(32).toString('base64url')],
  );
  await pool.query(
    `insert into os_itens (tenant_id, os_id, servico_id, porte_id, nome_servico, valor_centavos, comissao_tipo, comissao_valor)
     values ($1, $2, (select id from servicos where tenant_id = $1 and nome = 'Lavagem completa'), $3, 'Lavagem completa', 5000, 'percentual', 3000)`,
    [t.id, os.id, v.porte_id],
  );
  return placa;
}

async function novoContexto(browser: Browser) {
  const opcoes: Record<string, unknown> = { ...test.info().project.use };
  delete opcoes.defaultBrowserType;
  return (await browser.newContext(opcoes)).newPage();
}

async function entrar(page: Page) {
  await entrarLavador(page, 'lavador.e2e', pin());
  await expect(page).toHaveURL('/lavador');
}

const cartao = (page: Page, placa: string) => page.getByRole('article').filter({ hasText: placa });
/** Registra as chamadas de navigator.vibrate (o headless não vibra). */
const gravarVibracao = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: (ms: number) => ((window as { vib?: number[] }).vib ??= []).push(ms) > 0 }));
const vibracoes = (page: Page) => page.evaluate(() => (window as { vib?: number[] }).vib ?? []);

/** Todo alvo de toque visível tem ≥ 48×48 px e texto ≥ 16 px. */
async function alvosGrandes(page: Page) {
  const alvos = await page.locator('button:visible, a:visible, select:visible, input:visible:not([type=checkbox]), label:visible:has(input[type=checkbox])').all();
  expect(alvos.length).toBeGreaterThan(0);
  for (const a of alvos) {
    const box = (await a.boundingBox())!;
    const nome = (await a.textContent()) || (await a.getAttribute('id'));
    expect(box.width, `largura de ${nome}`).toBeGreaterThanOrEqual(48);
    expect(box.height, `altura de ${nome}`).toBeGreaterThanOrEqual(48);
    expect(parseFloat(await a.evaluate((e) => getComputedStyle(e).fontSize)), `fonte de ${nome}`).toBeGreaterThanOrEqual(16);
  }
}

test('lavador entra com usuário/PIN, cai em /lavador e a barra inferior só tem Fila e + Nova lavagem', async ({ page }) => {
  await entrar(page);
  await expect(page.getByRole('heading', { name: 'Fila', level: 1 })).toBeVisible();
  await expect(page.getByText('Lava Jato E2E', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(1); // sem menu de topo
  await expect(page.getByRole('navigation', { name: 'App do lavador' }).getByRole('link')).toHaveText(['Fila', '+ Nova lavagem']);
  await expect(page.getByRole('link', { name: 'Fila' })).toHaveAttribute('aria-current', 'page');
});

test('cartão mostra o botão certo por estado, meus carros primeiro e OS de outro não oferece Pegar', async ({ page }) => {
  const outroEm = await semear('em_lavagem', 'outro');
  const outroAg = await semear('aguardando', 'outro');
  const livre = await semear('aguardando', null);
  const meuAg = await semear('aguardando', 'eu');
  const meuEm = await semear('em_lavagem', 'eu');
  const meuPronto = await semear('pronto', 'eu');
  await entrar(page);
  const esperado: [string, string[]][] = [[livre, ['Pegar']], [meuAg, ['Iniciar lavagem']], [meuEm, ['Pronto']], [meuPronto, []], [outroEm, []], [outroAg, []]];
  for (const [placa, botoes] of esperado) await expect(cartao(page, placa).getByRole('button'), placa).toHaveText(botoes);
  await expect(cartao(page, livre)).toContainText('Sem responsável');
  await expect(cartao(page, outroEm)).toContainText('Em lavagem com Lavador Dois E2E');
  await expect(cartao(page, outroAg)).toContainText('Lavador Dois E2E');
  const c = cartao(page, meuAg);
  for (const t of ['Gol Lavador', 'Prata', 'Lavagem completa', 'Lavador E2E']) await expect(c).toContainText(t);
  await expect(c).toContainText(/há \d+ min/);
  await expect(page.getByRole('button', { name: /Entrar|Direcionar|Trocar responsável|Entregar|Cancelar|Editar/ })).toHaveCount(0);

  const ordem = await page.getByRole('article').allTextContents();
  const pos = (p: string) => ordem.findIndex((t) => t.includes(p));
  for (const meu of [meuAg, meuEm, meuPronto]) for (const alheio of [livre, outroEm, outroAg]) expect(pos(meu), `${meu} antes de ${alheio}`).toBeLessThan(pos(alheio));

  const botao = cartao(page, livre).getByRole('button', { name: 'Pegar' });
  expect(await botao.evaluate((e) => getComputedStyle(e).touchAction)).toBe('manipulation');
  await alvosGrandes(page);
  await semRolagemHorizontal(page);
  await page.getByRole('link', { name: '+ Nova lavagem' }).click();
  await page.getByLabel('Placa', { exact: true }).fill(placaNova());
  await page.getByRole('button', { name: 'Buscar placa' }).click();
  await expect(page.getByText('Placa nova')).toBeVisible();
  await page.getByLabel('Porte', { exact: true }).selectOption({ label: 'Pequeno' });
  await alvosGrandes(page);
  await semRolagemHorizontal(page);
});

test('nenhum R$, telefone, token ou comissão no texto, no HTML, no RSC, nas actions nem no SSE', async ({ page }) => {
  const placa = await semear('aguardando', null);
  const corpos: string[] = [];
  // tudo que a página recebe, menos código estático (/_next/static) e o stream SSE (lido abaixo pelo próprio EventSource)
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/_next/static/') || url.pathname === '/api/eventos' || url.pathname.startsWith('/icons/')) return route.continue();
    const r = await route.fetch({ maxRedirects: 0 }); // o navegador segue o redirect sozinho
    corpos.push(`${route.request().method()} ${url.pathname}\n${await r.text()}`);
    await route.fulfill({ response: r });
  });
  await entrar(page);
  await page.evaluate(() => {
    const w = window as { sse?: string[] };
    w.sse = [];
    new EventSource('/api/eventos').onmessage = (e) => w.sse!.push(e.data);
  });
  await cartao(page, placa).getByRole('button', { name: 'Pegar' }).click();
  await cartao(page, placa).getByRole('button', { name: 'Pronto' }).click();
  await expect(cartao(page, placa).getByRole('button')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as { sse?: string[] }).sse!.length)).toBeGreaterThan(0);
  const sse = await page.evaluate(() => (window as { sse?: string[] }).sse!.join('\n'));

  await page.getByRole('link', { name: '+ Nova lavagem' }).click();
  await page.getByLabel('Placa', { exact: true }).fill(PLACA_EXISTENTE);
  await page.getByRole('button', { name: 'Buscar placa' }).click();
  await expect(page.getByRole('region', { name: 'Veículo encontrado' })).toContainText('Cliente Existente E2E');
  await expect(page.getByRole('checkbox', { name: /Lavagem completa/ })).toBeVisible();
  const texto = await page.locator('body').innerText();
  await page.unroute('**/*');

  for (const rota of ['/lavador', '/lavador/nova']) {
    for (const r of [await page.request.get(rota), await page.request.get(rota, { headers: { RSC: '1' } })]) corpos.push(`GET ${rota}\n${await r.text()}`);
  }
  const tudo = corpos.join('\n');
  expect(tudo).toContain('Cliente Existente E2E'); // controle: a resposta da busca por placa foi lida
  expect(tudo).toContain('Lavagem completa'); // controle: fila e catálogo foram lidos
  expect(corpos.some((c) => c.startsWith('POST /lavador\n'))).toBe(true); // controle: as actions da fila foram lidas
  for (const p of PROIBIDOS) {
    expect(texto, `texto visível: ${p}`).not.toContain(p);
    expect(sse, `SSE: ${p}`).not.toContain(p);
    for (const c of corpos) expect(c, `${c.split('\n')[0]}: ${p}`).not.toContain(p);
  }
});

/** GET sem seguir redirect; só o salto de cache-busting do RSC (`?_rsc`) do próprio Next é seguido, para ler a resposta real. */
async function semSeguir(page: Page, rota: string, headers: Record<string, string>) {
  const r = await page.request.get(rota, { headers, maxRedirects: 0 });
  const destino = r.headers().location;
  return destino?.startsWith(`${rota}?_rsc`) ? page.request.get(destino, { headers, maxRedirects: 0 }) : r;
}

test('telas do balcão pedidas direto pelo lavador (HTML e RSC, sem seguir redirect) não trazem nenhum valor', async ({ page, browser }) => {
  await semear('aguardando', null); // a fila tem ao menos uma OS com valores
  const rec = await novoContexto(browser);
  await entrarStaff(rec, 'recepcao@e2e.test');
  await expect(rec).toHaveURL('/fila');
  await entrar(page);
  for (const rota of ['/fila', '/nova-os']) {
    for (const headers of [{}, { RSC: '1' }] as Record<string, string>[]) {
      // controle: a mesma leitura na sessão da recepção encontra valores, então a varredura sabe falhar
      const doBalcao = await (await semSeguir(rec, rota, headers)).text();
      expect([...PROIBIDOS, ...CAMPOS_GESTAO].filter((p) => doBalcao.includes(p)), `${rota} ${JSON.stringify(headers)} recepção`).not.toEqual([]);

      const r = await semSeguir(page, rota, headers);
      const corpo = await r.text();
      // HTML: 307 para /lavador. RSC: 200 só com a instrução de redirect no payload (NEXT_REDIRECT para /lavador)
      if (headers.RSC) {
        expect(r.status(), rota).toBe(200);
        expect(corpo, rota).toMatch(/NEXT_REDIRECT;replace;\/lavador;/);
      } else {
        expect(r.status(), rota).toBe(307);
        expect(r.headers().location, rota).toBe('/lavador');
      }
      expect(corpo, `${rota} ${JSON.stringify(headers)}: dados da página`).not.toContain('Lavagem completa'); // a página nem chega a carregar a fila/catálogo
      for (const p of [...PROIBIDOS, ...CAMPOS_GESTAO]) expect(corpo, `${rota} ${JSON.stringify(headers)}: ${p}`).not.toContain(p);
    }
  }
  await rec.context().close();
});

test('Nova lavagem: placa nova → porte → serviços → criar; fica aguardando com ele até Iniciar lavagem e Pronto', async ({ page }) => {
  await gravarVibracao(page);
  await entrar(page);
  await page.getByRole('link', { name: '+ Nova lavagem' }).click();
  await expect(page).toHaveURL('/lavador/nova');
  await expect(page.getByRole('heading', { name: 'Nova lavagem', level: 1 })).toBeVisible();
  const placa = placaNova();
  await page.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(page.getByText('Busque a placa antes de abrir a OS.')).toBeVisible();
  const campo = page.getByLabel('Placa', { exact: true });
  await expect(campo).toHaveAttribute('autocapitalize', 'characters');
  await campo.fill(placa.toLowerCase());
  await page.getByRole('button', { name: 'Buscar placa' }).click();
  await expect(page.getByText('Placa nova')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(page.getByText('Escolha o porte.')).toBeVisible();
  await page.getByLabel('Porte', { exact: true }).selectOption({ label: 'Pequeno' });
  await page.getByLabel('Modelo').fill('Onix Lavador');
  await expect(page.getByRole('checkbox', { name: /Cera/ })).toHaveCount(0); // adicional só depois de um principal
  await page.getByRole('checkbox', { name: /Lavagem completa/ }).check();
  await expect(page.getByRole('checkbox', { name: /Cera/ })).toBeVisible();
  await expect(page.getByLabel(/Responsável/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(page).toHaveURL('/lavador');
  const c = cartao(page, placa);
  await expect(c).toContainText('Lavador E2E');
  await expect(c).toContainText('Aguardando');
  await expect(c).toContainText('Onix Lavador');
  const os = async () =>
    um<{ status: string; responsavel: string; n: number }>(
      `select o.status, m.nome_exibicao as responsavel, count(*) over ()::int as n from ordens_servico o join veiculos v on v.id = o.veiculo_id join membros m on m.id = o.responsavel_id where v.placa = $1`,
      [placa],
    );
  expect(await os()).toEqual({ status: 'aguardando', responsavel: 'Lavador E2E', n: 1 });
  await c.getByRole('button', { name: 'Iniciar lavagem' }).click();
  await expect(c.getByRole('button')).toHaveText(['Pronto']);
  await c.getByRole('button', { name: 'Pronto' }).click();
  await expect(c.getByRole('button')).toHaveCount(0);
  await expect.poll(async () => (await os()).status).toBe('pronto');
  expect(await vibracoes(page)).toEqual([30, 30]);
});

test('ação com conflito mostra a mensagem, vibra longo e recarrega', async ({ page }) => {
  await gravarVibracao(page);
  const placa = await semear('aguardando', null);
  await page.route('**/api/eventos', (r) => r.abort()); // tela parada no estado antigo: o clique chega com `esperado` velho
  await entrar(page);
  await expect(cartao(page, placa).getByRole('button')).toHaveText(['Pegar']);
  // outro lavador pegou a OS enquanto isso
  await pool.query(
    `update ordens_servico set status = 'em_lavagem', inicio_lavagem_em = now(), atribuido_em = now(), responsavel_id = (select id from membros where nome_exibicao = 'Lavador Dois E2E')
     where veiculo_id = (select id from veiculos where placa = $1)`,
    [placa],
  );
  await cartao(page, placa).getByRole('button', { name: 'Pegar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Essa OS já foi pega por Lavador Dois E2E' })).toBeVisible();
  await expect(cartao(page, placa)).toContainText('Em lavagem com Lavador Dois E2E');
  await expect(cartao(page, placa).getByRole('button')).toHaveCount(0);
  expect(await vibracoes(page)).toEqual([120]);
});

test('a fila atualiza quando outra pessoa muda uma OS, sem recarregar', async ({ page, browser }) => {
  await entrar(page);
  await page.evaluate(() => ((window as { marca?: number }).marca = 1)); // some se a página recarregar
  const rec = await novoContexto(browser);
  await entrarStaff(rec, 'recepcao@e2e.test');
  await expect(rec).toHaveURL('/fila');
  const placa = placaNova();
  await rec.goto('/nova-os');
  await rec.getByLabel('Placa', { exact: true }).fill(placa);
  await rec.getByRole('button', { name: 'Buscar placa' }).click();
  await rec.getByLabel('Porte', { exact: true }).selectOption({ label: 'Pequeno' });
  await rec.getByRole('checkbox', { name: /Lavagem completa/ }).check();
  await rec.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(rec).toHaveURL('/fila');
  await expect(cartao(page, placa).getByRole('button')).toHaveText(['Pegar']);
  await cartao(rec, placa).getByRole('button', { name: 'Cancelar' }).click();
  await rec.getByRole('dialog').getByLabel('Motivo').fill('limpeza do teste');
  await rec.getByRole('dialog').getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(cartao(page, placa)).toHaveCount(0);
  expect(await page.evaluate(() => (window as { marca?: number }).marca)).toBe(1);
  await rec.context().close();
});

test('manifest instalável: standalone, start_url /lavador, pt-BR, ícone maskable e ícones PNG sem sessão', async ({ request }) => {
  const r = await request.get('/manifest.webmanifest');
  expect(r.status()).toBe(200);
  const m = (await r.json()) as { display: string; start_url: string; lang: string; orientation: string; icons: { src: string; sizes: string; purpose?: string }[] };
  expect(m).toMatchObject({ display: 'standalone', start_url: '/lavador', lang: 'pt-BR', orientation: 'portrait' });
  expect(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
  expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const i of m.icons) {
    const img = await request.get(i.src);
    expect(img.status(), i.src).toBe(200);
    expect(img.headers()['content-type'], i.src).toBe('image/png');
  }
  const login = await (await request.get('/login')).text();
  expect(login).toContain('rel="manifest" href="/manifest.webmanifest"');
  expect(login).toContain('rel="apple-touch-icon"');
  expect(login).toContain('viewport-fit=cover');
});

test('cada perfil cai na sua tela: recepção em /lavador vai à /fila e lavador nas telas internas vai a /lavador', async ({ page, browser }) => {
  await entrar(page);
  for (const rota of ['/fila', '/nova-os', '/inicio', '/', '/configuracoes/equipe']) {
    await page.goto(rota);
    await expect(page, rota).toHaveURL('/lavador');
  }
  const rec = await novoContexto(browser);
  await entrarStaff(rec, 'recepcao@e2e.test');
  await expect(rec).toHaveURL('/fila');
  for (const rota of ['/lavador', '/lavador/nova']) {
    await rec.goto(rota);
    await expect(rec, rota).toHaveURL('/fila');
  }
  await rec.context().close();
});

test('sem vibração nem Wake Lock (iPhone/Safari) nada quebra; com Wake Lock a tela fica acesa e é repedida ao voltar', async ({ page, browser }) => {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => {
    delete (Navigator.prototype as { vibrate?: unknown }).vibrate;
    delete (Navigator.prototype as { wakeLock?: unknown }).wakeLock;
  });
  const placa = await semear('aguardando', null);
  await entrar(page);
  expect(await page.evaluate(() => 'vibrate' in navigator || 'wakeLock' in navigator)).toBe(false);
  await cartao(page, placa).getByRole('button', { name: 'Pegar' }).click();
  await expect(cartao(page, placa).getByRole('button')).toHaveText(['Pronto']);
  expect(erros).toEqual([]);

  const outra = await novoContexto(browser);
  await outra.addInitScript(() => {
    const w = window as { pedidos?: number };
    w.pedidos = 0;
    Object.defineProperty(Navigator.prototype, 'wakeLock', {
      configurable: true,
      value: { request: async () => (w.pedidos!++, { release: async () => {}, addEventListener() {} }) },
    });
  });
  await entrar(outra);
  await expect.poll(() => outra.evaluate(() => (window as { pedidos?: number }).pedidos)).toBe(1);
  await outra.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => outra.evaluate(() => (window as { pedidos?: number }).pedidos)).toBe(2);
  await outra.context().close();
});
