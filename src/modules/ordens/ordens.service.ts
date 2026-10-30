import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AcessoNegadoError, assertPermission, can } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { ordensServico, osContadores, osEventos, osItens } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { INT4_MAX } from '@/modules/catalogo/catalogo.rules';
import { buscarVeiculo, carregarOs, itensDaOs, lavadorAtivo, servicosComPreco } from './ordens.repo';
import { calcularTotais, decidirTransicao, validarSelecaoServicos, type StatusOs } from './ordens.rules';
import type { abrirOsSchema, ajustarValorSchema, editarItensSchema } from './ordens.schemas';
import { toOsView, type OsView } from './ordens.views';

/** Recusa de regra com mensagem segura para a tela; `fieldErrors` aponta o campo. */
export class OrdensError extends Error {
  constructor(
    readonly code: 'VALIDACAO' | 'NAO_ENCONTRADO' | 'OS_ENCERRADA' | 'TRANSICAO_INVALIDA' | 'SEM_RESPONSAVEL' | 'NAO_E_RESPONSAVEL',
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'OrdensError';
  }
}
const erroCampo = (campo: string, msg: string) => new OrdensError('VALIDACAO', 'Dados inválidos.', { [campo]: [msg] });
/** Recusa antes de gravar o que estouraria int4 no banco. */
const cabeNoBanco = <T extends { subtotalCentavos: number; totalCentavos: number }>(t: T): T => {
  if (t.subtotalCentavos > INT4_MAX || t.totalCentavos > INT4_MAX) throw erroCampo('valor', 'O valor da OS ultrapassa o limite.');
  return t;
};
// Payloads de os_eventos (itens/valor) contêm dinheiro: qualquer histórico exibido deve ser filtrado por perfil (lavador não vê R$).
const json = (v: unknown) => JSON.stringify(v);

/** O estado da OS mudou entre a tela e o clique: a tela recarrega. */
export class ConflitoOsError extends Error {
  readonly code = 'CONFLITO_OS';
  constructor(message: string) {
    super(message);
    this.name = 'ConflitoOsError';
  }
}

/**
 * Uma transação: valida veículo, serviços (preço do banco no porte do veículo) e responsável, depois
 * contador → OS → itens → evento. Falha em qualquer passo desfaz tudo, inclusive o número.
 */
export async function abrirOs(ctx: TenantContext, input: z.output<typeof abrirOsSchema>, db: Database = getDatabase()): Promise<OsView> {
  assertPermission(ctx, 'os:abrir');
  // quem não direciona OS (lavador) só abre para si e não pode indicar ninguém, nem a si mesmo
  const balcao = can(ctx.perfil, 'os:atribuir');
  if (!balcao && input.responsavelId) throw erroCampo('responsavelId', 'O lavador só abre OS para si.');
  return db.transaction(async (tx) => {
    const veiculo = await buscarVeiculo(ctx, input.veiculoId, tx);
    if (!veiculo) throw erroCampo('veiculoId', 'Veículo não encontrado.');
    const lista = await servicosComPreco(ctx, input.servicoIds, veiculo.porteId, tx);
    if (lista.length !== input.servicoIds.length) throw erroCampo('servicoIds', 'Serviço indisponível para o porte do veículo.');
    if (!validarSelecaoServicos(lista).ok) throw erroCampo('servicoIds', 'Escolha ao menos um serviço principal.');
    if (input.responsavelId && !(await lavadorAtivo(ctx, input.responsavelId, tx))) throw erroCampo('responsavelId', 'Escolha um lavador ativo.');
    const responsavelId = balcao ? (input.responsavelId ?? null) : ctx.memberId;

    // upsert trava a linha do contador até o commit: números sem buraco nem repetição
    const [{ numero }] = await tx
      .insert(osContadores)
      .values({ tenantId: ctx.tenantId, ultimo: 1 })
      .onConflictDoUpdate({ target: osContadores.tenantId, set: { ultimo: sql`${osContadores.ultimo} + 1` } })
      .returning({ numero: osContadores.ultimo });
    const totais = cabeNoBanco(calcularTotais({ valoresItens: lista.map((s) => s.valorCentavos), descontoCentavos: 0, acrescimoCentavos: 0 }));
    const [os] = await tx
      .insert(ordensServico)
      .values({
        tenantId: ctx.tenantId,
        numero,
        veiculoId: veiculo.id,
        clienteId: veiculo.clienteId,
        responsavelId,
        atribuidoEm: responsavelId ? sql`now()` : null,
        status: 'aguardando',
        ...totais,
        tokenPublico: randomBytes(32).toString('base64url'),
        abertaPor: ctx.memberId,
        observacoes: input.observacoes || null,
      })
      .returning({ id: ordensServico.id });
    await tx.insert(osItens).values(
      lista.map((s) => ({
        tenantId: ctx.tenantId,
        osId: os.id,
        servicoId: s.id,
        porteId: veiculo.porteId,
        nomeServico: s.nome,
        valorCentavos: s.valorCentavos,
        comissaoTipo: s.comissaoTipo,
        comissaoValor: s.comissaoValor,
      })),
    );
    await tx.insert(osEventos).values({ tenantId: ctx.tenantId, osId: os.id, tipo: 'status', para: 'aguardando', membroId: ctx.memberId });
    return toOsView(ctx.perfil, (await carregarOs(ctx, os.id, tx))!);
  });
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const ENCERRADOS: StatusOs[] = ['entregue', 'cancelada'];
/** Erros após os quais a UI deve recarregar a fila (a OS mudou sob os pés do usuário). */
export const ERROS_RECARREGAR_FILA = ['CONFLITO_OS', 'NAO_E_RESPONSAVEL', 'OS_ENCERRADA'] as const;

const naoEncontrada = () => new OrdensError('NAO_ENCONTRADO', 'OS não encontrada.');
const encerrada = (status: StatusOs) => new OrdensError('OS_ENCERRADA', `OS ${status} não pode ser alterada.`);

async function emTransacao<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      return fn(tx);
    });
  } catch (err) {
    const pg = ((err as { cause?: unknown }).cause ?? err) as { code?: string }; // o Drizzle embrulha o erro do pg em `cause`
    if (pg.code === '55P03') throw new ConflitoOsError('Essa OS está sendo alterada. Tente novamente.');
    throw err;
  }
}

