import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('block text-sm font-semibold text-tinta', className)} {...props} />;
}
