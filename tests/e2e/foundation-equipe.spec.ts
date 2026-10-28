import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrarLavador, entrarStaff, semRolagemHorizontal, senha, SUFIXO } from './login';

const PIN_INVALIDO = 'Usuário ou PIN inválidos. Após 5 erros seguidos o acesso fica bloqueado por 15 minutos.';
const SESSAO_ENCERRADA = 'Sua sessão terminou ou o acesso foi removido. Entre novamente.';

async function abrirEquipeComoDono(page: Page) {
  await entrarStaff(page, 'dono@e2e.test', senha(), '/login?next=%2Fconfiguracoes%2Fequipe');
  await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible();
}

async function cadastrar(page: Page, campos: { perfil: string; nome: string } & Record<string, string>) {
  const form = page.getByRole('form', { name: 'Novo membro' });
  await form.getByLabel('Perfil').selectOption({ label: campos.perfil });
  await form.getByLabel('Nome de exibição').fill(campos.nome);
  for (const [label, valor] of Object.entries(campos)) {
    if (label !== 'perfil' && label !== 'nome') await form.getByLabel(label, { exact: true }).fill(valor);
  }
  await form.getByRole('button', { name: 'Cadastrar membro' }).click();
}

const linha = (page: Page, nome: string) => page.getByRole('listitem').filter({ hasText: nome });

/** Segundo contexto (cookies separados) com as opções do mesmo projeto: viewport, dispositivo e x-real-ip. */
async function novoContexto(browser: Browser) {
  const opcoes: Record<string, unknown> = { ...test.info().project.use };
  delete opcoes.defaultBrowserType;
  return (await browser.newContext(opcoes)).newPage();
}

test('dono vê equipe, cadastra lavador e recepção; nada de segredo no HTML', async ({ page }) => {
  await abrirEquipeComoDono(page);
  await expect(page.getByRole('link', { name: 'Equipe' })).toBeVisible();
  await semRolagemHorizontal(page);
  for (const nome of ['Dono E2E', 'Gerente E2E', 'Recepcao E2E', 'Lavador E2E']) await expect(linha(page, nome)).toBeVisible();

  const s = SUFIXO();
  await cadastrar(page, { perfil: 'Recepção', nome: `Recep ${s}`, 'E-mail': `recep.${s}@e2e.test`, Senha: 'curta' });
  await expect(page.getByText('A senha deve ter de 8 a 128 caracteres.')).toBeVisible(); // erro junto ao campo, vindo do servidor
  const senhaNova = `senha-${crypto.randomUUID()}`;
  await page.getByRole('form', { name: 'Novo membro' }).getByLabel('Senha', { exact: true }).fill(senhaNova);
  await page.getByRole('button', { name: 'Cadastrar membro' }).click();
  await expect(linha(page, `Recep ${s}`)).toBeVisible();

  await cadastrar(page, { perfil: 'Lavador', nome: `Lav ${s}`, Usuário: `lav.${s}`, PIN: '0456' });
  await expect(linha(page, `Lav ${s}`)).toContainText('Lavador');
  const html = await (await page.request.get('/configuracoes/equipe')).text();
  expect(html).not.toContain(senhaNova);
  expect(html).not.toContain('pinHash');
  expect(html).not.toMatch(/\$scrypt|[0-9a-f]{32}:[0-9a-f]{64,}/); // formato salt:hash do scrypt
});

test('gerente vê equipe só com perfis que pode cadastrar e sem ações sobre o dono', async ({ page }) => {
  await entrarStaff(page, 'gerente@e2e.test');
  await page.getByRole('link', { name: 'Equipe' }).click();
  await expect(page).toHaveURL('/configuracoes/equipe');
  const opcoes = await page.getByLabel('Perfil').locator('option').allTextContents();
  expect(opcoes).toEqual(['Recepção', 'Lavador']);
  await expect(linha(page, 'Dono E2E').getByRole('button')).toHaveCount(0);
});

for (const perfil of ['recepcao', 'lavador'] as const) {
  test(`${perfil} não recebe a equipe nem por navegação direta`, async ({ page }) => {
    if (perfil === 'lavador') {
      await entrarLavador(page, 'lavador.e2e', process.env.E2E_PIN!);
    } else {
      await entrarStaff(page, 'recepcao@e2e.test');
    }
    await expect(page).toHaveURL('/inicio');
    await expect(page.getByRole('link', { name: 'Equipe' })).toHaveCount(0);
    await page.goto('/configuracoes/equipe');
    await expect(page.getByRole('heading', { name: 'Acesso negado' })).toBeVisible();
    for (const r of [await page.request.get('/configuracoes/equipe'), await page.request.get('/configuracoes/equipe', { headers: { RSC: '1' } })]) {
      const body = await r.text();
      expect(body).not.toContain('Dono E2E');
      expect(body).not.toContain('Gerente E2E');
    }
  });
}

