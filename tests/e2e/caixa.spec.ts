import { expect, test, type Page } from '@playwright/test';
import { liberarCaixaDeHoje, semearOsPronta } from './dinheiro';
import { entrarStaff, semRolagemHorizontal } from './login';

// O banco é compartilhado: cada teste começa sem caixa hoje e, no fim, deixa o quitarOs dos outros specs abrir o dele.
test.beforeEach(liberarCaixaDeHoje);
test.afterEach(liberarCaixaDeHoje);

const cartao = (page: Page, placa: string) => page.getByRole('article').filter({ hasText: placa });
const forma = (page: Page, nome: string) => page.getByRole('region', { name: 'Recebido por forma' }).getByRole('listitem').filter({ hasText: nome });

test('recepção abre o caixa, recebe Pix + dinheiro com troco, entrega e fecha sem diferença', async ({ page }) => {
  const placa = await semearOsPronta(8000);
  await entrarStaff(page, 'recepcao@e2e.test');
  await expect(page).toHaveURL('/fila');

  await page.getByRole('link', { name: 'Caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum caixa aberto hoje' })).toBeVisible();
  await page.getByLabel('Troco inicial (R$)').fill('100,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Esperado em dinheiro na gaveta: R$ 100,00')).toBeVisible();

  await page.getByRole('link', { name: 'Fila' }).click();
  await expect(cartao(page, placa)).toContainText('R$ 80,00');
  await expect(cartao(page, placa).getByRole('button', { name: 'Entregar', exact: true })).toHaveCount(0); // só quitada
  await cartao(page, placa).getByRole('button', { name: 'Receber', exact: true }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Pix').check();
  await dialogo.getByLabel('Valor (R$)').fill('30,00');
  await dialogo.getByRole('button', { name: 'Receber', exact: true }).click();
  await expect(cartao(page, placa)).toContainText('Pago R$ 30,00 de R$ 80,00');

  await cartao(page, placa).getByRole('button', { name: 'Receber e entregar' }).click();
  await expect(dialogo.getByLabel('Valor (R$)')).toHaveValue('50,00'); // sugere o saldo
  await expect(dialogo.getByLabel('Dinheiro')).toBeChecked();
  await dialogo.getByLabel('Recebido do cliente (R$)').fill('100');
  await expect(dialogo.getByText('Troco: R$ 50,00')).toBeVisible();
  await semRolagemHorizontal(page);
  await dialogo.getByRole('button', { name: 'Receber e entregar' }).click();
  await expect(cartao(page, placa)).toHaveCount(0);
  await page.getByText('Entregues hoje').click();
  const entregue = page.getByRole('listitem').filter({ hasText: placa });
  await expect(entregue).toContainText('R$ 80,00');
  await expect(entregue.getByRole('button', { name: /Reabrir/ })).toHaveCount(0); // reabrir é da gerência

  await page.getByRole('link', { name: 'Caixa' }).click();
  await expect(forma(page, 'Pix')).toContainText('R$ 30,00');
  await expect(forma(page, 'Dinheiro')).toContainText('R$ 50,00');
  await expect(page.getByRole('region', { name: 'Pagamentos' }).getByRole('listitem')).toHaveCount(2);
  await page.getByLabel('Dinheiro contado na gaveta (R$)').fill('150,00');
  await page.getByRole('button', { name: 'Conferir' }).click();
  await expect(page.getByText('Diferença: R$ 0,00')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar fechamento' }).click();
  await expect(page.getByRole('region', { name: /Fechamento/ })).toContainText('Diferença: R$ 0,00');
  await expect(page.getByText(/^Fechado ·/)).toBeVisible();

  await page.setViewportSize({ width: 360, height: 740 });
  await semRolagemHorizontal(page);
  await page.goto('/fila');
  await semRolagemHorizontal(page);
});

test('em 360 px o dono vê 4 abas + Mais, e o Mais lista o resto', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await entrarStaff(page, 'dono@e2e.test');
  await expect(page).toHaveURL('/painel');
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link')).toHaveText(['Painel', 'Fila', 'Nova OS', 'Caixa']);
  await semRolagemHorizontal(page);
  await nav.getByRole('button', { name: 'Mais' }).click();
  await expect(nav.getByRole('link')).toHaveText(['Painel', 'Fila', 'Nova OS', 'Caixa', 'Despesas', 'Clientes', 'Equipe', 'Catálogo']);
  await semRolagemHorizontal(page);
  await nav.getByRole('link', { name: 'Catálogo' }).click();
  await expect(page).toHaveURL('/configuracoes/catalogo');
  await expect(nav.getByRole('button', { name: 'Mais' })).toHaveAttribute('aria-current', 'page');
});
