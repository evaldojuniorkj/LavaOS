# Fundação — evidências de aceite local

Registro da Task 8 em 2026-10-13T17:59:20Z, branch `codex/fundacao`, base `66d981b`.
A revisão final do controlador será acrescentada após revisão fresca da branch.
Não houve deploy ou execução de CI hospedado; não existe remote configurado.

## Escopo e aceite adversarial

As tarefas 1–7 foram revisadas pelo controlador. A Task 8 fecha scripts, CI,
aceitação adversarial de navegador e documentação da Fundação. Não introduz
módulos de operação/financeiro, schema futuro, IA ou produção.

`tests/e2e/foundation-security.spec.ts` captura IDs, router headers, content-type e
body de cada server action em submits reais da UI. Reexecuta POST para as bridges
Next reais com alvos B, tenant/perfil forjados, cookies anônimos/recepção/lavador e
gerente contra liderança. Nenhum endpoint fake ou contexto de permissão fabricado.
O fingerprint SHA-256 de identidades/contas/tenant/membros/credenciais/convites
compara essas tabelas antes/depois de cada ataque sem exportar hashes privados.
Asserções verificam recusa, ausência de escrita e ausência de segredo/SQL/dados B.
HTTP nativo signup/organização/escalation é recusado; mutações reais de equipe
revogam cookies antigos, páginas protegidas e chamadas diretas. Cookies originais
são reinstalados antes de cada replay após revogação.

Há **6 novos casos de navegador** (3 × desktop/mobile), com **42 replays negados
nas bridges Next** e **16 recusas HTTP nativas**, cada um com comparação de estado.
Os 38 casos anteriores incluem navegação direta negada ao lavador/recepção,
DTOs permitidos, quatro logins, logout, expiração, PIN/bloqueio, gestão e action
de uma página previamente carregada após desativação.

## Verificação final e comandos

Todos os comandos pnpm locais usaram:
`npx --yes --package=node@22.23.3 --package=pnpm@10.34.7 -- pnpm …`.

| Evidência | Resultado |
|---|---|
| `pnpm verify:foundation` no worktree | **exit 0**; lint/typecheck, **228 unitários** em 5 arquivos, **49 integrações** em 8 arquivos, build padrão e **44 E2E**, sem skipped de segurança; E2E 2.1 min |
| Root de tracing explícito, ajuste posterior de reproducibilidade | **lint/typecheck exit 0**; novo build e caso real de revogação mobile no export final: **1 passed (8.8s), exit 0** |
| Export de arquivos do index Git em `.superpowers/sdd/2026-10-12-fundacao/tmp/final-export` | Instalação **frozen exit 0**; migrations/reaplicação **exit 0**; seed/reseed **exit 0**; logins reais **dono/gerente/recepção/lavador** aprovados; servidor dev encerrado |
| Falha controlada do gate | Executou apenas lint/typecheck/test e saiu **1**; build/E2E não iniciaram |
| URL test remota inválida | Recusada antes de preparação/conexão; modo/URLs de teste sempre validados |
| Listener já existente em 3107 | Recusado antes de build/migrations; listener preservado |
| Workflow | YAML parseado localmente; mesmas verificações/versões/PG16.13; **CI hospedada não executada** |

O gate completo antecede somente o ajuste explícito `outputFileTracingRoot`;
não foi reexecutado artificialmente após esse ajuste. O config final foi coberto
por lint/types e build/aceite real no export aninhado, que agora produz o servidor
na localização esperada. Todos os scripts atuais executam na raiz do app.

Logs de execução (sem valores secretos) ficam localmente em
`.superpowers/sdd/2026-10-12-fundacao/task-8-*.log`. `test:e2e` possui o build
obrigatório para o gate e execução isolada; não aceita bypass por build antigo.
Playwright controla o standalone em `127.0.0.1:3107`; runtime/DDL usam o mesmo
`lavaos_test` validado. Nenhum runner sobrescreve `NODE_ENV`.

## Falhas observadas e resoluções

O primeiro gate com servidor dev terminou **43/44**, timeout em
`foundation-equipe.spec.ts:76`, esperando o botão da página antiga após
revogação. Houve uma instalação incidental no checkout com dev ativo; causalidade
não foi comprovada. A asserção adicional de URL preserva o requisito de usar a
página antiga. Em execução isolada, o mesmo caso passou **3/3**.

