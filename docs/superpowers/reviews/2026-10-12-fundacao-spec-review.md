# LavaOS — Revisão da especificação para a Fundação

**Data:** 2026-10-12, America/Boa_Vista.
**Documento revisado:** [Especificação do MVP](../specs/2026-09-30-lavaos-mvp-design.md).
**Resultado:** escopo suficiente para planejar a Fase 0, com as decisões propostas abaixo para revisão antes da execução. A especificação original foi preservada; este relatório não registra aprovação humana nem execução.

## Coerência e limites

O desenho mantém uma aplicação Next.js/TypeScript, PostgreSQL 16/Drizzle e Better Auth. A separação entre autor da OS e executor, as OSs do piloto sem quitação obrigatória, a fidelidade opcional após caixa e a introdução progressiva de tabelas são coerentes. Não há motivo para ampliar o escopo da Fundação com funcionalidades de operação ou IA.

A Fase 0 cobre ambiente local, banco/auth, organizações/membros, autorização, login de todos os perfis, layout mínimo e testes. Catálogo, OS, SSE, PWA instalável e assistente de primeiro acesso continuam na Fase 1. Pagamentos, comissões, fidelidade, agenda, produção e backups seguem suas fases.

## Lacunas e propostas concretas

| Ponto da especificação | Problema a resolver | Proposta deste plano |
|---|---|---|
| “Toda tabela” tem `tenant_id` | Usuários globais, sessões e raiz do tenant não seguem o mesmo modelo das entidades de negócio. | Documentar a exceção: tabelas globais do Better Auth conservam seu contrato; a organização é a raiz `lava_jatos`, identificada por seu próprio UUID. Membros, credenciais de lavador e demais dados locais exigem tenant. |
| Organização Better Auth e `lava_jatos` | Duas representações independentes poderiam divergir. | Mapear `organization` para `lava_jatos` e `member` para `membros`, incluindo campos locais. `organization.id = tenant_id`; não manter uma segunda tabela de membros ou de lava jatos. |
| Perfis fixos versus permissões do plugin | Endpoints nativos de organizações poderiam permitir alterações fora da matriz do produto. | O perfil local é a única fonte de autorização de domínio. Bloquear mutações HTTP nativas de organização, convites, usuários e credenciais; executar as ações necessárias por serviços internos autorizados. Sem perfis dinâmicos ou múltiplos papéis no mesmo vínculo. |
| Login com PIN de 4–6 dígitos | O plugin Username reutiliza autenticação de senha; não define um mecanismo de PIN separado. | Plugin local Better Auth `lavador-pin`, tabela privada de credenciais e sessões Better Auth. Preservar a política de senha dos perfis de balcão; não reduzir seu tamanho mínimo para aceitar PIN. |
| Bloqueio “temporário” após 5 erros | Duração e persistência não foram definidas. | Propor 15 minutos após cinco erros consecutivos por tenant/usuário; persistir no Postgres e serializar tentativas. Sucesso zera erros; após o prazo inicia nova série. Adicionar limite por origem/IP sem contar apenas IP como identidade. |
| Nome de usuário no piloto | Login público ainda não tem tenant autenticado. | Resolver o tenant do piloto por `LAVAOS_PILOT_SLUG`, configurado no servidor. Usuário normalizado e único por tenant; não aceitar `tenant_id` enviado pelo formulário como autoridade. |
| Sessão “de 30 dias” | Não distingue expiração absoluta de renovação deslizante. | Propor expiração absoluta de 30 dias para lavador e 7 dias para os demais; logout encerra a sessão. PWA instalável entra somente na Fase 1. |
| Desativação imediata | Cache de cookies e sessões em outro dispositivo podem atrasar o efeito. | Sessões no Postgres, cache de sessão em cookie desabilitado e membro ativo verificado em cada acesso. Desativação remove sessões do usuário; reset de PIN invalida sessões PIN e muda a versão da credencial para impedir uma corrida de login. |
| Primeiro dono antes do assistente | Assistente é Fase 1, mas testes da Fundação precisam de dados. | Fixtures e provisionamento local de desenvolvimento, idempotentes e recusados fora de development/test. Sem cadastro público ou senha de demonstração fixa. |
| Unidade de isolamento nos testes | Login isolado não demonstra autorização. | Dois tenants e os quatro perfis nas fixtures; provar que IDs de outro tenant, corpos adulterados e cookies anteriores à desativação não dão acesso. |