/** Linha da OS travada até o commit: as regras decidem sobre o estado do banco, não o da tela. */
async function travarOs(tx: Tx, ctx: TenantContext, id: string) {
  const [os] = await tx
    .select({
      id: ordensServico.id,
      status: ordensServico.status,
      responsavelId: ordensServico.responsavelId,
      veiculoId: ordensServico.veiculoId,
      subtotalCentavos: ordensServico.subtotalCentavos,
      descontoCentavos: ordensServico.descontoCentavos,
      acrescimoCentavos: ordensServico.acrescimoCentavos,
      totalCentavos: ordensServico.totalCentavos,
    })
    .from(ordensServico)
    .where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.id, id)))
    .for('update');
  if (!os) throw naoEncontrada(); // inclui OS de outro tenant: nada é revelado
  return os;
}

const view = async (tx: Tx, ctx: TenantContext, id: string) => toOsView(ctx.perfil, (await carregarOs(ctx, id, tx))!);

async function conflito(tx: Tx, ctx: TenantContext, id: string) {
  const os = (await carregarOs(ctx, id, tx))!;
  const outro = os.status === 'em_lavagem' && os.responsavel && os.responsavel.id !== ctx.memberId ? os.responsavel : null;
  return new ConflitoOsError(outro ? `Essa OS já foi pega por ${outro.nomeExibicao}` : 'Essa OS mudou de status');
}

/**
 * Uma transação: trava a OS, decide com `decidirTransicao` sobre o estado travado e grava status,
 * responsável e `os_eventos` juntos. `esperado` diferente do banco ⇒ ConflitoOsError.
 */
