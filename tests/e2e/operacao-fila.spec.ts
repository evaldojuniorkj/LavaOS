import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrarLavador, entrarStaff, pin, semRolagemHorizontal } from './login';

// Catálogo, veículo existente e o segundo lavador vêm do global-setup.
const PLACA_EXISTENTE = 'EXS1A23';

async function novoContexto(browser: Browser) {
  const opcoes: Record<string, unknown> = { ...test.info().project.use };
  delete opcoes.defaultBrowserType;
  return (await browser.newContext(opcoes)).newPage();
}

/** Placa Mercosul aleatória (AAA9A99): cada teste e projeto usa a sua. */
function placaNova() {
  const l = () => 'ABCDEFGHJKLMNPRTUVWXYZ'[Math.floor(Math.random() * 22)];
  const d = () => String(Math.floor(Math.random() * 10));
  return `${l()}${l()}${l()}${d()}${l()}${d()}${d()}`;
}

/** Entra e espera chegar à fila (início = /fila) antes de navegar. */
async function entrar(page: Page, email: string) {
  await entrarStaff(page, email);
  await expect(page).toHaveURL('/fila');
}

const coluna = (page: Page, nome: 'Aguardando' | 'Em lavagem' | 'Pronto') => page.getByRole('region', { name: nome });
const cartao = (page: Page, placa: string) => page.getByRole('article').filter({ hasText: placa });

/** Abre uma OS de placa nova (porte Pequeno, Lavagem completa) pela Nova OS e volta para a fila. */
async function abrirOsNova(page: Page, placa = placaNova()) {
  await page.goto('/nova-os');
  await page.getByLabel('Placa', { exact: true }).fill(placa);
  await page.getByRole('button', { name: 'Buscar placa' }).click();
  await expect(page.getByText('Placa nova')).toBeVisible();
  await page.getByLabel('Porte', { exact: true }).selectOption({ label: 'Pequeno' });
  await page.getByRole('checkbox', { name: /Lavagem completa/ }).check();
  await page.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(page).toHaveURL('/fila');
  await expect(cartao(page, placa)).toBeVisible();
  return placa;
}

async function cancelar(page: Page, placa: string) {
  await cartao(page, placa).getByRole('button', { name: 'Cancelar' }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Motivo').fill('limpeza do teste');
  await dialogo.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(cartao(page, placa)).toHaveCount(0);
}

test('recepção abre OS pela placa nova, escolhe porte e serviços', async ({ page }) => {
  await entrar(page, 'recepcao@e2e.test');
  await page.getByRole('link', { name: 'Nova OS' }).click();
  await expect(page.getByRole('heading', { name: 'Nova OS' })).toBeVisible();
  await semRolagemHorizontal(page);
  const placa = placaNova();
  await page.getByLabel('Placa', { exact: true }).fill(`${placa.slice(0, 3).toLowerCase()}-${placa.slice(3)}`);
  await page.getByRole('button', { name: 'Buscar placa' }).click();
  await expect(page.getByText('Placa nova')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(page.getByText('Escolha o porte.')).toBeVisible();
  await expect(page.getByLabel('Porte', { exact: true })).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Porte', { exact: true }).selectOption({ label: 'Pequeno' });
  const principal = page.getByRole('checkbox', { name: /Lavagem completa/ });
  await expect(page.getByText('R$ 50,00')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Cera/ })).toHaveCount(0); // adicional só depois do principal
  await principal.check();
  await page.getByRole('checkbox', { name: /Cera/ }).check();
  await page.getByLabel('Modelo').fill('Gol E2E');
  await page.getByLabel('Nome do cliente').fill('Cliente Novo E2E');
  await page.getByLabel('WhatsApp').fill('123');
  await page.getByRole('button', { name: 'Abrir OS' }).click();
  await expect(page.getByText('Telefone inválido. Use DDD + número.')).toBeVisible();
  await page.getByLabel('WhatsApp').fill('(11) 98888-7777');
  await page.getByRole('button', { name: 'Abrir OS' }).click();

  await expect(page).toHaveURL('/fila');
  const c = coluna(page, 'Aguardando').getByRole('article').filter({ hasText: placa });
  await expect(c).toContainText('Gol E2E');
  await expect(c).toContainText('Lavagem completa');
  await expect(c).toContainText('Cera');
  await expect(c).toContainText('Sem responsável');
  await expect(c).toContainText('R$ 70,00');
  await cancelar(page, placa);
});

test('placa existente preenche modelo e porte', async ({ page }) => {
  await entrar(page, 'recepcao@e2e.test');
  await page.goto('/nova-os');
  await page.getByLabel('Placa', { exact: true }).fill('exs-1a23');
  await page.getByRole('button', { name: 'Buscar placa' }).click();
  const achado = page.getByRole('region', { name: 'Veículo encontrado' });
  await expect(achado).toContainText('Fusca E2E');
  await expect(achado).toContainText('Grande');
  await expect(achado).toContainText('Cliente Existente E2E');
  await expect(page.getByLabel('Porte', { exact: true })).toHaveCount(0); // nada a cadastrar
  await expect(page.getByText('R$ 80,00')).toBeVisible(); // preço do porte do veículo
});

