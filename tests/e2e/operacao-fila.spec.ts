import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrarLavador, entrarStaff, semRolagemHorizontal, SUFIXO } from './login';

// Catálogo, veículo existente e o segundo lavador vêm do global-setup. O app do lavador (/lavador) tem o próprio spec.

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
  // o foco volta ao cartão da OS (o botão que abriu virou "Trocar responsável"), não fica no <body>
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('article')?.getAttribute('aria-label') ?? '')).toContain(placa);
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

test('queda do stream mostra Reconectando… e se recupera sozinha', async ({ page }) => {
  await entrar(page, 'recepcao@e2e.test');
  await page.route('**/api/eventos', (r) => r.abort()); // conexão caída (erro de rede): o navegador tenta de novo
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Reconectando…');
  await page.unroute('**/api/eventos');
  await expect(page.getByText('Reconectando…')).toBeHidden({ timeout: 15_000 });
  // recuperado: um evento novo chega sem recarregar
  const outra = await novoContexto(page.context().browser()!);
  await entrar(outra, 'recepcao@e2e.test');
  const placa = await abrirOsNova(outra);
  await expect(cartao(page, placa)).toBeVisible();
  await cancelar(outra, placa);
  await outra.context().close();
});

test('lavador com PIN redefinido e stream caído vai ao login (autorização real, não só sessão)', async ({ page, browser }) => {
  const s = SUFIXO();
  const nome = `Fila ${s}`;
  const ger = await novoContexto(browser);
  await entrarStaff(ger, 'gerente@e2e.test', undefined, '/login?next=%2Fconfiguracoes%2Fequipe');
  await expect(ger.getByRole('heading', { name: 'Equipe' })).toBeVisible();
  const form = ger.getByRole('form', { name: 'Novo membro' });
  await form.getByLabel('Perfil').selectOption({ label: 'Lavador' });
  await form.getByLabel('Nome de exibição').fill(nome);
  await form.getByLabel('Usuário', { exact: true }).fill(`fila.${s}`);
  await form.getByLabel('PIN', { exact: true }).fill('0555');
  await form.getByRole('button', { name: 'Cadastrar membro' }).click();
  const linha = ger.getByRole('listitem').filter({ hasText: nome });
  await expect(linha).toBeVisible();

  await entrarLavador(page, `fila.${s}`, '0555');
  await expect(page).toHaveURL('/lavador');
  await page.route('**/api/eventos', (r) => r.abort());
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Reconectando…');
  await linha.getByRole('button', { name: 'Redefinir PIN' }).click();
  await linha.getByLabel('Novo PIN').fill('0666');
  await linha.getByRole('button', { name: 'Salvar PIN' }).click();
  await expect(ger.getByRole('status')).toContainText('PIN redefinido.');
  await page.unroute('**/api/eventos'); // a próxima tentativa recebe 401/403 e o EventSource desiste (CLOSED)
  await expect(page).toHaveURL('/login?motivo=sessao', { timeout: 15_000 });
  await ger.context().close();
});

test('stream recusado por falha passageira (503) reconecta sem deixar assinatura sobrando', async ({ page, request }) => {
  const assinantes = async () => (await (await request.get('/api/teste/assinantes')).json()).assinantes as number;
  await expect.poll(assinantes, { timeout: 10_000 }).toBe(0);
  await entrar(page, 'recepcao@e2e.test');
  await expect.poll(assinantes, { timeout: 10_000 }).toBe(1);
  let pedidos = 0;
  await page.route('**/api/eventos', (r) => (++pedidos === 1 ? r.fulfill({ status: 503 }) : r.continue()));
  await page.reload(); // 503 fecha o EventSource; a sonda recebe 200 (autorizado) e é abortada; o stream é recriado
  await expect.poll(() => pedidos, { timeout: 15_000 }).toBeGreaterThanOrEqual(3); // stream recusado, sonda, stream novo
  await expect(page.getByText('Reconectando…')).toBeHidden({ timeout: 15_000 });
  await expect.poll(assinantes, { timeout: 10_000 }).toBe(1); // só o stream novo: a sonda não ficou aberta
});

test('stream que fecha sem sessão leva ao login em vez de ficar reconectando', async ({ page, baseURL }) => {
  await entrar(page, 'recepcao@e2e.test');
  await page.route('**/api/eventos', (r) => r.abort());
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Reconectando…');
  // sessão revogada no servidor (e o cookie some do contexto) enquanto o stream está caído
  expect((await page.request.post('/api/auth/sign-out', { headers: { origin: baseURL! }, data: {} })).ok()).toBe(true);
  expect(await (await page.request.get('/api/auth/get-session')).text()).toBe('null');
  await page.unroute('**/api/eventos'); // a próxima tentativa recebe 403 e o EventSource desiste (CLOSED)
  await expect(page).toHaveURL('/login?motivo=sessao', { timeout: 15_000 });
  await expect(page.getByText('Sua sessão terminou ou o acesso foi removido. Entre novamente.')).toBeVisible();
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
