import { expect, test } from '@playwright/test';
import pg from 'pg';
import { testUrls } from '../helpers/test-db';
import { E2E_ONBOARDING } from './global-setup';
import { semRolagemHorizontal } from './login';

// Roda no servidor do assistente (baseURL = porta do onboarding, schema sem as fixtures); o principal fica sem token.
const PRINCIPAL = 'http://localhost:3100';
const { schema, token } = E2E_ONBOARDING;

async function sql(q: string) {
  const c = new pg.Client({ connectionString: testUrls.owner });
  await c.connect();
  try {
    await c.query(`SET search_path TO ${schema}`);
    await c.query(q);
  } finally {
    await c.end();
  }
}

test('assistente cria o lava jato e o dono, que entra pelo login; e o link do assistente some', async ({ page }) => {
  await sql('TRUNCATE lava_jatos, "user" CASCADE'); // cada projeto começa do sistema vazio
  const email = `dono-${crypto.randomUUID().slice(0, 8)}@e2e.test`;
  const senha = `senha-${crypto.randomUUID()}`;

  await page.goto('/login');
  await page.getByRole('link', { name: 'Primeiro acesso' }).click();
  await expect(page).toHaveURL('/primeiro-acesso');
  await expect(page.getByRole('heading', { name: 'Primeiro acesso' })).toBeVisible();
  await semRolagemHorizontal(page);

  await page.getByLabel('Nome do lava jato').fill('Lava Jato Novo');
  await page.getByLabel('Telefone (opcional)').fill('(11) 98888-7777');
  await page.getByLabel('Seu nome').fill('Dona Nova');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('curta');
  await page.getByLabel('Confirme a senha').fill('curta');
  await page.getByLabel('Código de instalação').fill('codigo-errado-0000');
  await page.getByRole('button', { name: 'Cadastrar lava jato' }).click();
  await expect(page.getByText('A senha deve ter de 8 a 128 caracteres.')).toBeVisible();
  await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirme a senha').fill(senha);
  await page.getByRole('button', { name: 'Cadastrar lava jato' }).click();
  await expect(page.getByText('Código de instalação inválido.')).toBeVisible();
  await expect(page.getByLabel('Código de instalação')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Código de instalação').fill(token);
  await page.getByRole('button', { name: 'Cadastrar lava jato' }).click();
  await expect(page).toHaveURL('/login?motivo=cadastro');
  await expect(page.getByRole('status')).toContainText('Cadastro concluído, entre com seu e-mail.');
  await expect(page.getByRole('status')).toContainText('Configurações > Catálogo');
  await expect(page.getByRole('link', { name: 'Primeiro acesso' })).toHaveCount(0);

  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL('/painel'); // o dono começa no painel
});

test('com lava jato cadastrado, /primeiro-acesso redireciona ao login e o link não aparece', async ({ page }) => {
  await sql(`INSERT INTO lava_jatos (nome, slug) VALUES ('Existente', 'e2e') ON CONFLICT (slug) DO NOTHING`);
  await page.goto('/primeiro-acesso');
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('link', { name: 'Primeiro acesso' })).toHaveCount(0);
});

test('sem LAVAOS_SETUP_TOKEN o assistente responde 404 e o login não oferece o link', async ({ page }) => {
  const r = await page.goto(`${PRINCIPAL}/primeiro-acesso`);
  expect(r?.status()).toBe(404);
  await page.goto(`${PRINCIPAL}/login`);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Primeiro acesso' })).toHaveCount(0);
});