test('reset de PIN derruba a sessão do lavador e só o PIN novo entra', async ({ page, browser }) => {
  await abrirEquipeComoDono(page);
  const s = SUFIXO();
  await cadastrar(page, { perfil: 'Lavador', nome: `Reset ${s}`, Usuário: `reset.${s}`, PIN: '0111' });
  await expect(linha(page, `Reset ${s}`)).toBeVisible();

  const lav = await novoContexto(browser);
  await entrarLavador(lav, `reset.${s}`, '0111');
  await expect(lav).toHaveURL('/inicio');

  await linha(page, `Reset ${s}`).getByRole('button', { name: 'Redefinir PIN' }).click();
  await linha(page, `Reset ${s}`).getByLabel('Novo PIN').fill('0222');
  await linha(page, `Reset ${s}`).getByRole('button', { name: 'Salvar PIN' }).click();
  await expect(page.getByRole('status')).toContainText('PIN redefinido.');

  await lav.goto('/inicio');
  await expect(lav).toHaveURL(/\/login/);
  await entrarLavador(lav, `reset.${s}`, '0111');
  await expect(lav.getByRole('main').getByRole('alert')).toHaveText(PIN_INVALIDO);
  await lav.getByLabel('PIN', { exact: true }).fill('0222');
  await lav.getByRole('button', { name: 'Entrar' }).click();
  await expect(lav).toHaveURL('/inicio');
  await lav.context().close();
});

test('bloqueio após 5 erros mostra a mesma mensagem, inclusive com o PIN certo', async ({ page, browser }) => {
  await abrirEquipeComoDono(page);
  const s = SUFIXO();
  await cadastrar(page, { perfil: 'Lavador', nome: `Bloq ${s}`, Usuário: `bloq.${s}`, PIN: '0333' });
  await expect(linha(page, `Bloq ${s}`)).toBeVisible();
  const lav = await novoContexto(browser);
  await entrarLavador(lav, `bloq.${s}`, '9999');
  for (let i = 0; i < 4; i++) {
    await expect(lav.getByRole('main').getByRole('alert')).toHaveText(PIN_INVALIDO);
    await lav.getByRole('button', { name: 'Entrar' }).click();
  }
  await lav.getByLabel('PIN', { exact: true }).fill('0333');
  await lav.getByRole('button', { name: 'Entrar' }).click();
  await expect(lav.getByRole('main').getByRole('alert')).toHaveText(PIN_INVALIDO);
  await expect(lav).toHaveURL('/login');
  await lav.context().close();
});

test('membro desativado no segundo contexto perde action e navegação no primeiro', async ({ page, browser }) => {
  await abrirEquipeComoDono(page);
  const s = SUFIXO();
  const senhaG = `senha-${crypto.randomUUID()}`;
  await cadastrar(page, { perfil: 'Gerente', nome: `Ger ${s}`, 'E-mail': `ger.${s}@e2e.test`, Senha: senhaG });
  await expect(linha(page, `Ger ${s}`)).toBeVisible();

  const ger = await novoContexto(browser);
  await entrarStaff(ger, `ger.${s}@e2e.test`, senhaG, '/login?next=%2Fconfiguracoes%2Fequipe');
  await expect(ger.getByRole('heading', { name: 'Equipe' })).toBeVisible();

  // confirmação contextual
  await linha(page, `Ger ${s}`).getByRole('button', { name: 'Desativar' }).click();
  await expect(linha(page, `Ger ${s}`)).toContainText(`Desativar Ger ${s}?`);
  await linha(page, `Ger ${s}`).getByRole('button', { name: 'Cancelar' }).click();
  await expect(linha(page, `Ger ${s}`)).not.toContainText('Inativo');
  await linha(page, `Ger ${s}`).getByRole('button', { name: 'Desativar' }).click();
  await linha(page, `Ger ${s}`).getByRole('button', { name: 'Confirmar desativação' }).click();
  await expect(linha(page, `Ger ${s}`)).toContainText('Inativo');

  // mesma aba, mesmo cookie: a action seguinte é negada no servidor
  await cadastrar(ger, { perfil: 'Lavador', nome: `Nunca ${s}`, Usuário: `nunca.${s}`, PIN: '1234' });
  await expect(ger.getByRole('main').getByRole('alert')).toHaveText('acesso negado');
  await ger.goto('/configuracoes/equipe');
  await expect(ger).toHaveURL('/login?motivo=sessao');
  await expect(ger.getByText(SESSAO_ENCERRADA)).toBeVisible();
  await expect(linha(page, `Nunca ${s}`)).toHaveCount(0);
  await ger.context().close();
});
