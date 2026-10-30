'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITENS = [
  { href: '/lavador', rotulo: 'Fila' },
  { href: '/lavador/nova', rotulo: '+ Nova lavagem' },
];

/** Navegação fixa ao alcance do polegar; respeita a barra de gestos do Android/iPhone. */
export function BarraInferior() {
  const pathname = usePathname();
  return (
    <nav aria-label="App do lavador" className="fixed inset-x-0 bottom-0 z-10 border-t border-white/10 bg-tinta pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-xl grid-cols-2 gap-2 p-2">
        {ITENS.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={pathname === i.href ? 'page' : undefined}
              className="flex min-h-14 touch-manipulation items-center justify-center rounded-md text-lg font-bold text-white/80 aria-[current=page]:bg-white aria-[current=page]:text-tinta"
            >
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
