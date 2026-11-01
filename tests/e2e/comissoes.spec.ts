import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { testUrls } from '../helpers/test-db';
import { liberarCaixaDeHoje, quitarOs, semearOsPronta } from './dinheiro';
import { E2E_PILOT_SLUG } from './global-setup';
import { entrarStaff, linkDoMenu, semRolagemHorizontal, SUFIXO } from './login';

// O quitarOs abre o caixa de hoje: cada teste começa e termina sem ele, como no caixa.spec.
test.beforeEach(liberarCaixaDeHoje);
test.afterEach(liberarCaixaDeHoje);

const pool = new pg.Pool({ connectionString: testUrls.owner, max: 1 });
test.afterAll(() => pool.end());

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const ddmmaaaa = `${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`;

/** Lavador só do teste: os outros specs entregam OSs do Lavador E2E e mudariam as somas. */
async function novoLavador() {
  const nome = `Lavador Acerto ${SUFIXO()}`;
  const id = randomUUID();
  await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [id, nome, `${id}@lavador.invalid`]);
  await pool.query(`insert into membros (tenant_id, user_id, perfil, nome_exibicao) select id, $1, 'lavador', $2 from lava_jatos where slug = $3`, [id, nome, E2E_PILOT_SLUG]);
  return nome;
}

const cartao = (page: Page, placa: string) => page.getByRole('article').filter({ hasText: placa });

/** OS pronta do lavador, quitada (abre o caixa de hoje) e entregue pela fila do gerente: a entrega gera a comissão. */
async function entregar(page: Page, lavador: string, totalCentavos: number) {
  const placa = await semearOsPronta(totalCentavos, lavador);
  await quitarOs(placa);
  await page.goto('/fila');
  await cartao(page, placa).getByRole('button', { name: 'Entregar', exact: true }).click();
  await expect(cartao(page, placa)).toHaveCount(0);
  return placa;
}

async function abrirComissoes(page: Page) {
  await (await linkDoMenu(page, 'Comissões')).click();
  await expect(page.getByRole('heading', { name: 'Comissões', level: 1 })).toBeVisible();
}

async function lancarVale(page: Page, lavador: string, valor: string, doCaixa: boolean) {
  const form = page.getByRole('form', { name: 'Lançar vale' });
  await form.getByLabel('Membro').selectOption({ label: lavador });
  await form.getByLabel('Valor do vale (R$)').fill(valor);
  if (doCaixa) await form.getByLabel('Pago com dinheiro do caixa (hoje)').check();
  await form.getByRole('button', { name: 'Lançar vale' }).click();
  await expect(page.getByRole('list', { name: `Vales pendentes de ${lavador}` })).toContainText(`R$ ${valor}`);
}

/** Abre o acerto até hoje, confere a prévia e confirma. */
async function acertar(page: Page, lavador: string, previa: RegExp, doCaixa = false) {
  await page.getByRole('button', { name: `Fazer acerto de ${lavador}` }).click();
  const dialogo = page.getByRole('dialog', { name: `Acerto de ${lavador}` });
  await expect(dialogo.getByLabel('Fazer acerto até')).toHaveValue(hoje);
  await dialogo.getByRole('button', { name: 'Ver prévia' }).click();
  await expect(dialogo.getByRole('status')).toContainText(previa);
  if (doCaixa) await dialogo.getByLabel('Pago com dinheiro do caixa (hoje)').check();
  await semRolagemHorizontal(page);
  await dialogo.getByRole('button', { name: 'Confirmar acerto' }).click();
  await expect(dialogo).toHaveCount(0);
}

test('duas OSs entregues, vale da gaveta e acerto pagando a diferença; o detalhe lista as duas OSs', async ({ page }) => {
  const lavador = await novoLavador();
  await entrarStaff(page, 'gerente@e2e.test');
  await expect(page).toHaveURL('/painel');
  await entregar(page, lavador, 8000); // 30 %: R$ 24,00
  await entregar(page, lavador, 5000); // 30 %: R$ 15,00

  await abrirComissoes(page);
  const membro = page.getByRole('region', { name: lavador });
  await expect(membro).toContainText(/Comissões pendentes\s*R\$ 39,00/);
  await expect(membro).toContainText(/A pagar\s*R\$ 39,00/);
  await lancarVale(page, lavador, '10,00', true);
  await expect(membro).toContainText(/Vales pendentes\s*R\$ 10,00/);
  await expect(membro).toContainText(/A pagar\s*R\$ 29,00/);

  await acertar(page, lavador, /A pagar\s*R\$ 29,00/, true);
  await expect(membro).toContainText('Nada pendente.');
  await expect(membro).toContainText('pago R$ 29,00');
  await page.setViewportSize({ width: 360, height: 740 });
  await semRolagemHorizontal(page);

  await membro.getByRole('link', { name: `Imprimir acerto de ${ddmmaaaa} de ${lavador}` }).click();
  await expect(page.getByRole('heading', { name: `Acerto de ${lavador}`, level: 1 })).toBeVisible();
  const porOs = page.getByRole('region', { name: 'Comissões por OS' }).getByRole('listitem');
  await expect(porOs).toHaveCount(2);
  await expect(porOs.filter({ hasText: 'R$ 24,00' })).toHaveCount(1);
  await expect(porOs.filter({ hasText: 'R$ 15,00' })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Vales descontados' })).toContainText('R$ 10,00');
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible();
  await semRolagemHorizontal(page);
});

test('vale maior que a comissão deixa dívida, a OS acertada não reabre e o próximo acerto desconta a dívida', async ({ page }) => {
  const lavador = await novoLavador();
  await entrarStaff(page, 'gerente@e2e.test');
  await expect(page).toHaveURL('/painel');
  const placa = await entregar(page, lavador, 5000); // R$ 15,00

  await abrirComissoes(page);
  const membro = page.getByRole('region', { name: lavador });
  await lancarVale(page, lavador, '20,00', false);
  await expect(membro).toContainText(/Fica devendo\s*R\$ 5,00/);
  await acertar(page, lavador, /Fica devendo\s*R\$ 5,00/);
  await expect(membro).toContainText('pago R$ 0,00 · ficou devendo R$ 5,00');

  // OS já acertada: a reabertura é recusada
  await (await linkDoMenu(page, 'Fila')).click();
  await page.getByText('Entregues hoje').click();
  await page.getByRole('listitem').filter({ hasText: placa }).getByRole('button', { name: /Reabrir OS/ }).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('cliente voltou');
  await page.getByRole('dialog').getByRole('button', { name: 'Reabrir OS', exact: true }).click();
  await expect(page.getByText(`Comissão já paga no acerto de ${ddmmaaaa.slice(0, 5)}.`)).toBeVisible();

  await entregar(page, lavador, 8000); // R$ 24,00 − R$ 5,00 de dívida
  await abrirComissoes(page);
  await expect(membro).toContainText(/Saldo devedor anterior\s*R\$ 5,00/);
  await expect(membro).toContainText(/A pagar\s*R\$ 19,00/);
  await acertar(page, lavador, /A pagar\s*R\$ 19,00/);
  await expect(membro).toContainText('pago R$ 19,00');
  await expect(membro).toContainText('Nada pendente.');
});

test('recepção não tem Comissões no menu e vê "Acesso negado" em /comissoes', async ({ page }) => {
  await entrarStaff(page, 'recepcao@e2e.test');
  await expect(page).toHaveURL('/fila');
  await expect(await linkDoMenu(page, 'Comissões')).toHaveCount(0);
  await page.goto('/comissoes');
  await expect(page.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Lançar vale' })).toHaveCount(0);
});
