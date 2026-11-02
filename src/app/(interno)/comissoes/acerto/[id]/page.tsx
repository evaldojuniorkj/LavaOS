import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { BotaoImprimir } from '@/components/comissoes-view';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';
import { formatarReais } from '@/modules/catalogo/catalogo.rules';
import { detalheAcerto } from '@/modules/comissoes/comissoes.repo';

export const metadata = { title: 'Acerto de comissão | LavaOS' };

const ddmmaaaa = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const dia = (d: Date) => ddmmaaaa(dataDoCaixa(new Date(d)));

/** Folha para o lavador conferir OS por OS; o menu some na impressão (AppShell com print:hidden). */
export default async function AcertoPage(props: PageProps<'/comissoes/acerto/[id]'>) {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil === 'lavador') redirect('/lavador'); // o lavador nunca vê R$
  if (!can(ctx.perfil, 'comissoes:gerenciar')) {
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não gerencia comissões. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  const { id } = await props.params;
  const detalhe = z.guid().safeParse(id).success ? await detalheAcerto(ctx, id) : null; // id malformado nem vai ao banco
  if (!detalhe) notFound();
  const { acerto: a, comissoes, vales } = detalhe;
  return (
    <article className="space-y-6 text-tinta">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/comissoes" className="inline-flex min-h-11 items-center text-base font-semibold text-agua">
          ← Comissões
        </Link>
        <BotaoImprimir />
      </div>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight wrap-anywhere">Acerto de {a.membroNome}</h1>
        <p className="mt-1 text-base text-suave">
          De {ddmmaaaa(a.periodoInicio)} a {ddmmaaaa(a.periodoFim)} · pago em {dia(a.pagoEm)}
        </p>
      </header>

      <section aria-labelledby="acerto-os">
        <h2 id="acerto-os" className="text-lg font-bold">
          Comissões por OS
        </h2>
        {comissoes.length === 0 && <p className="mt-2 text-suave">Nenhuma comissão neste acerto.</p>}
        <ul className="mt-2 divide-y divide-linha">
          {comissoes.map((c, k) => (
            <li key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-base break-inside-avoid">
              <span className="min-w-0 wrap-anywhere">
                <strong>OS {c.osNumero}</strong> · {c.entregueEm ? dia(c.entregueEm) : ''} · {c.nomeServico}
                <span className="block text-sm text-suave">
                  Serviço {formatarReais(c.itemCentavos)} · base {formatarReais(c.baseCentavos)}
                </span>
              </span>
              <strong>{formatarReais(c.valorCentavos)}</strong>
            </li>
          ))}
        </ul>
      </section>

      {vales.length > 0 && (
        <section aria-labelledby="acerto-vales">
          <h2 id="acerto-vales" className="text-lg font-bold">
            Vales descontados
          </h2>
          <ul className="mt-2 divide-y divide-linha">
            {vales.map((v) => (
              <li key={v.id} className="flex justify-between gap-4 py-2 text-base">
                <span>Vale de {dia(v.dadoEm)}</span>
                <strong>{formatarReais(v.valorCentavos)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className="max-w-md space-y-1 border-t border-linha pt-3 text-base">
        {(
          [
            ['Comissões', a.comissoesCentavos],
            ['Vales', a.valesCentavos],
            ['Saldo devedor anterior', a.saldoAnteriorCentavos],
            ['Pago', a.pagoCentavos],
            ['Ficou devendo', a.saldoDevedorCentavos],
          ] as const
        ).map(([rotulo, valor]) => (
          <div key={rotulo} className="flex justify-between gap-2">
            <dt>{rotulo}</dt>
            <dd className="font-semibold">{formatarReais(valor)}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
