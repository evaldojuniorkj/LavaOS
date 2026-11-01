import { expect, type Page } from '@playwright/test';

/** Segredos criados pelo global-setup desta execução. */
export const senha = () => process.env.E2E_SENHA!;
export const pin = () => process.env.E2E_PIN!;
export const SUFIXO = () => crypto.randomUUID().slice(0, 8);

export async function entrarStaff(page: Page, email: string, pass = senha(), path = '/login') {
  await page.goto(path);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

export async function entrarLavador(page: Page, usuario: string, p: string) {
  await page.goto('/login');
  await page.getByText('Usuário e PIN', { exact: true }).click(); // o rótulo é o alvo de toque do rádio
  await expect(page.getByRole('radio', { name: 'Usuário e PIN' })).toBeChecked();
  await page.getByLabel('Usuário', { exact: true }).fill(usuario);
  await page.getByLabel('PIN', { exact: true }).fill(p);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

export async function semRolagemHorizontal(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
}

/** Link do menu principal; no celular, com mais de 5 itens, os além da 4ª aba ficam em "Mais". */
export async function linkDoMenu(page: Page, nome: string) {
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav).toBeVisible();
  const mais = nav.getByRole('button', { name: 'Mais' });
  if ((await mais.isVisible()) && (await mais.getAttribute('aria-expanded')) !== 'true') await mais.click();
  return nav.getByRole('link', { name: nome });
}
