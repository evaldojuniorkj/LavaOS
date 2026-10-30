import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { testUrls } from '../helpers/test-db';
import { E2E_PILOT_SLUG } from './global-setup';
import { entrarLavador, entrarStaff, pin } from './login';

const pool = new pg.Pool({ connectionString: testUrls.owner, max: 1 });
test.afterAll(() => pool.end());
const um = async <T = Record<string, string>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T;

// placas só deste spec (aleatórias por teste): nenhum outro spec enxerga estes veículos
function placaNova() {
  const l = () => 'ABCDEFGHJKLMNPRTUVWXYZ'[Math.floor(Math.random() * 22)];
  const d = () => String(Math.floor(Math.random() * 10));
  return `W${l()}${l()}${d()}${l()}${d()}${d()}`;
}
const cartao = (page: Page, placa: string) => page.getByRole('article').filter({ hasText: placa });

/** Cliente (com ou sem telefone), veículo e OS inseridos direto; total R$ 1.234,56. */
async function semear(status: 'aguardando' | 'pronto', telefone: string | null, comCliente = true) {
  const t = await um<{ id: string }>('select id from lava_jatos where slug = $1', [E2E_PILOT_SLUG]);
  const placa = placaNova();
  const cli = comCliente ? await um<{ id: string }>('insert into clientes (tenant_id, nome, telefone) values ($1, $2, $3) returning id', [t.id, `Cliente ${placa}`, telefone]) : null;
  const { ultimo } = await um<{ ultimo: number }>(
    'insert into os_contadores (tenant_id, ultimo) values ($1, 1) on conflict (tenant_id) do update set ultimo = os_contadores.ultimo + 1 returning ultimo',
    [t.id],
  );
  await pool.query(`insert into veiculos (tenant_id, placa, modelo, porte_id, cliente_id) values ($1, $2, 'Onix Zap', (select id from portes where tenant_id = $1 and nome = 'Pequeno'), $3)`, [t.id, placa, cli?.id ?? null]);
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into ordens_servico (tenant_id, numero, veiculo_id, cliente_id, aberta_por, status, token_publico, subtotal_centavos, total_centavos, pronto_em)
     values ($1, $2, (select id from veiculos where tenant_id = $1 and placa = $3), $4, (select id from membros where tenant_id = $1 and nome_exibicao = 'Recepcao E2E'), $5, $6, 123456, 123456, $7)`,
    [t.id, ultimo, placa, cli?.id ?? null, status, token, status === 'pronto' ? new Date() : null],
  );
  return { placa, token };
}

async function entrarNaFila(page: Page) {
  await entrarStaff(page, 'recepcao@e2e.test');
  await expect(page).toHaveURL('/fila');
}

/** Clica e devolve a URL da nova aba; wa.me é interceptado, o teste não sai do app nem usa a rede. */
async function abreWhatsapp(page: Page, clicar: () => Promise<void>) {
  await page.context().route('https://wa.me/**', (r) => r.fulfill({ body: 'ok' }));
  const popup = page.context().waitForEvent('page');
  await clicar();
  const aba = await popup;
  await expect(page).toHaveURL('/fila');
  return new URL(aba.url());
}

test('Enviar acompanhamento abre wa.me com a mensagem, a placa e o link de acompanhamento', async ({ page }) => {
  const { placa, token } = await semear('aguardando', '(11) 98888-7777');
  await entrarNaFila(page);
  const botao = cartao(page, placa).getByRole('link', { name: 'Enviar acompanhamento' });
  await expect(botao).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(cartao(page, placa).getByRole('link', { name: 'Avisar pronto' })).toHaveCount(0); // só na coluna Pronto
  const url = await abreWhatsapp(page, () => botao.click());
  expect(url.host + url.pathname).toBe('wa.me/5511988887777');
  const texto = url.searchParams.get('text')!;
  expect(texto).toContain(placa);
  expect(texto).toContain(`/acompanhar/${token}`);
});

test('Avisar pronto aparece só na coluna Pronto e a mensagem leva o total', async ({ page }) => {
  const { placa } = await semear('pronto', '11988887777');
  await entrarNaFila(page);
  const card = page.getByRole('region', { name: 'Pronto' }).getByRole('article').filter({ hasText: placa });
  const url = await abreWhatsapp(page, () => card.getByRole('link', { name: 'Avisar pronto' }).click());
  expect(url.pathname).toBe('/5511988887777');
  const texto = url.searchParams.get('text')!;
  expect(texto).toContain(placa);
  expect(texto).toContain('R$ 1.234,56');
});

test('sem telefone o botão pede o número, valida, e salvar no cliente faz o próximo clique abrir direto', async ({ page }) => {
  const { placa } = await semear('aguardando', null);
  await entrarNaFila(page);
  const card = cartao(page, placa);
  await expect(card.getByRole('link', { name: 'Enviar acompanhamento' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Enviar acompanhamento' }).click();
  const campo = card.getByLabel('Telefone do cliente');
  await campo.fill('123');
  await card.getByRole('button', { name: 'Salvar no cliente' }).click();
  await expect(card.getByText('Telefone inválido. Use DDD + número.')).toBeVisible();
  await card.getByRole('button', { name: 'Usar só desta vez' }).click();
  await expect(card.getByText('Telefone inválido. Use DDD + número.')).toBeVisible();

  await campo.fill('(21) 97777-6666');
  await card.getByRole('button', { name: 'Salvar no cliente' }).click();
  const link = card.getByRole('link', { name: 'Enviar acompanhamento' });
  await expect(link).toBeVisible();
  const url = await abreWhatsapp(page, () => link.click());
  expect(url.pathname).toBe('/5521977776666');
  expect((await um<{ telefone: string }>('select c.telefone from clientes c join veiculos v on v.cliente_id = c.id where v.placa = $1', [placa])).telefone).toBe('+5521977776666');
});

test('sem telefone, "usar só desta vez" abre o link sem gravar; OS sem cliente não oferece salvar', async ({ page }) => {
  const { placa } = await semear('aguardando', null);
  const sem = await semear('aguardando', null, false);
  await entrarNaFila(page);
  await cartao(page, placa).getByRole('button', { name: 'Enviar acompanhamento' }).click();
  await cartao(page, placa).getByLabel('Telefone do cliente').fill('11 98888-1111');
  const url = await abreWhatsapp(page, () => cartao(page, placa).getByRole('button', { name: 'Usar só desta vez' }).click());
  expect(url.pathname).toBe('/5511988881111');
  expect((await um<{ telefone: string | null }>('select c.telefone from clientes c join veiculos v on v.cliente_id = c.id where v.placa = $1', [placa])).telefone).toBeNull();

  await cartao(page, sem.placa).getByRole('button', { name: 'Enviar acompanhamento' }).click();
  await expect(cartao(page, sem.placa).getByLabel('Telefone do cliente')).toBeVisible();
  await expect(cartao(page, sem.placa).getByRole('button', { name: 'Salvar no cliente' })).toHaveCount(0);
});

test('lavador não vê botões de aviso, telefone nem token (tela, HTML e RSC)', async ({ page }) => {
  const { placa, token } = await semear('pronto', '+5511966665555');
  await entrarLavador(page, 'lavador.e2e', pin());
  await expect(page).toHaveURL('/fila');
  await expect(cartao(page, placa)).toBeVisible();
  await expect(page.getByText(/Enviar acompanhamento|Avisar pronto/)).toHaveCount(0);
  for (const r of [await page.request.get('/fila'), await page.request.get('/fila', { headers: { RSC: '1' } })]) {
    const body = await r.text();
    expect(body).toContain(placa); // controle: a resposta tem a fila
    for (const proibido of [token, '966665555', 'wa.me', 'acompanhar/', 'Enviar acompanhamento', 'Avisar pronto']) expect(body, proibido).not.toContain(proibido);
  }
});