export async function transitarOs(
  ctx: TenantContext,
  i: { osId: string; esperado: StatusOs; para: StatusOs; responsavelId?: string; motivo?: string },
  db: Database = getDatabase(),
): Promise<OsView> {
  assertPermission(ctx, 'os:avancar'); // a permissão exata vem de decidirTransicao
  return emTransacao(db, async (tx) => {
    const os = await travarOs(tx, ctx, i.osId);
    const inicio = i.esperado === 'aguardando' && i.para === 'em_lavagem';
    const explicito = inicio && i.responsavelId !== undefined;
    if (os.status !== i.esperado) {
      // "Pegar" repetido (duplo toque) por quem já é o responsável: sucesso sem novo evento
      if (inicio && !explicito && os.status === 'em_lavagem' && os.responsavelId === ctx.memberId) return view(tx, ctx, os.id);
      throw await conflito(tx, ctx, os.id);
    }
    const d = decidirTransicao({
      de: os.status,
      para: i.para,
      perfil: ctx.perfil,
      temResponsavel: explicito || os.responsavelId !== null, // o indicado é validado logo abaixo
      ehResponsavel: os.responsavelId === ctx.memberId,
      responsavelExplicito: explicito,
      motivo: i.motivo,
    });
    if (!d.ok) {
      if (d.erro === 'transicao_invalida') throw ENCERRADOS.includes(os.status) ? encerrada(os.status) : new OrdensError('TRANSICAO_INVALIDA', 'Essa mudança de status não é permitida.');
      if (d.erro === 'sem_permissao') {
        console.warn('[auth] acesso negado', { transicao: `${os.status}->${i.para}`, tenantId: ctx.tenantId, memberId: ctx.memberId, perfil: ctx.perfil });
        throw new AcessoNegadoError();
      }
      if (d.erro === 'motivo_obrigatorio') throw erroCampo('motivo', 'Informe o motivo.');
      if (d.erro === 'sem_responsavel') throw new OrdensError('SEM_RESPONSAVEL', 'Defina o responsável antes.');
      throw new OrdensError('NAO_E_RESPONSAVEL', 'Essa OS é de outro responsável.');
    }
    if (i.responsavelId !== undefined && !inicio) throw erroCampo('responsavelId', 'O responsável só é escolhido ao iniciar a lavagem.');
    if (explicito && !(await lavadorAtivo(ctx, i.responsavelId!, tx))) throw erroCampo('responsavelId', 'Escolha um lavador ativo.');

    const responsavelId = d.limpaResponsavel ? null : explicito ? i.responsavelId! : inicio ? (os.responsavelId ?? ctx.memberId) : os.responsavelId;
    const agora = sql`now()`;
    const [ok] = await tx
      .update(ordensServico)
      .set({
        status: i.para,
        ...(responsavelId !== os.responsavelId && { responsavelId, atribuidoEm: responsavelId ? agora : null }),
        ...(inicio && { inicioLavagemEm: sql`coalesce(${ordensServico.inicioLavagemEm}, now())` }),
        ...(i.para === 'pronto' && { prontoEm: agora }),
        ...(i.para === 'entregue' && { entregueEm: agora }),
        ...(i.para === 'cancelada' && { canceladaEm: agora, motivoCancelamento: i.motivo }),
      })
      .where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.id, os.id), eq(ordensServico.status, i.esperado)))
      .returning({ id: ordensServico.id });
    if (!ok) throw await conflito(tx, ctx, os.id);
    await tx.insert(osEventos).values([
      { tenantId: ctx.tenantId, osId: os.id, tipo: 'status', de: os.status, para: i.para, membroId: ctx.memberId, motivo: i.motivo || null },
      ...(responsavelId !== os.responsavelId ? [{ tenantId: ctx.tenantId, osId: os.id, tipo: 'responsavel' as const, de: os.responsavelId, para: responsavelId, membroId: ctx.memberId }] : []),
    ]);
    return view(tx, ctx, os.id);
  });
}

/** Direciona ou corrige o responsável (null remove) enquanto a OS está ativa; lavador ocupado também pode receber. */
export async function atribuirResponsavel(ctx: TenantContext, i: { osId: string; membroId: string | null }, db: Database = getDatabase()): Promise<OsView> {
  assertPermission(ctx, 'os:atribuir');
  return emTransacao(db, async (tx) => {
    const os = await travarOs(tx, ctx, i.osId);
    if (ENCERRADOS.includes(os.status)) throw encerrada(os.status);
    if (i.membroId === os.responsavelId) return view(tx, ctx, os.id);
    if (i.membroId && !(await lavadorAtivo(ctx, i.membroId, tx))) throw erroCampo('membroId', 'Escolha um lavador ativo.');
    await tx
      .update(ordensServico)
      .set({ responsavelId: i.membroId, atribuidoEm: i.membroId ? sql`now()` : null })
      .where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.id, os.id)));
    await tx.insert(osEventos).values({ tenantId: ctx.tenantId, osId: os.id, tipo: 'responsavel', de: os.responsavelId, para: i.membroId, membroId: ctx.memberId });
    return view(tx, ctx, os.id);
  });
}