A execução dev também mostrou erros React de stream cancelado durante transições
de login e, num caso, hidratação/router antes de inicialização. Aguardar documentos
hidratados antes de revogação/teardown removeu os erros de hidratação/router nos
repeats (**3/3 mobile**). Trocar readiness HTTP por TCP não removeu o erro de
stream e foi descartado. Comparação com build de produção passou o mesmo caso
(**1/1**) sem esses erros; `next start` avisou sobre standalone, por isso o runner
final usa o servidor standalone gerado. O gate final **44/44** não apresentou
erros/warnings Next; os 16 logs genéricos de acesso negado são esperados.

O export temporário entrou nas buscas amplas de ESLint/TypeScript: as ferramentas
agora excluem apenas os produtos ignorados `.superpowers/`, preservando todo
código/teste de produto. O export aninhado também expôs inferência do lockfile pai;
`outputFileTracingRoot` agora aponta à raiz do app executado. Nenhuma regra de
permissão foi relaxada para resolver problemas de tooling.

## Limites e dados locais

A CI usa runner com Postgres mapeado em localhost, respeitando a política de seed
loopback; o parser continua aceitando host test `postgres` com cobertura unitária.
App/auth/migrator usam segredos aleatórios gerados no job; bootstrap usa o token
efêmero mascarado do próprio job, com autenticação PostgreSQL por senha.
Não há senhas fixas, trust TCP, seed de produção ou upload de credenciais.
Traces/snapshots de página/screenshots/vídeo automáticos ficam off.
Instalação frozen manteve a política default do pnpm de bloquear scripts de build
de dependências; as ferramentas instaladas, build e navegador foram verificados.

`lavaos_dev` estava vazio (0 tenants/0 donos) antes do provisionamento. O aceite
criou dono e três membros de validação local; depois reaplicou migrations e
revalidou o seed sem sobrescrever identidades/credenciais. Entradas reutilizáveis
ficam **somente** em `.env.seed.local` ignorado, modo **0600**; o README descreve
como carregá-las. `.env` também permaneceu 0600. Containers alheios e checkout
primário foram preservados; somente servidores próprios temporários encerrados.

O desenvolvimento permanece `next dev --webpack`; seu diagnóstico de stream
cancelado continua documentado, sem atribuição interna definitiva. A Fundação
não representa operação do pátio, caixa/financeiro ou deploy de produção.

## Rulings do controlador, preservados na ordem do ledger

```text
Ruling: Execute on managed worktree codex/fundacao and preserve primary checkout — user approved implementation and isolation is required by execution workflow — costs a separate checkout to review.
Ruling: Task 3 uses injected session reader until Task 4 connects Better Auth — avoids dependency cycle — costs an explicit integration seam.
Ruling: Port 5432 is occupied by an unrelated project; use loopback port 55432 for LavaOS Postgres — preserve existing services — costs a local environment override.
Ruling: pnpm available on host is v11; invoke pinned pnpm10 through Corepack or npx to preserve approved baseline — costs one isolated package-manager invocation.
Task 1: Ruling: In test mode, runtime and migrations must target the same validated lavaos_test identity as TEST_DATABASE_URL — prevent E2E writing to an unintended database — costs stricter explicit test environment setup.
Task 2: Ruling: Add TEST_MIGRATION_DATABASE_URL only in test tooling, mapped through existing safe test-target validation — allows DDL vs runtime DML credentials in test database — costs one documented test setup variable, no production dependency.
Task 3: Ruling: Add small internal auth/authority.ts to separate issued-context validation from DB/session guard and avoid module cycle — keeps pure permission/team rules free of DB imports — costs one internal file and targeted refactor verification.
Task 5: Ruling: Additional PIN limiter uses tenant plus trusted configured Origin and fixed unknown-peer, 30 attempts per 60 seconds, atomic persisted storage; ignores arbitrary forwarded IP hints — Request exposes no trusted socket/proxy address in the approved baseline — costs a shared pilot login budget which may temporarily throttle legitimate users; trusted ingress policy can be introduced separately when deployment is scoped.
Task 5: Ruling: Replace literal hash-substring test with plaintext inequality and real correct/incorrect hash verification — a salted hexadecimal digest can incidentally contain short PIN digits; spec requires secure hashing, not impossible substring property — costs test wording differing from literal plan assertion while validating actual security contract.
Task 7: Ruling: Use Next dev --webpack for local development and E2E while retaining default production build — installed Next16.4/React19.3 dev Turbopack repeatedly emitted HMR hash mismatch; comparative same-app tests stabilized under Webpack — costs a development-only bundler choice and possible dev performance difference until upstream issue is resolved.
Task 8: Ruling: Run final E2E against freshly built Next standalone output, with test:e2e owning the build stage for verify:foundation — controlled production comparison was clean while development logged canceled React streams during ordinary login document transitions, and acceptance should verify the shipped artifact — costs a production build before standalone E2E; normal local dev remains Webpack and its observed diagnostic is documented, not suppressed.
Task 8: Ruling: Explicitly scope Next outputFileTracingRoot to the single app directory — nested clean export inherited parent lockfile and changed standalone server location, while architecture requires one independent app — costs an explicit tracing-root assumption that must be revisited if the project becomes a monorepo.
```

