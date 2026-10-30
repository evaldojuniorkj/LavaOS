import type { Metadata } from 'next';
import { cn } from '@/lib/utils';
import { centesimosParaTexto } from '@/modules/catalogo/catalogo.rules';
import { buscarOsPublica, type OsPublica } from '@/modules/ordens/publico.repo';
import { AoVivo } from './ao-vivo';

export const dynamic = 'force-dynamic';

// mesmo título para toda resposta: nada no <head> indica se o token existe. Headers (no-referrer/noindex) vêm do proxy.
export const metadata: Metadata = { title: 'Acompanhar lavagem', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const ETAPAS = [
  { rotulo: 'Aguardando', status: 'aguardando', em: 'entradaEm' },
  { rotulo: 'Em lavagem', status: 'em_lavagem', em: 'inicioLavagemEm' },
  { rotulo: 'Pronto', status: 'pronto', em: 'prontoEm' },
  { rotulo: 'Entregue', status: 'entregue', em: 'entregueEm' },
] as const;

const TITULO: Record<OsPublica['status'], string> = {
  aguardando: 'Na fila para lavar',
  em_lavagem: 'Em lavagem agora',
  pronto: 'Pronto para retirar',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};

const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const reais = (c: number) => `R$ ${centesimosParaTexto(c)}`;

function Indisponivel() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-bold text-tinta">Link indisponível ou expirado</h1>
      <p className="mt-3 text-base text-suave">Confira se o link está completo ou peça um novo ao lava jato.</p>
    </main>
  );
}

/** Placa no desenho Mercosul: o elemento que o cliente reconhece de longe. */
function Placa({ placa }: { placa: string }) {
  return (
    <span className="inline-flex flex-col overflow-hidden rounded-md border-2 border-tinta bg-white text-center shadow-sm">
      <span aria-hidden className="bg-agua-escura px-3 text-[0.625rem] font-bold leading-4 tracking-widest text-white">
        BRASIL
      </span>
      <span className="px-3 py-0.5 font-mono text-2xl font-bold tracking-[0.15em] text-tinta">
        <span className="sr-only">Placa </span>
        {placa}
      </span>
    </span>
  );
}

export default async function AcompanharPage({ params }: { params: Promise<{ token: string }> }) {
  const os = await buscarOsPublica((await params).token);
  // Só cosmético para o teste de HTML byte a byte: sem I/O (token malformado) a página terminava antes dos chunks de
  // metadata/viewport e a ordem do streaming mudava. Não é controle de segurança (a resposta já é a mesma em conteúdo).
  await new Promise((r) => setImmediate(r));
  if (!os) return <Indisponivel />;
  const atual = ETAPAS.findIndex((e) => e.status === os.status);
  const cancelada = os.status === 'cancelada';
  // só o líquido, sem detalhar desconto/acréscimo: explica por que o total difere da soma dos serviços
  const ajuste = os.totalCentavos - os.itens.reduce((soma, i) => soma + i.valorCentavos, 0);
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <p className="text-base font-semibold text-suave">{os.lavaJato.nome}</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Placa placa={os.veiculo.placa} />
        {os.veiculo.modelo && <p className="text-lg font-semibold text-tinta">{os.veiculo.modelo}</p>}
      </div>

      <h1 aria-live="polite" className={cn('mt-8 text-3xl font-extrabold tracking-tight', cancelada ? 'text-perigo' : 'text-tinta')}>
        {TITULO[os.status]}
      </h1>

      {cancelada ? (
        <p className="mt-3 text-base text-suave">
          Este serviço foi cancelado{os.linhaDoTempo.canceladaEm && ` em ${hora.format(os.linhaDoTempo.canceladaEm)}`}. Em caso de dúvida, fale com o lava jato.
        </p>
      ) : (
        <ol aria-label="Andamento" className="mt-6">
          {ETAPAS.map((e, i) => {
            const feito = i <= atual;
            const quando = os.linhaDoTempo[e.em];
            return (
              <li key={e.status} aria-current={i === atual ? 'step' : undefined} className="relative flex gap-4 pb-6 last:pb-0">
                {i < ETAPAS.length - 1 && <span aria-hidden className={cn('absolute left-[0.6875rem] top-6 h-full w-0.5', i < atual ? 'bg-agua' : 'bg-linha')} />}
                <span
                  aria-hidden
                  className={cn(
                    'relative mt-0.5 size-6 shrink-0 rounded-full border-2',
                    feito ? 'border-agua bg-agua' : 'border-linha bg-white',
                    i === atual && 'ring-4 ring-agua/25',
                  )}
                />
                <div>
                  <p className={cn('text-base', i === atual ? 'font-bold text-tinta' : feito ? 'font-semibold text-tinta' : 'text-suave')}>
                    {e.rotulo}
                    <span className="sr-only">{i === atual ? ' (etapa atual)' : feito ? ' (concluída)' : ' (a seguir)'}</span>
                  </p>
                  {feito && quando && <p className="text-sm text-suave">{hora.format(quando)}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <section aria-labelledby="servicos" className="mt-10 border-t border-linha pt-6">
        <h2 id="servicos" className="text-lg font-bold text-tinta">
          Serviços
        </h2>
        <ul className="mt-3 space-y-2">
          {os.itens.map((item, i) => (
            <li key={i} className="flex justify-between gap-4 text-base text-tinta">
              <span>{item.nome}</span>
              <span className="tabular-nums">{reais(item.valorCentavos)}</span>
            </li>
          ))}
        </ul>
        {ajuste !== 0 && (
          <p className="mt-2 flex justify-between gap-4 text-base text-tinta">
            <span>{ajuste < 0 ? 'Desconto' : 'Acréscimo'}</span>
            <span className="tabular-nums">
              {ajuste < 0 ? '−' : '+'}
              {reais(Math.abs(ajuste))}
            </span>
          </p>
        )}
        <p className="mt-4 flex justify-between gap-4 border-t border-linha pt-3 text-lg font-bold text-tinta">
          <span>Total</span>
          <span className="tabular-nums">{reais(os.totalCentavos)}</span>
        </p>
      </section>

      {!cancelada && os.status !== 'entregue' && (
        <div className="mt-8">
          <AoVivo />
        </div>
      )}
    </main>
  );
}
