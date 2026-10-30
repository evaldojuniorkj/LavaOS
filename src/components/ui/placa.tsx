import { cn } from '@/lib/utils';

/** Placa Mercosul: faixa azul com "BRASIL" (só decoração, fora do texto lido) e letras grandes — é o que o lavador procura no pátio. */
export function Placa({ valor, className }: { valor: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block overflow-hidden rounded-lg border-2 border-tinta bg-white text-center font-mono font-extrabold leading-none tracking-widest text-tinta',
        "before:block before:bg-agua before:py-0.5 before:text-[0.6rem] before:font-bold before:tracking-[0.35em] before:text-white before:content-['BRASIL']",
        className,
      )}
    >
      <span className="block px-3 py-1.5 text-3xl">{valor}</span>
    </span>
  );
}
