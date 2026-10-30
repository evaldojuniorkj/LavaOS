import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'block min-h-12 w-full rounded-xl border-[1.5px] border-linha bg-white px-3.5 text-base text-tinta aria-invalid:border-perigo',
        className,
      )}
      {...props}
    />
  );
}

/** Label + input + erro do campo ligado por aria-describedby. */
export function Campo({ id, rotulo, erro, ...props }: { id: string; rotulo: string; erro?: string } & React.ComponentProps<'input'>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input id={id} name={id} aria-invalid={erro ? true : undefined} aria-describedby={erro ? `${id}-erro` : undefined} {...props} />
      {erro && (
        <p id={`${id}-erro`} className="text-sm font-medium text-perigo">
          {erro}
        </p>
      )}
    </div>
  );
}
