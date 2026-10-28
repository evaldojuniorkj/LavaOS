import { expect, test } from '@playwright/test';
import { entrarLavador, entrarStaff, pin, semRolagemHorizontal } from './login';

const PIN_INVALIDO = 'Usuário ou PIN inválidos. Após 5 erros seguidos o acesso fica bloqueado por 15 minutos.';
const PRONTA = 'Fundação pronta; operação em preparação';

test('anônimo é levado ao login, com retorno só para caminho conhecido', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/login');
  await page.goto('/configuracoes/equipe');
  await expect(page).toHaveURL('/login?next=%2Fconfiguracoes%2Fequipe');
  await entrarStaff(page, 'dono@e2e.test', undefined, page.url());
  await expect(page).toHaveURL('/configuracoes/equipe');
  await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
});

for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example/inicio', '/inicio/../api/auth/sign-out', '/api/auth/get-session']) {
  test(`retorno externo ou desconhecido vai para /inicio: ${next}`, async ({ page }) => {
    await entrarStaff(page, 'recepcao@e2e.test', undefined, `/login?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL('/inicio');
  });
}

test('labels acessíveis, teclado e foco visível no login de staff', async ({ page }) => {
  await page.goto('/login');
  await semRolagemHorizontal(page);
  await page.keyboard.press('Tab'); // grupo de modo de entrada
  await page.keyboard.press('Tab');
  const email = page.getByLabel('E-mail', { exact: true });
  await expect(email).toBeFocused();
  // foco visível: o anel não pode ser 'none'
  expect(await email.evaluate((el) => getComputedStyle(el).outlineStyle !== 'none' || getComputedStyle(el).boxShadow !== 'none')).toBe(true);
  await page.keyboard.type('recepcao@e2e.test');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Senha', { exact: true })).toBeFocused();
  await page.keyboard.type('senha-errada-123');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('E-mail ou senha inválidos.');
  await expect(page).toHaveURL('/login');
});

test('validação de campos em português antes de enviar', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Informe o e-mail.')).toBeVisible();
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByText('Usuário e PIN', { exact: true }).click(); // o rótulo é o alvo de toque do rádio
  await expect(page.getByRole('radio', { name: 'Usuário e PIN' })).toBeChecked();
  await page.getByLabel('Usuário', { exact: true }).fill('lavador.e2e');
  await page.getByLabel('PIN', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('O PIN deve ter de 4 a 6 dígitos.')).toBeVisible();
});

test('recepção entra, vê início sem equipe e sai', async ({ page }) => {
  await entrarStaff(page, 'recepcao@e2e.test');
  await expect(page).toHaveURL('/inicio');
  await expect(page.getByText(PRONTA)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Equipe' })).toHaveCount(0);
  await semRolagemHorizontal(page);
  await page.goto('/login'); // sessão válida: login devolve ao início
  await expect(page).toHaveURL('/inicio');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/login/);
});

test('lavador entra por usuário/PIN com zero inicial; erro de PIN usa a mensagem única', async ({ page }) => {
  expect(pin().startsWith('0')).toBe(true);
  await entrarLavador(page, 'lavador.e2e', '9' + pin().slice(1));
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(PIN_INVALIDO);
  await page.getByLabel('PIN', { exact: true }).fill(pin());
  await expect(page.getByLabel('PIN', { exact: true })).toHaveValue(pin()); // zero inicial preservado
  await expect(page.getByLabel('PIN', { exact: true })).toHaveAttribute('inputmode', 'numeric');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL('/inicio');
  await expect(page.getByText(PRONTA)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Equipe' })).toHaveCount(0);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain(pin());
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL('/login');
});

test('staff com dois lava jatos escolhe um antes de entrar', async ({ page }) => {
  await entrarStaff(page, 'multi@e2e.test');
  await expect(page.getByRole('heading', { name: 'Escolha o lava jato' })).toBeVisible();
  await page.getByRole('button', { name: 'Lava Jato E2E B' }).click();
  await expect(page).toHaveURL('/inicio');
  await expect(page.getByText('(Gerente)')).toBeVisible(); // perfil do vínculo escolhido, vindo do servidor
  await expect(page.getByRole('link', { name: 'Equipe' })).toBeVisible();
});
