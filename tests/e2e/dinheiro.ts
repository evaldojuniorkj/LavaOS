import pg from 'pg';
import { testUrls } from '../helpers/test-db';

/**
 * Quita direto no banco a OS ativa da placa (pix, no caixa de hoje, aberto se faltar): entregar exige quitação
 * e a tela de receber ainda não existe.
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
  } finally {
    await c.end();
  }
}
