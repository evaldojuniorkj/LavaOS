'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconeFila, IconeNova } from '@/components/ui/icones';

const ITENS = [
  { href: '/lavador', rotulo: 'Fila', icone: <IconeFila /> },
  { href: '/lavador/nova', rotulo: 'Nova lavagem', icone: <IconeNova /> },
];

/** Barra de abas ao alcance do polegar (estilo Material 3: o ícone da aba ativa ganha uma pílula); respeita a barra de gestos do Android/iPhone. */
export function BarraInferior() {
  const pathname = usePathname();
  return (
    <nav aria-label="App do lavador" className="fixed inset-x-0 bottom-0 z-10 border-t border-linha/70 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-xl grid-cols-2">
        {ITENS.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={pathname === i.href ? 'page' : undefined}
              className="group flex min-h-16 touch-manipulation flex-col items-center justify-center gap-0.5 text-base font-semibold text-suave transition active:scale-95 aria-[current=page]:text-agua aria-[current=page]:font-bold"
            >
              <span className="rounded-full px-6 py-1 transition-colors group-aria-[current=page]:bg-agua/15">{i.icone}</span>
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
