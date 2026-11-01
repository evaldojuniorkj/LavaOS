import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { testUrls } from '../helpers/test-db';
import { E2E_PILOT_SLUG } from './global-setup';
import { entrarLavador, entrarStaff, pin, semRolagemHorizontal } from './login';

// Roda nos projetos desktop (1280), mobile (390) e android-small (360). Contagens são relativas: o banco é compartilhado com os outros specs.
const pool = new pg.Pool({ connectionString: testUrls.owner, max: 1 });
const um = async <T = Record<string, string>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T;

const criadas: string[] = [];
function placaNova() {
  const l = () => 'ABCDEFGHJKLMNPRTUVWXYZ'[Math.floor(Math.random() * 22)];
  const d = () => String(Math.floor(Math.random() * 10));
  const p = `P${l()}${l()}${d()}${l()}${d()}${d()}`;
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

async function novoContexto(browser: Browser) {
  const opcoes: Record<string, unknown> = { ...test.info().project.use };
  delete opcoes.defaultBrowserType;
  return (await browser.newContext(opcoes)).newPage();
}

/** OS aguardando com entrada há 70 min (acima do limite de 60), inserida direto; com `comCliente`, o veículo é de um cliente com telefone. */
async function semearAtrasada(comCliente = false) {
  const t = await um<{ id: string }>('select id from lava_jatos where slug = $1', [E2E_PILOT_SLUG]);
  const placa = placaNova();
  const { ultimo } = await um<{ ultimo: number }>(
    'insert into os_contadores (tenant_id, ultimo) values ($1, 1) on conflict (tenant_id) do update set ultimo = os_contadores.ultimo + 1 returning ultimo',
    [t.id],
  );
  const v = await um<{ id: string }>(
    `insert into veiculos (tenant_id, placa, modelo, porte_id, cliente_id) values ($1, $2, 'Gol Painel', (select id from portes where tenant_id = $1 and nome = 'Pequeno'),
       (select id from clientes where tenant_id = $1 and nome = 'Cliente Existente E2E' and $3)) returning id`,
    [t.id, placa, comCliente],
  );
  await pool.query(
    `insert into ordens_servico (tenant_id, numero, veiculo_id, aberta_por, status, entrada_em, token_publico, subtotal_centavos, total_centavos)
     values ($1, $2, $3, (select id from membros where tenant_id = $1 and nome_exibicao = 'Recepcao E2E'), 'aguardando', now() - interval '70 minutes', $4, 5000, 5000)`,
    [t.id, ultimo, v.id, randomBytes(32).toString('base64url')],
  );
  return { placa, numero: ultimo, veiculoId: v.id };
}

const cartao = (page: Page, titulo: string) => page.getByRole('heading', { name: titulo, level: 2, exact: true }).locator('xpath=..').locator('p');
const contagem = async (page: Page, titulo: string) => Number(await cartao(page, titulo).innerText());

test('dono cai no painel; a contagem sobe sem recarregar quando abrem OS e quando o lavador inicia a lavagem', async ({ page, browser }) => {
  await entrarStaff(page, 'dono@e2e.test');
  await expect(page).toHaveURL('/painel');
  await expect(page.getByRole('heading', { name: 'Painel', level: 1 })).toBeVisible();
  await page.evaluate(() => ((window as { marca?: number }).marca = 1)); // some se a página recarregar
  const aguardando = await contagem(page, 'Aguardando');
  const lavagem = await contagem(page, 'Em lavagem');

  const outra = await page.context().newPage(); // Nova OS na mesma sessão, em outra aba
  const placa = placaNova();
  await outra.goto('/nova-os');
  await outra.getByLabel('Placa', { exact: true }).fill(placa);
  await outra.getByRole('button', { name: 'Buscar placa' }).click();
  await expect(outra.getByText('Placa nova')).toBeVisible();
  await outra.getByLabel('Porte', { exact: true }).selectOption({ label: 'Pequeno' });
  await outra.getByRole('checkbox', { name: /Lavagem completa/ }).check();
  await outra.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(outra).toHaveURL('/fila');
  await expect(cartao(page, 'Aguardando')).toHaveText(String(aguardando + 1));

  const lav = await novoContexto(browser);
  await entrarLavador(lav, 'lavador.e2e', pin());
  await expect(lav).toHaveURL('/lavador');
  await lav.getByRole('article').filter({ hasText: placa }).getByRole('button', { name: 'Pegar' }).click();
  await expect(lav.getByRole('article').filter({ hasText: placa }).getByRole('button', { name: 'Pronto' })).toBeVisible();
  await expect(cartao(page, 'Em lavagem')).toHaveText(String(lavagem + 1));
  await expect(cartao(page, 'Aguardando')).toHaveText(String(aguardando));
  await expect(page.getByRole('listitem').filter({ hasText: 'Lavador E2E' })).toContainText('Ocupado');
  expect(await page.evaluate(() => (window as { marca?: number }).marca)).toBe(1);
  await semRolagemHorizontal(page);
  await lav.context().close();
});

test('OS atrasada semeada no banco aparece em "OSs atrasadas" com número e placa', async ({ page }) => {
  const { placa, numero } = await semearAtrasada();
  await entrarStaff(page, 'gerente@e2e.test');
  await expect(page).toHaveURL('/painel');
  const secao = page.getByRole('region', { name: 'OSs atrasadas' });
  const item = secao.getByRole('listitem').filter({ hasText: `OS ${numero}` });
  await expect(item).toContainText(placa);
  await expect(item).toContainText('Aguardando');
  await semRolagemHorizontal(page);
});

test('carros atrasados sem placa são identificados pelo modelo no painel', async ({ page }) => {
  const carros = [
    { ...await semearAtrasada(), modelo: 'Toyota Corolla Cross Hybrid XRX 2026' },
    { ...await semearAtrasada(), modelo: 'VolkswagenNivusHighlineSemPlacaModelo2026' },
  ];
  try {
    for (const c of carros) await pool.query('update veiculos set placa = null, modelo = $1 where id = $2', [c.modelo, c.veiculoId]);
    await entrarStaff(page, 'gerente@e2e.test');
    await expect(page).toHaveURL('/painel');
    const secao = page.getByRole('region', { name: 'OSs atrasadas' });
    for (const c of carros) {
      const item = secao.getByRole('listitem').filter({ has: page.getByText(`OS ${c.numero}`, { exact: true }) });
      await expect(item.getByText('SEM PLACA', { exact: true })).toBeVisible();
      await expect(item.getByText(c.modelo, { exact: true })).toBeVisible();
      await expect(item).toContainText('Aguardando');
      await expect(item).not.toContainText(/null|undefined/);
    }
    await semRolagemHorizontal(page);
  } finally {
    // Restaura as placas usadas pelo afterEach para encerrar só as OSs deste teste.
    for (const c of carros) await pool.query('update veiculos set placa = $1 where id = $2', [c.placa, c.veiculoId]);
  }
});

test('recepção abre o painel pelo menu: vê só contagens (sem R$, link público ou telefone) e segue sem Equipe', async ({ page }) => {
  await semearAtrasada(true); // há OS atrasada de cliente com telefone: o controle de que a varredura teria o que achar
  await entrarStaff(page, 'recepcao@e2e.test');
  await expect(page).toHaveURL('/fila');
  await page.getByRole('link', { name: 'Painel' }).click();
  await expect(page).toHaveURL('/painel');
  for (const t of ['Aguardando', 'Em lavagem', 'Pronto', 'Entregues hoje']) await expect(cartao(page, t)).toBeVisible();
  await expect(page.getByRole('region', { name: 'OSs atrasadas' }).getByRole('listitem').first()).toBeVisible();
  await semRolagemHorizontal(page);
  const corpos = [await (await page.request.get('/painel')).text(), await (await page.request.get('/painel', { headers: { RSC: '1' } })).text(), await page.locator('body').innerText()];
  for (const c of corpos) {
    for (const p of ['R$', 'acompanhar/', '988887777', '977776666', 'Cliente Existente E2E']) expect(c, p).not.toContain(p);
  }
  await page.goto('/configuracoes/equipe');
  await expect(page.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
});

test('lavador pedindo /painel vai a /lavador sem o painel; visitante vai ao login com retorno', async ({ page, browser }) => {
  const lav = await novoContexto(browser);
  await entrarLavador(lav, 'lavador.e2e', pin());
  await expect(lav).toHaveURL('/lavador');
  const r = await lav.request.get('/painel', { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(r.headers().location).toBe('/lavador');
  expect(await r.text()).not.toContain('Entregues hoje');
  await lav.goto('/painel');
  await expect(lav).toHaveURL('/lavador');
  await expect(lav.getByRole('heading', { name: 'Painel' })).toHaveCount(0);
  await lav.context().close();

  await page.goto('/painel');
  await expect(page).toHaveURL(/\/login\?next=%2Fpainel$/);
});
