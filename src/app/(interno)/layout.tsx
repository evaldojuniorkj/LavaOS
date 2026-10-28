import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { findMember } from '@/modules/equipe/equipe.repo';

// Revalida sessão e vínculo ativo no banco a cada render; cada página também se protege (layouts não re-renderizam na navegação).
export default async function InternoLayout({ children }: { children: React.ReactNode }) {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  const membro = await findMember(ctx, ctx.memberId);
  return (
    <AppShell nome={membro?.nomeExibicao ?? ''} perfil={ctx.perfil} podeEquipe={can(ctx.perfil, 'equipe:gerenciar')}>
      {children}
    </AppShell>
  );
}
