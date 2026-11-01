import { randomInt } from 'node:crypto';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { testUrls } from '../helpers/test-db';
import { quitarOs } from './dinheiro';
import { entrarLavador, entrarStaff, pin } from './login';

// Fluxo ponta a ponta da Fase 1 (projetos desktop e mobile = a recepção). Veículos exclusivos deste spec, do global-setup:
// FLX1D23 (Gol) e FLX2E45 (Onix), ambos de Maria Souza (+55 11 97777-6666), porte Pequeno.
const GOL = 'FLX1D23';
const ONIX = 'FLX2E45';
const pool = new pg.Pool({ connectionString: testUrls.owner, max: 1 });
// teste que falhou no meio não deixa OS ativa destas placas para o próximo projeto
test.afterEach(() =>
  pool.query(
    `update ordens_servico set status = 'cancelada', cancelada_em = now(), motivo_cancelamento = 'limpeza e2e'
     where status in ('aguardando', 'em_lavagem', 'pronto') and veiculo_id in (select id from veiculos where placa = any($1))`,
    [[GOL, ONIX]],
  ),
);
test.afterAll(() => pool.end());

const ip = () => `10.8.${randomInt(256)}.${randomInt(256)}`;
/** Contexto novo: celular Android do lavador (Pixel, 412×915) ou visitante anônimo do link público. */
async function contexto(browser: Browser, tipo: 'lavador' | 'publico'): Promise<Page> {
  const opcoes: Record<string, unknown> = tipo === 'lavador' ? { ...devices['Pixel 7'], viewport: { width: 412, height: 915 } } : { ...test.info().project.use };
  delete opcoes.defaultBrowserType;
  return (await browser.newContext({ ...opcoes, extraHTTPHeaders: { 'x-real-ip': ip() } })).newPage();
}

const coluna = (page: Page, nome: 'Aguardando' | 'Em lavagem' | 'Pronto') => page.getByRole('region', { name: nome });
const cartao = (page: Page, placa: string) => page.getByRole('article').filter({ hasText: placa });
const marcar = (page: Page) => page.evaluate(() => ((window as { marca?: number }).marca = 1)); // some se a página recarregar
const marcada = (page: Page) => page.evaluate(() => (window as { marca?: number }).marca);

async function entrarRecepcao(page: Page) {
  await entrarStaff(page, 'recepcao@e2e.test');
  await expect(page).toHaveURL('/fila');
}
async function entrarNoCelular(page: Page) {
  await entrarLavador(page, 'lavador.e2e', pin());
  await expect(page).toHaveURL('/lavador');
}

/** Nova OS pela placa já cadastrada, com principal + adicional; devolve o caminho do link público (do botão de WhatsApp). */
async function abrirOs(page: Page, placa: string) {
  await page.goto('/nova-os');
  await page.getByLabel('Placa', { exact: true }).fill(placa.toLowerCase());
  await page.getByRole('button', { name: 'Buscar placa' }).click();
  await expect(page.getByRole('region', { name: 'Veículo encontrado' })).toContainText('Maria Souza');
  await page.getByRole('checkbox', { name: /Lavagem completa/ }).check();
  await page.getByRole('checkbox', { name: /Cera/ }).check();
  await page.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(page).toHaveURL('/fila');
  const c = coluna(page, 'Aguardando').getByRole('article').filter({ hasText: placa });
  await expect(c).toContainText('Sem responsável');
  await expect(c).toContainText('R$ 70,00');
  const texto = new URL((await c.getByRole('link', { name: 'Enviar acompanhamento' }).getAttribute('href'))!).searchParams.get('text')!;
  return new URL(texto.match(/https?:\/\/\S+\/acompanhar\/[\w-]+/)![0]).pathname;
}

