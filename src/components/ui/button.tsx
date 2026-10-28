import { cn } from '@/lib/utils';

const VARIANTES = {
  primario: 'bg-agua text-white hover:bg-agua-escura',
  secundario: 'border border-linha bg-white text-tinta hover:bg-enxague',
  perigo: 'bg-perigo text-white hover:bg-perigo/90',
} as const;

export function Button({ variante = 'primario', className, ...props }: React.ComponentProps<'button'> & { variante?: keyof typeof VARIANTES }) {
  return (
    <button
      className={cn(
        'inline-flex min-h-11 items-center justify-center rounded-md px-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTES[variante],
        className,
      )}
      {...props}
    />
  );
}