/** Corrige itens (os:corrigir) enquanto a OS está ativa: itens novos usam o preço de agora; os antigos mantêm o copiado. */
export async function editarItens(ctx: TenantContext, i: z.output<typeof editarItensSchema>, db: Database = getDatabase()): Promise<OsView> {
  assertPermission(ctx, 'os:corrigir');
  return emTransacao(db, async (tx) => {
    const os = await travarOs(tx, ctx, i.osId);
    if (ENCERRADOS.includes(os.status)) throw encerrada(os.status);
    const atuais = await itensDaOs(ctx, os.id, tx);
    if (!i.remover.every((id) => atuais.some((a) => a.id === id))) throw erroCampo('remover', 'Item não encontrado nesta OS.');
    const ficam = atuais.filter((a) => !i.remover.includes(a.id));
    const removidos = atuais.filter((a) => i.remover.includes(a.id)).map((a) => ({ nome: a.nome, valorCentavos: a.valorCentavos, comissaoTipo: a.comissaoTipo, comissaoValor: a.comissaoValor }));
    if (i.adicionar.some((id) => ficam.some((a) => a.servicoId === id))) throw erroCampo('adicionar', 'Serviço já está na OS.');
    const veiculo = (await buscarVeiculo(ctx, os.veiculoId, tx))!;
    const novos = i.adicionar.length ? await servicosComPreco(ctx, i.adicionar, veiculo.porteId, tx) : [];
    if (novos.length !== i.adicionar.length) throw erroCampo('adicionar', 'Serviço indisponível para o porte do veículo.');
    if (!validarSelecaoServicos([...ficam.map((a) => ({ id: a.servicoId, adicional: a.adicional })), ...novos]).ok) throw erroCampo('remover', 'A OS precisa de ao menos um serviço principal.');

    if (i.remover.length) await tx.delete(osItens).where(and(eq(osItens.tenantId, ctx.tenantId), eq(osItens.osId, os.id), inArray(osItens.id, i.remover)));
    if (novos.length) {
      await tx.insert(osItens).values(
        novos.map((s) => ({ tenantId: ctx.tenantId, osId: os.id, servicoId: s.id, porteId: veiculo.porteId, nomeServico: s.nome, valorCentavos: s.valorCentavos, comissaoTipo: s.comissaoTipo, comissaoValor: s.comissaoValor })),
      );
    }
    const totais = cabeNoBanco(calcularTotais({ valoresItens: [...ficam.map((a) => a.valorCentavos), ...novos.map((s) => s.valorCentavos)], descontoCentavos: os.descontoCentavos, acrescimoCentavos: os.acrescimoCentavos }));
    await tx.update(ordensServico).set(totais).where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.id, os.id)));
    await tx.insert(osEventos).values({ tenantId: ctx.tenantId, osId: os.id, tipo: 'itens', de: removidos.length ? json(removidos) : null, para: novos.length ? json(novos.map((n) => ({ nome: n.nome, valorCentavos: n.valorCentavos }))) : null, membroId: ctx.memberId });
    return view(tx, ctx, os.id);
  });
}

/** Desconto e acréscimo (os:ajustar_valor, só dono/gerente); desconto acima do subtotal zera o total. */
export async function ajustarValor(ctx: TenantContext, i: z.output<typeof ajustarValorSchema>, db: Database = getDatabase()): Promise<OsView> {
  assertPermission(ctx, 'os:ajustar_valor');
  return emTransacao(db, async (tx) => {
    const os = await travarOs(tx, ctx, i.osId);
    if (ENCERRADOS.includes(os.status)) throw encerrada(os.status);
    const totais = cabeNoBanco(calcularTotais({ valoresItens: [os.subtotalCentavos], descontoCentavos: i.descontoCentavos, acrescimoCentavos: i.acrescimoCentavos }));
    await tx
      .update(ordensServico)
      .set({ descontoCentavos: i.descontoCentavos, acrescimoCentavos: i.acrescimoCentavos, totalCentavos: totais.totalCentavos })
      .where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.id, os.id)));
    await tx.insert(osEventos).values({ tenantId: ctx.tenantId, osId: os.id, tipo: 'valor',
      de: json({ descontoCentavos: os.descontoCentavos, acrescimoCentavos: os.acrescimoCentavos, totalCentavos: os.totalCentavos }),
      para: json({ descontoCentavos: i.descontoCentavos, acrescimoCentavos: i.acrescimoCentavos, totalCentavos: totais.totalCentavos }),
      membroId: ctx.memberId,
    });
    return view(tx, ctx, os.id);
  });
}