test('recepção abre OS → lavador pega no celular → fila atualiza → pronto → avisar pronto → entrega → link público mostra Entregue', async ({ page, browser }) => {
  await entrarRecepcao(page);
  const link = await abrirOs(page, GOL);
  await marcar(page);

  const pub = await contexto(browser, 'publico');
  await pub.goto(link);
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Na fila para lavar');
  await expect(pub.getByText(GOL)).toBeVisible();
  await marcar(pub);

  const lav = await contexto(browser, 'lavador');
  await entrarNoCelular(lav);
  const noCelular = cartao(lav, GOL);
  await expect(noCelular).toContainText('Sem responsável');
  await noCelular.getByRole('button', { name: 'Pegar' }).click();
  await expect(noCelular.getByRole('button')).toHaveText(['Pronto']);

  // a recepção vê sem recarregar (SSE): em lavagem, com o lavador como responsável
  const emLavagem = coluna(page, 'Em lavagem').getByRole('article').filter({ hasText: GOL });
  await expect(emLavagem).toContainText('Lavador E2E');
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Em lavagem agora');

  await noCelular.getByRole('button', { name: 'Pronto' }).click();
  await expect(noCelular.getByRole('button')).toHaveCount(0);
  const pronto = coluna(page, 'Pronto').getByRole('article').filter({ hasText: GOL });
  await expect(pronto).toBeVisible();
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Pronto para retirar');

  const aviso = new URL((await pronto.getByRole('link', { name: 'Avisar pronto' }).getAttribute('href'))!);
  expect(aviso.host + aviso.pathname).toBe('wa.me/5511977776666');
  expect(aviso.searchParams.get('text')).toContain(GOL);
  expect(aviso.searchParams.get('text')).toContain('R$ 70,00');

  await quitarOs(GOL);
  await pronto.getByRole('button', { name: 'Entregar' }).click();
  await expect(cartao(page, GOL)).toHaveCount(0);
  await expect(cartao(lav, GOL)).toHaveCount(0); // entregue sai também do celular
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Entregue');
  await expect(pub.locator('[aria-current="step"]')).toContainText('Entregue');
  for (const p of [page, pub]) expect(await marcada(p)).toBe(1); // tudo sem recarregar

  // visitante novo (outro contexto anônimo) que abre o link depois também vê Entregue
  const depois = await contexto(browser, 'publico');
  await depois.goto(link);
  await expect(depois.getByRole('heading', { level: 1 })).toHaveText('Entregue');
  for (const p of [pub, lav, depois]) await p.context().close();
});

test('OS cancelada vira somente leitura em todas as telas e ações nela são recusadas', async ({ page, browser }) => {
  await entrarRecepcao(page);
  const link = await abrirOs(page, ONIX);

  // telas paradas no estado antigo (sem SSE): os cliques chegam ao servidor depois do cancelamento
  const velha = await page.context().newPage();
  await velha.route('**/api/eventos', (r) => r.abort());
  await velha.goto('/fila');
  await expect(cartao(velha, ONIX).getByRole('button', { name: 'Direcionar' })).toBeVisible();
  const lav = await contexto(browser, 'lavador');
  await entrarNoCelular(lav);
  await expect(cartao(lav, ONIX).getByRole('button')).toHaveText(['Pegar']);
  const lavVelho = await lav.context().newPage();
  await lavVelho.route('**/api/eventos', (r) => r.abort());
  await lavVelho.goto('/lavador');
  await expect(cartao(lavVelho, ONIX).getByRole('button')).toHaveText(['Pegar']);
  const pub = await contexto(browser, 'publico');
  await pub.goto(link);
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Na fila para lavar');

  await cartao(page, ONIX).getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('Cliente desistiu');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar cancelamento' }).click();

  // somente leitura: some da fila e do celular (sem nenhum botão de ação) e o link público mostra Cancelada ao vivo
  await expect(cartao(page, ONIX)).toHaveCount(0);
  await expect(cartao(lav, ONIX)).toHaveCount(0);
  await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Cancelada');
  await expect(pub.getByText('Este serviço foi cancelado')).toBeVisible();
  await expect(pub.getByRole('button')).toHaveCount(0);

  // ações vindas das telas velhas: recusadas em português, e a tela recarrega sem a OS
  await cartao(velha, ONIX).getByRole('button', { name: 'Direcionar' }).click();
  await velha.getByRole('dialog').getByRole('button', { name: /^Lavador E2E/ }).click();
  await expect(velha.getByRole('alert').filter({ hasText: 'OS cancelada não pode ser alterada.' })).toBeVisible();
  await expect(cartao(velha, ONIX)).toHaveCount(0);
  await cartao(lavVelho, ONIX).getByRole('button', { name: 'Pegar' }).click();
  await expect(lavVelho.getByRole('alert').filter({ hasText: 'Essa OS mudou de status' })).toBeVisible();
  await expect(cartao(lavVelho, ONIX)).toHaveCount(0);

  const { rows } = await pool.query(
    `select o.status, o.responsavel_id, o.motivo_cancelamento from ordens_servico o join veiculos v on v.id = o.veiculo_id where v.placa = $1 order by o.entrada_em desc limit 1`,
    [ONIX],
  );
  expect(rows[0]).toEqual({ status: 'cancelada', responsavel_id: null, motivo_cancelamento: 'Cliente desistiu' });
  for (const p of [lav, pub]) await p.context().close();
});