As durações de 15 minutos e 7 dias, a expiração absoluta de 30 dias e o tenant do piloto configurado são **propostas de detalhe**, não valores já presentes na especificação. O desenho de PIN é uma decisão técnica proposta para preservar os requisitos existentes.

## Decisões de banco

- UUIDs em todas as entidades próprias e IDs auth compatíveis; manter PostgreSQL 16 sem instalar extensão só para trocar a estratégia de UUID.
- Timestamps `timestamptz`; o dia operacional futuro continua em `America/Sao_Paulo`.
- Unique `(tenant_id, user_id)` em membros; FK e índices coerentes com esse acesso. Credencial privada referencia o membro por `(tenant_id, membro_id)` para impedir vínculos entre tenants.
- Pool Node compartilhado; credencial de migrations separada do usuário de runtime, que não possui privilégios de DDL/superusuário.
- Isolamento de aplicação obrigatório e testado. RLS não é assumida como proteção existente nem adicionada implicitamente nesta fase.
- Schema auth gerado/validado contra a versão de Better Auth escolhida; migrations aplicadas por Drizzle, sem duas ferramentas concorrentes alterando o banco.

## Riscos posteriores identificados

1. SSE deve revalidar acesso e encerrar conexões quando o membro for desativado; só checar na abertura não atende à revogação imediata. Implementar e testar na Fase 1.
2. Regras de comissão ativas com chaves opcionais precisam de unicidade que trate `NULL` corretamente no PostgreSQL 16; índice único simples pode permitir duplicatas. Resolver na Fase 3.
3. A fase operacional deve definir o destino temporário da tela inicial do dono enquanto o painel da Fase 4 não existir.
4. O assistente da Fase 1 precisa criar dono, tenant, vínculo e catálogo inicial de forma consistente e impedir execuções concorrentes/novos cadastros públicos não autorizados.
5. Reset de PIN e desativação devem permanecer restritos ao tenant do autor; gerente não pode usar essas ações para controlar dono ou outro gerente.

## Resultado esperado da Fundação

App executável localmente; migrations reproduzíveis; quatro perfis autenticando; contexto de tenant derivado do servidor; equipe mínima autorizada; sessão revogada sem atraso; layout responsivo; verificações de qualidade e testes unitários, integração e navegador funcionando. Não significa que fila, OS ou financeiro estejam prontos.

O [plano de implementação da Fase 0](../plans/2026-10-12-fundacao.md) converte esses critérios em tarefas. Antes de executar, revisar principalmente as propostas de PIN, bloqueio e validade de sessão.

## Fontes consultadas

- [Better Auth: Organization](https://better-auth.com/docs/plugins/organization): mapeamento de schema, campos extras e operações de organização.
- [Better Auth: Username](https://better-auth.com/docs/plugins/username): login por usuário reutiliza a autenticação de senha; cadastro padrão exige e-mail.
- [Better Auth: Plugins](https://better-auth.com/docs/concepts/plugins): métodos de autenticação personalizados e endpoints.
- [Better Auth: Session Management](https://better-auth.com/docs/concepts/session-management): validade, renovação e implicações do cache para revogação.
- [Better Auth: Rate Limit](https://better-auth.com/docs/concepts/rate-limit): persistência de limites e tratamento concorrente.
- [Better Auth: Database](https://better-auth.com/docs/concepts/database) e [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle): IDs/schema e integração ORM.
- [Next.js: Installation](https://nextjs.org/docs/app/getting-started/installation): requisitos e criação de projeto.

As fontes são contratos de bibliotecas; decisões específicas do LavaOS neste relatório são propostas nossas. Reconferir docs e tipos da versão fixada antes da implementação.
