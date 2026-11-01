import { expect, test, type Page } from '@playwright/test';
import { liberarCaixaDeHoje } from './dinheiro';
import { entrarStaff, linkDoMenu, semRolagemHorizontal, SUFIXO } from './login';

// Mesmo cuidado do caixa.spec: cada teste começa sem caixa hoje e não deixa o seu no caminho dos outros specs.
test.beforeEach(liberarCaixaDeHoje);
test.afterEach(liberarCaixaDeHoje);

const diaSP = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const ddmm = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

async function abrirDespesas(page: Page) {
  await (await linkDoMenu(page, 'Despesas')).click();
  await expect(page.getByRole('heading', { name: 'Despesas', level: 1 })).toBeVisible();
}

async function lancar(page: Page, { categoria, descricao, valor }: { categoria: string; descricao: string; valor: string }) {
  const form = page.getByRole('form', { name: 'Lançar despesa' });
  await form.getByLabel('Categoria').selectOption({ label: categoria });
  await form.getByLabel('Descrição').fill(descricao);
  await form.getByLabel('Valor (R$)').fill(valor);
  return form;
}

test('gerente lança conta vencida ontem e marca como paga', async ({ page }) => {
  await entrarStaff(page, 'gerente@e2e.test');
  await expect(page).toHaveURL('/painel');
  await abrirDespesas(page);
  const descricao = `Conta de luz ${SUFIXO()}`;
  const ontem = diaSP(new Date(Date.now() - 86_400_000));
  const form = await lancar(page, { categoria: 'Água e luz', descricao, valor: '45,00' });
  await expect(form.getByLabel(/Paga com dinheiro do caixa/)).toHaveCount(0); // sem caixa aberto hoje
  await form.getByLabel('A pagar').check();
  await form.getByLabel('Vencimento').fill(ontem);
  await form.getByRole('button', { name: 'Lançar despesa' }).click();

  const conta = page.getByRole('region', { name: 'Contas a pagar' }).getByRole('listitem').filter({ hasText: descricao });
  await expect(conta).toContainText(`Vencida em ${ddmm(ontem)}`);
  await expect(conta).toContainText('R$ 45,00');
  await semRolagemHorizontal(page);
  await conta.getByRole('button', { name: `Marcar ${descricao} como paga` }).click();
  await expect(conta).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Despesas do mês' }).getByRole('listitem').filter({ hasText: descricao })).toContainText(`Paga em ${ddmm(diaSP(new Date()))}`);

  await page.setViewportSize({ width: 360, height: 740 });
  await semRolagemHorizontal(page);
});

test('vale pago com dinheiro do caixa vira saída e baixa o esperado na gaveta', async ({ page }) => {
  await entrarStaff(page, 'gerente@e2e.test');
  await expect(page).toHaveURL('/painel');
  await (await linkDoMenu(page, 'Caixa')).click();
  await page.getByLabel('Troco inicial (R$)').fill('100,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Esperado em dinheiro na gaveta: R$ 100,00')).toBeVisible();

  await abrirDespesas(page);
  const descricao = `Vale Lavador ${SUFIXO()}`;
  const form = await lancar(page, { categoria: 'Vales', descricao, valor: '20' });
  await form.getByLabel(/Paga com dinheiro do caixa/).check();
  await expect(form.getByLabel('Data do pagamento')).toHaveCount(0); // do caixa é sempre hoje
  await form.getByRole('button', { name: 'Lançar despesa' }).click();
  await expect(page.getByRole('region', { name: 'Despesas do mês' }).getByRole('listitem').filter({ hasText: descricao })).toContainText('com dinheiro do caixa');

  await (await linkDoMenu(page, 'Caixa')).click();
  await expect(page.getByRole('region', { name: 'Saídas do caixa' }).getByRole('listitem').filter({ hasText: descricao })).toContainText('R$ 20,00');
  await expect(page.getByText('Esperado em dinheiro na gaveta: R$ 80,00')).toBeVisible();
});

test('recepção não tem Despesas no menu e vê "Acesso negado" em /despesas', async ({ page }) => {
  await entrarStaff(page, 'recepcao@e2e.test');
  await expect(page).toHaveURL('/fila');
  await expect(await linkDoMenu(page, 'Despesas')).toHaveCount(0);
  await page.goto('/despesas');
  await expect(page.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Lançar despesa' })).toHaveCount(0);
});
