import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { testUrls } from '../helpers/test-db';

/**
 * Quita direto no banco a OS ativa da placa (pix, no caixa de hoje, aberto se faltar) e avisa as telas pelo NOTIFY:
 * atalho dos specs que não testam o recebimento (esse é o caixa.spec).
 */
export async function quitarOs(placa: string) {
  const c = new pg.Client({ connectionString: testUrls.owner });
  await c.connect();
  try {
    const {
      rows: [os],
    } = await c.query(
      `select o.id, o.tenant_id, o.total_centavos - coalesce(sum(p.valor_centavos) filter (where p.estornado_em is null), 0) as falta
       from ordens_servico o join veiculos v on v.id = o.veiculo_id left join pagamentos p on p.os_id = o.id
       where v.placa = $1 and o.status in ('aguardando', 'em_lavagem', 'pronto') group by o.id`,
      [placa],
    );
    await c.query(
      `insert into caixas (tenant_id, data, troco_inicial_centavos, aberto_por)
       select $1, (now() at time zone 'America/Sao_Paulo')::date, 0, id from membros where tenant_id = $1 and perfil = 'recepcao' limit 1
       on conflict do nothing`,
      [os.tenant_id],
    );
    await c.query(
      `insert into pagamentos (tenant_id, os_id, caixa_id, forma, valor_centavos, recebido_por)
       select $1, $2, id, 'pix', $3, aberto_por from caixas where tenant_id = $1 and status = 'aberto'`,
      [os.tenant_id, os.id, os.falta],
    );
    await c.query(`select pg_notify('lavaos_eventos', $1)`, [JSON.stringify({ tenantId: os.tenant_id, osId: os.id, tipo: 'pagamento' })]);
  } finally {
    await c.end();
  }
}

/** Tira o caixa de hoje do caminho (fecha e o manda para antes do mais antigo): o caixa.spec abre o próprio e o quitarOs volta a criar um. */
export async function liberarCaixaDeHoje() {
  const c = new pg.Client({ connectionString: testUrls.owner });
  await c.connect();
  try {
    await c.query(
      `update caixas set status = 'fechado', fechado_em = coalesce(fechado_em, now()), data = (select min(data) - 1 from caixas x where x.tenant_id = caixas.tenant_id)
       where data = (now() at time zone 'America/Sao_Paulo')::date and tenant_id = (select id from lava_jatos where slug = 'e2e')`,
    );
  } finally {
    await c.end();
  }
}

/** OS pronta de placa nova (porte Grande, Lavagem completa) com o lavador E2E, inserida direto; devolve a placa. */
export async function semearOsPronta(totalCentavos = 8000) {
  const l = () => 'ABCDEFGHJKLMNPRTUVWXYZ'[Math.floor(Math.random() * 22)];
  const d = () => String(Math.floor(Math.random() * 10));
  const placa = `C${l()}${l()}${d()}${l()}${d()}${d()}`;
  const c = new pg.Client({ connectionString: testUrls.owner });
  await c.connect();
  try {
    const um = async (sql: string, params: unknown[]) => (await c.query(sql, params)).rows[0];
    const { id: t } = await um(`select id from lava_jatos where slug = 'e2e'`, []);
    const { ultimo } = await um('insert into os_contadores (tenant_id, ultimo) values ($1, 1) on conflict (tenant_id) do update set ultimo = os_contadores.ultimo + 1 returning ultimo', [t]);
    const v = await um(`insert into veiculos (tenant_id, placa, porte_id) values ($1, $2, (select id from portes where tenant_id = $1 and nome = 'Grande')) returning id, porte_id`, [t, placa]);
    const os = await um(
      `insert into ordens_servico (tenant_id, numero, veiculo_id, aberta_por, responsavel_id, status, atribuido_em, inicio_lavagem_em, pronto_em, token_publico, subtotal_centavos, total_centavos)
       values ($1, $2, $3, (select id from membros where tenant_id = $1 and perfil = 'recepcao' limit 1), (select id from membros where tenant_id = $1 and nome_exibicao = 'Lavador E2E'),
         'pronto', now(), now(), now(), $4, $5, $5) returning id`,
      [t, ultimo, v.id, randomBytes(32).toString('base64url'), totalCentavos],
    );
    await c.query(
      `insert into os_itens (tenant_id, os_id, servico_id, porte_id, nome_servico, valor_centavos, comissao_tipo, comissao_valor)
       values ($1, $2, (select id from servicos where tenant_id = $1 and nome = 'Lavagem completa'), $3, 'Lavagem completa', $4, 'percentual', 3000)`,
      [t, os.id, v.porte_id, totalCentavos],
    );
  } finally {
    await c.end();
  }
  return placa;
}