## Correções da revisão final — F1 e F2

A onda final sobre `2bd841e` revalida a sessão persistida também em
`get-session`, `organization/list` e `organization/set-active`. O helper interno
confere expiração, usuário, tenant, membro ativo, perfil lavador e versão atual
da credencial PIN. A lista PIN fica restrita ao vínculo original; staff conserva
a seleção legítima entre múltiplas organizações e os prazos absolutos de 7/30 dias.
Os campos técnicos vêm do banco e não do retorno redigido do Better Auth. O guard
de domínio continua com sua validação independente.

As recusas tratadas pela action e pela página Equipe emitem somente o evento
constante `LavaOS: acesso de domínio negado.`, sem inputs, headers, identidade,
recurso, erro nativo ou segredos. Integrações chamam as actions e a página reais,
com cookie assinado, PostgreSQL e guards reais; substituem apenas o fornecimento
de headers do request e observam o logger.

RED comprovado: os três endpoints retornavam **200 em vez de 403** para uma linha
v1 original restaurada depois de um reset real; três recusas reais de domínio
não emitiam o evento. O estado de linha tardia é uma reconstrução controlada no
banco com o cookie autêntico, **não uma reprodução do interleaving MVCC completo**.
As barreiras determinísticas de login/reset já existentes foram preservadas.
Um teste adicional confirma recusa de vínculos/usuário/perfil incoerentes no
protocolo nativo. Uma tentativa inicial de fixture com somente versão nula foi
recusada pela constraint existente `session_pin_pair_valid`; o teste foi corrigido
para estados persistíveis, sem alterar o schema.

O novo `pnpm verify:foundation` passou **exit 0** com lint/typecheck,
**228 unitários + 56 integrações + 44 E2E (328 testes)** e build standalone novo.
Isso inclui o config final de tracing; a observação histórica acima sobre o gate
anterior permanece como registro daquela execução. O runner usou a porta 3107,
encerrou seu servidor e limpou o banco de testes. Log local:
`.superpowers/sdd/2026-10-12-fundacao/final-fix-verify.log`.
Depois do gate, somente o tratamento de erro das escritas de fixture de sessão
foi tornado genérico para impedir diagnósticos com dados privados. O foco final
auth-PIN/auditoria passou **17/17, exit 0**; código de produção permaneceu igual.
A revisão subsequente fica a cargo do controlador; este registro não antecipa seu
veredito. CI hospedada e deploy continuam fora desta evidência.


## Encerramento da entrega

As oito tarefas e a revisão final estão concluídas. A onda única de correções `63e5c37` fechou a validade PIN no protocolo auth e o log seguro das recusas de domínio. A revisão escopada aprovou ambos, sem novos achados.

Evidência atual: **228 unitários + 56 integrações + 44 casos de navegador = 328 testes**, lint/types/build aprovados. O ajuste posterior exclusivamente de diagnóstico das fixtures passou em 17/17 casos focados; nenhum arquivo de produção mudou depois do gate completo. [Revisão final e fechamento](2026-10-13-fundacao-final-review.md).

CI permanece configurada e revisada, sem execução hospedada. Branch `codex/fundacao` pronta para a escolha de integração; checkout principal preservado.