test('fila mostra colunas Aguardando | Em lavagem | Pronto', async ({ page }) => {
  await entrar(page, 'recepcao@e2e.test');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([/^Aguardando/, /^Em lavagem/, /^Pronto/]);
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link')).toHaveText(['Fila', 'Nova OS', 'Clientes']);
  await semRolagemHorizontal(page);
});

test('segunda aba vê a OS aparecer sem recarregar', async ({ page, browser }) => {
  await entrar(page, 'recepcao@e2e.test');
  const ger = await novoContexto(browser);
  await entrar(ger, 'gerente@e2e.test');
  await ger.evaluate(() => ((window as { marca?: number }).marca = 1)); // some se a página recarregar
  await page.evaluate(() => ((window as { marca?: number }).marca = 1));

  const placa = await abrirOsNova(page);
  await page.evaluate(() => ((window as { marca?: number }).marca = 1));
  await expect(coluna(ger, 'Aguardando').getByRole('article').filter({ hasText: placa })).toBeVisible();
  await cartao(ger, placa).getByRole('button', { name: 'Pegar' }).click();
  await expect(coluna(page, 'Em lavagem').getByRole('article').filter({ hasText: placa })).toContainText('Gerente E2E');
  await cartao(ger, placa).getByRole('button', { name: 'Marcar pronto' }).click();
  await expect(coluna(page, 'Pronto').getByRole('article').filter({ hasText: placa })).toBeVisible();
  await cartao(page, placa).getByRole('button', { name: 'Entregar' }).click();
  await expect(cartao(ger, placa)).toHaveCount(0);
  for (const p of [page, ger]) expect(await p.evaluate(() => (window as { marca?: number }).marca)).toBe(1);
  await ger.context().close();
});

test('conflito mostra mensagem e recarrega', async ({ page, browser }) => {
  await entrar(page, 'recepcao@e2e.test');
  const placa = await abrirOsNova(page);
  const dono = await novoContexto(browser);
  const ger = await novoContexto(browser);
  for (const [p, email] of [[dono, 'dono@e2e.test'], [ger, 'gerente@e2e.test']] as const) {
    await p.route('**/api/eventos', (r) => r.abort()); // tela parada no estado antigo: o clique chega com `esperado` velho
    await entrar(p, email);
    await expect(cartao(p, placa).getByRole('button', { name: 'Pegar' })).toBeVisible();
  }
  await Promise.all([cartao(dono, placa).getByRole('button', { name: 'Pegar' }).click(), cartao(ger, placa).getByRole('button', { name: 'Pegar' }).click()]);
  for (const p of [dono, ger]) await expect(coluna(p, 'Em lavagem').getByRole('article').filter({ hasText: placa })).toBeVisible(); // as duas recarregaram
  const alertas = [dono.getByRole('alert').filter({ hasText: 'Essa OS já foi pega por Gerente E2E' }), ger.getByRole('alert').filter({ hasText: 'Essa OS já foi pega por Dono E2E' })];
  await expect.poll(async () => (await alertas[0].count()) + (await alertas[1].count())).toBe(1); // um vence, o outro vê o conflito
  await dono.context().close();
  await ger.context().close();
  await page.reload();
  await cancelar(page, placa);
});

test('recepção não vê botão Pegar', async ({ page }) => {
  await entrar(page, 'recepcao@e2e.test');
  const placa = await abrirOsNova(page);
  const c = cartao(page, placa);
  await expect(c.getByRole('button', { name: 'Iniciar lavagem' })).toBeVisible();
  await expect(c.getByRole('button', { name: 'Direcionar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pegar' })).toHaveCount(0);
  await cancelar(page, placa);
});

test('ao direcionar, a lista de lavadores mostra livre/ocupado, destaca o sugerido e permite escolher outro ou deixar sem responsável', async ({ page }) => {
  await entrar(page, 'gerente@e2e.test');
  const ocupada = await abrirOsNova(page);
  await cartao(page, ocupada).getByRole('button', { name: 'Iniciar lavagem' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Lavador E2E/ }).click();
  await expect(coluna(page, 'Em lavagem').getByRole('article').filter({ hasText: ocupada })).toContainText('Lavador E2E');

  const placa = await abrirOsNova(page);
  await cartao(page, placa).getByRole('button', { name: 'Direcionar' }).click();
  const dialogo = page.getByRole('dialog', { name: /Direcionar/ });
  await expect(dialogo.getByRole('button', { name: /^Lavador E2E/ })).toContainText('Ocupado');
  await expect(dialogo.getByRole('button', { name: /^Lavador Dois E2E/ })).toContainText('Livre');
  await expect(dialogo.getByRole('button', { name: /Sugerido/ })).toHaveCount(1);
  await expect(dialogo.getByRole('button', { name: /Sugerido/ })).toContainText('Lavador Dois E2E');
  await semRolagemHorizontal(page);
  await dialogo.getByRole('button', { name: /^Lavador E2E/ }).click(); // outro que não o sugerido, mesmo ocupado
  await expect(cartao(page, placa)).toContainText('Lavador E2E');
  await expect(coluna(page, 'Aguardando').getByRole('article').filter({ hasText: placa })).toBeVisible();

  await cartao(page, placa).getByRole('button', { name: 'Trocar responsável' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sem responsável' }).click();
  await expect(cartao(page, placa)).toContainText('Sem responsável');
  await cancelar(page, placa);
  await cancelar(page, ocupada);
});

test('gerente edita a OS: adiciona serviço e dá desconto; o total vem do servidor', async ({ page }) => {
  await entrar(page, 'gerente@e2e.test');
  const placa = await abrirOsNova(page);
  await expect(cartao(page, placa)).toContainText('R$ 50,00');
  await cartao(page, placa).getByRole('button', { name: 'Editar' }).click();
  const dialogo = page.getByRole('dialog', { name: /Editar OS/ });
  await dialogo.getByLabel('Adicionar serviço').selectOption({ label: 'Cera' });
  await dialogo.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(dialogo).toContainText('Total: R$ 70,00');
  await dialogo.getByLabel('Desconto (R$)').fill('abc');
  await dialogo.getByRole('button', { name: 'Salvar valores' }).click();
  await expect(dialogo.getByText('Informe em R$, por exemplo 5,00.')).toBeVisible();
  await dialogo.getByLabel('Desconto (R$)').fill('10');
  await dialogo.getByRole('button', { name: 'Salvar valores' }).click();
  await expect(dialogo).toContainText('Total: R$ 60,00');
  await page.keyboard.press('Escape');
  await expect(cartao(page, placa)).toContainText('R$ 60,00');
  await expect(cartao(page, placa)).toContainText('Cera');
  await cancelar(page, placa);
});

test('cancelar exige motivo', async ({ page }) => {
  await entrar(page, 'recepcao@e2e.test');
  const placa = await abrirOsNova(page);
  await cartao(page, placa).getByRole('button', { name: 'Cancelar' }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(dialogo.getByText('Informe o motivo.')).toBeVisible();
  await expect(dialogo.getByLabel('Motivo')).toHaveAttribute('aria-invalid', 'true');
  await dialogo.getByRole('button', { name: 'Voltar' }).click();
  await expect(cartao(page, placa)).toBeVisible();
  await cancelar(page, placa);
});

test('lavador não recebe nenhum R$ na fila nem na Nova OS', async ({ page, browser }) => {
  const rec = await novoContexto(browser);
  await entrar(rec, 'recepcao@e2e.test');
  const placa = await abrirOsNova(rec);
  await expect(cartao(rec, placa)).toContainText('R$');

  await entrarLavador(page, 'lavador.e2e', pin());
  await expect(page).toHaveURL('/fila');
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link')).toHaveText(['Fila', 'Nova OS']);
  await expect(cartao(page, placa)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('R$');
  await cartao(page, placa).getByRole('button', { name: 'Pegar' }).click();
  await expect(coluna(page, 'Em lavagem').getByRole('article').filter({ hasText: placa })).toContainText('Lavador E2E');
  await cartao(page, placa).getByRole('button', { name: 'Marcar pronto' }).click();
  await expect(coluna(page, 'Pronto').getByRole('article').filter({ hasText: placa })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('R$');

  await page.goto('/nova-os');
  await page.getByLabel('Placa', { exact: true }).fill(PLACA_EXISTENTE);
  await page.getByRole('button', { name: 'Buscar placa' }).click();
  await expect(page.getByRole('region', { name: 'Veículo encontrado' })).toContainText('Cliente Existente E2E');
  await expect(page.getByRole('checkbox', { name: /Lavagem completa/ })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('R$');
  await semRolagemHorizontal(page);
  for (const rota of ['/fila', '/nova-os']) {
    for (const r of [await page.request.get(rota), await page.request.get(rota, { headers: { RSC: '1' } })]) {
      const body = await r.text();
      expect(body, rota).toContain('Lavagem completa'); // controle: a resposta tem os dados da tela
      for (const proibido of ['R$', 'Centavos', 'tokenPublico']) expect(body, `${rota} ${proibido}`).not.toContain(proibido);
    }
  }
  await rec.reload();
  await cartao(rec, placa).getByRole('button', { name: 'Entregar' }).click();
  await expect(cartao(rec, placa)).toHaveCount(0);
  await rec.context().close();
});

test('fechar o navegador derruba a assinatura SSE no servidor', async ({ browser, request }) => {
  // endpoint só existe em LAVAOS_MODE=test (404 nos demais modos)
  const assinantes = async () => (await (await request.get('/api/teste/assinantes')).json()).assinantes as number;
  await expect.poll(assinantes, { timeout: 10_000 }).toBe(0); // os contextos dos testes anteriores já fecharam
  const p = await novoContexto(browser);
  await entrar(p, 'recepcao@e2e.test');
  await expect.poll(assinantes, { timeout: 10_000 }).toBe(1);
  await p.context().close();
  await expect.poll(assinantes, { timeout: 10_000 }).toBe(0);
});
