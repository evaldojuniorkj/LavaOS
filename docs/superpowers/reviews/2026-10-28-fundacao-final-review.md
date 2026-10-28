# Fase 0 — Fundação: revisão final da branch (2a59039..bdcbac8)

Revisor: final whole-branch (code-reviewer + lente ponytail-audit). Somente leitura; nenhum subagente.
Feita em uma passada: código-fonte, SQL das migrations, testes, configs, docs. Lockfile e snapshots do drizzle não foram lidos.

## Veredito

**READY AFTER FIXES.** Não encontrei nenhum defeito Critical nem Important no código. As cinco falhas do Review Focus estão fechadas no servidor e têm testes que provam isso. Antes do merge restam duas coisas: (1) o CI nunca rodou de verdade, e CI é uma linha da matriz de aceite; (2) duas frases da documentação são falsas. Todo o resto vai para a Fase 1 ou para a Fase 8.

## Pontos fortes

- O guard é a única fonte de verdade: `context.ts:26-48` relê sessão, membro ativo, perfil e versão do PIN com uma query só, e não confia em nada que veio do cliente. Toda página e toda action passa por ele (`layout.tsx:10`, `inicio/page.tsx:8`, `equipe/page.tsx:12`, `login/page.tsx:12`, `page.tsx:6`, `equipe.actions.ts:22`).
- `/api/auth/*` nega por padrão antes do roteamento (`server.ts:115-124` + `route-policy.ts:5-17`), com igualdade exata do caminho. Codificação de caminho, barra final e `..` não passam.
- A ordem de travas é consistente e não deixa ciclo: equipe trava tenant → ator → alvo → credencial; o login PIN trava só a credencial, e o UPDATE do contador não muda colunas de FK, então não pega KEY SHARE em `lava_jatos`/`membros`. Não há deadlock possível entre contador do PIN e reset/desativação.
- O scrypt roda fora da transação em `createMember`/`resetPin` (`equipe.service.ts:75,116`).
- A matriz de permissões bate com a spec §3 célula por célula (conferi as 24 linhas × 4 perfis à mão). O teste usa uma tabela independente e igualdade de conjunto (`tests/unit/permissions.test.ts`).
- Higiene: nada indevido versionado (`.env*`, `test-results/`, `.next/`, `*.tsbuildinfo`, `AGENTS.md` estão no `.gitignore`). As 8 dependências de runtime têm versão fixa e todas são importadas. As contagens do CODEBASE_MAP (89/38/25 arquivos, 1673 linhas em src) conferem com a árvore real.

## Review Focus — rastreado de ponta a ponta

| # | Falha | Proteção | Testes que provam | Caminho não coberto |
|---|---|---|---|---|
| 1 | Cookie legítimo com tenant/UUID adulterado | O cookie leva só token assinado; o tenant sai de `session.active_organization_id` + JOIN em `membros`; `set-active` passa pelo hook (`server.ts:74-78`); `update-session` dá 404 | tenant-context "nega claim adulterado", "tenant ativo ausente/inexistente/de outro usuário", "id malformado"; auth-staff "cookie adulterado", "dono de A não seleciona B", "seleção sem vínculo ativo" (inclui `organizationSlug` e `'x'`); E2E foundation-security "dono de A com alvo de B" | "dono de A não seleciona B" não confere que o guard ainda devolve A (Minor da T4) |
| 2 | Membro desativado com tela aberta ou cookie antigo | `deactivateMember` apaga todas as sessões do user; o guard exige `membros.ativo`; o hook de get-session/list/set-active consulta vínculo ativo | session-revocation "perde todas as sessões… get-session, página e action", "lavador desativado", "revogação global"; auth-staff "mesmo cookie… inclusive endpoints auth"; E2E equipe "desativado no segundo contexto"; E2E security "cookie antigo" | Login concorrente com a desativação pode criar uma sessão nova depois do DELETE. O guard e o get-session negam essa sessão (checam `ativo`), mas nenhum teste exercita essa corrida |
| 3 | Cinco PINs errados concorrentes / restart do processo | `FOR UPDATE OF credenciais_lavador` + contador gravado com COMMIT (`pin.repo.ts:66-86`); estado só no Postgres | auth-pin "cinco erros concorrentes… sexta não autentica", "nova instância auth mantém o bloqueio", "limite por origem persistente/atômico" | Com mais de ~50 tentativas na fila para o mesmo usuário, o `lock_timeout` de 5s estoura → 500, mas a tentativa também não é autorizada (falha fechada). Sem teste |
| 4 | Reset concorrendo com login usando o PIN antigo | A sessão grava `pinCredentialVersion`; o guard compara com `credenciais_lavador.versao` (`context.ts:46-48`); o reset trava a credencial, incrementa a versão e apaga as sessões PIN | auth-pin "reset entre verificação e emissão" (ponto de injeção `aposVerificar`); session-revocation "reset concorrente com login (barreira)", "reset depois do login derruba" | O **get-session** não confere a versão: a sessão da corrida volta como válida para o JS do cliente (o guard nega). Ver M1 |
| 5 | Cadastro público / rota nativa de organização usada para promover perfil | Whitelist exata; `disableSignUp`; `allowUserToCreateOrganization:false`; o perfil só é gravado pelo serviço, lido do banco travado | auth-staff "cadastro público negado em GET e POST", "mutações de organização, membro, convite e senha negadas" (20 rotas, verifica o banco depois); E2E security "cadastro público e rotas nativas 404, sem escrita" | — |

## Integração entre tarefas

- **Rotas sem guard:** nenhuma. O único route handler é `/api/auth/[...all]`, que passa pela whitelist. As únicas server actions são as 3 da equipe, todas com `requirePermission`. A página da equipe se protege sozinha; isso importa porque layout e página renderizam em paralelo.
- **Sessão do cliente usada como autorização:** não acontece. `login-form.tsx:59-63` usa `getSession`/`organization.list` só para decidir a navegação; `app-shell` recebe `podeEquipe` calculado no servidor.
- **Revogação:** completa para desativação (todas as sessões do user) e para reset (sessões com `pin_member_id`). A sessão criada na corrida é barrada pelo guard.
- **Locks e pool:** sem deadlock (ver Pontos fortes). Pressão no pool: `verifyAttempt` segura uma conexão (e, se o usuário existe, a linha da credencial) durante um scrypt inteiro. O caminho de usuário desconhecido também faz o scrypt dummy dentro da transação. Com 10 pedidos PIN simultâneos, o pool inteiro (`max: 10`, `client.ts:9`) fica ocupado; os pedidos para o mesmo usuário serializam. O pool não tem `connectionTimeoutMillis`, então as queries do guard de todas as páginas esperam na fila sem limite. O sistema se recupera (um burst dura uns poucos segundos e o limite de 20 por IP restringe cada origem), mas um atacante com muitos IPs pode manter o sistema lento. → Fase 8, com teste de carga.
- **`FOR UPDATE` no tenant** (`equipe.service.ts:58`): hoje só conflita com o primeiro insert de `tentativas_pin_origem` por IP (KEY SHARE da FK). A partir da Fase 1, cada INSERT que referencia `lava_jatos` (OS, clientes…) vai esperar qualquer mutação de equipe em andamento, e uma mutação de equipe vai esperar qualquer transação longa que tenha inserido linhas do tenant (o caixa, por exemplo). `.for('no key update')` mantém a serialização entre mutações de equipe e não conflita com KEY SHARE. Uma palavra; precisa entrar antes da primeira tabela da Fase 1.

## Achados

### Critical
Nenhum.

### Important
Nenhum no código. (O CI que nunca rodou é falta de processo; está na triagem como MUST-FIX.)

### Minor (novos ou reavaliados)

- **M1 `server.ts:79-83`: get-session não confere a versão do PIN.** Cenário: o gerente redefine o PIN enquanto o lavador está entrando. O celular dele recebe um cookie que o get-session mostra como válido, mas toda página ou action nega. O PWA da Fase 1 vai ver "logado" e cair em "acesso negado". Correção: no hook de `/get-session`, chamar a mesma checagem do guard (ou `requireTenantContext(ctx.headers)`) e devolver `null`. → FASE-1.
- **M2 `pin.repo.ts:74-76`: o caminho bloqueado responde sem rodar scrypt.** Usuário desconhecido e PIN errado custam um verify; usuário bloqueado responde dezenas de ms mais rápido. Cenário: um atacante erra 5 vezes num usuário candidato e mede a 6ª resposta; se vier rápida, o usuário existe. Isso quebra a "resposta indistinguível" do Ruling da T5. Correção de uma linha: `await hasher.verify(pin, c.pinHash)` antes do `return`. → FASE-1.
- **M3 `src/lib/env.ts:12-14,20-24`: o runtime exige `MIGRATION_DATABASE_URL` e um `TEST_DATABASE_URL` local em produção.** Cenário: na VPS, o processo web passa a guardar a senha da role de DDL no env (um RCE ou um dump de env entrega o `DROP`), e o deploy precisa de um `TEST_DATABASE_URL` fictício. Isso enfraquece a separação DML/DDL. → FASE-8: tornar os dois opcionais quando `LAVAOS_MODE=production`.
- **M4 `docs/CODEBASE_MAP.md:30` e `tests/e2e/global-setup.ts:23`: dizem que a migration 0000 concede DML ao `lavaos_app`.** Isso é falso: os grants vêm do `ALTER DEFAULT PRIVILEGES` em `scripts/db-local-init.sql`. Cenário: na Fase 8 alguém cria o banco de produção só com `db:migrate` e o app responde "permission denied" em tudo (falha fechada, mas derruba o deploy). → MUST-FIX (doc), e o guia da Fase 8 precisa incluir os grants.
- **M5 `src/lib/db/client.ts:9`: pool sem `connectionTimeoutMillis`/`statement_timeout`.** Sob pressão, as requisições ficam na fila para sempre em vez de falhar rápido. → FASE-8.
- **M6 `pin.plugin.ts:47` + `getIP`: em produção, sem `X-Real-IP` todos caem no balde `'desconhecido'`.** Cenário: o proxy está mal configurado e qualquer pessoa na internet esgota com 20 pedidos a cota de PIN do tenant inteiro a cada 15 min, porque os sucessos também contam. Mesmo com o proxy certo, todos os celulares no Wi-Fi do lava jato dividem um IP. → FASE-8: contar só falhas e checar o header no deploy.
- **M7 `layout.tsx` + página: guard executado duas vezes por render** (cerca de 6-8 queries por página). Aceitável no piloto; usar `React.cache` quando o painel (Fase 2) aumentar o tráfego. → FASE-2.
- **M8 a spec §4 diz que toda tabela tem `id`/`created_at`/`updated_at`;** `tentativas_pin_origem` não tem. É tabela técnica com PK composta. → ACCEPT.
- **M9 código morto:** `findCredential` (`pin.repo.ts:57`, contrato do plano, sem uso) e `PRODUCT_NAME` (`env.ts:4`, sem uso e em módulo server-only, então nem é "público"). → FASE-1: apagar se a Operação não usar.

## Triagem do ledger (cada Minor adiado e cada ⚠️)

| Origem | Item | Decisão | Motivo |
|---|---|---|---|
| T1 | ignorar AGENTS.md / next-env.d.ts; @types/node 24 | ACCEPT (resolvido) | `.gitignore` e `package.json` já fazem isso |
| T1 | env compara host literal (localhost × 127.0.0.1) | ACCEPT | Só development; o `assertTestDb` protege os resets destrutivos |
| T2 | allowlist exata das tabelas no teste de fases futuras | FASE-1 | A Fase 1 cria as primeiras tabelas; a troca é mais barata ali |
| T2 | asserts de linhas afetadas no DML | ACCEPT | Os efeitos já são conferidos por SELECT depois |
| T2 | `drizzle.config.ts` `?? ''` com erro obscuro | ACCEPT | Ferramenta de dev, a falha é visível |
| T2 | CHECK `erros_consecutivos >= 0` | ACCEPT | Só o código grava, a partir de 0 |
| T2 | README: `down -v`, PUBLIC CONNECT/TEMP | FASE-8 | Hardening do banco de produção |
| T2 ⚠️ | `pin_hash` exportado pelo schema | ACCEPT | Cadeia server-only; DTO por allowlist; o hash não aparece em resposta, log nem HTML (testado) |
| T2 | tabela `rate_limit` não gerada | FASE-8 | Storage em memória é suficiente com uma instância só |
| T3 | marca do TenantContext só em compile-time | ACCEPT | O guard é a barreira real; testes adversariais por HTTP |
| T3 | expect de enfeite em equipe-repo.test | ACCEPT | Inofensivo |
| T3 | log de negação | ACCEPT (resolvido) | Feito em `requirePermission` |
| T4 | `session.token` devolvido ao JS pelo get-session | ACCEPT → rever na FASE-3 | O cookie é `token.assinatura` HMAC; sem o plugin bearer o token sozinho não autentica. Se a Fase 3 adicionar bearer, remover em hooks.after |
| T4 | `/organization/list` 403 com tenant ativo desativado | ACCEPT | Falha fechada; as sessões já são apagadas na desativação |
| T4 | "dono de A não seleciona B" não confere o guard | FASE-1 | Um assert |
| T4 | rate limit / x-forwarded-for | FASE-8 | Já lê só `x-real-ip`; o proxy precisa sobrescrever o header |
| T4 ⚠️ | `/inicio`; tenant por query string | ACCEPT (resolvido) | Existe; nenhuma leitura de tenant por query (verificado) |
| T4 ⚠️ | cookie Secure sem teste | FASE-8 | Verificar no deploy HTTPS |
| T4 | colunas logo/metadata (migration 0001) | ACCEPT | Contrato do plugin; o plano permite exceções de lib |
| T4 | POST sem Origin aceito | ACCEPT | SameSite=Lax; navegadores sempre mandam Origin em POST cross-site |
| T5 | 429 revelava o usuário | ACCEPT (resolvido) | Resposta única 401 |
| T5 | get-session devolve sessão PIN de versão velha | FASE-1 | = M1 |
| T5 | limite 20/15min sem limpeza da tabela | FASE-8 | Crescimento de uma linha por IP |
| T5 M2 | delta ~1ms; `dummyHash ??=` no 1º desconhecido | ACCEPT | Só a 1ª requisição após o boot; pré-calcular é opcional |
| T5 M3 | espera de lock de até 5s ocupa conexão do pool | FASE-8 | Recuperável; teste de carga + `connectionTimeoutMillis` (M5) |
| T5 M4 | limite conta sucessos; IPv6 | FASE-8 | A lib já agrega /64 (default); contar só falhas (M6) |
| T5 M5 | `findCredential` sem uso | FASE-1 | Apagar se a Operação não usar (M9) |
| T5 M6 | 6ª tentativa não verifica que o hasher não rodou | ACCEPT | O teste já confere ausência de sessão e de cookie |
| T5 (re-review) | timing bloqueado × desconhecido | FASE-1 | = M2; correção de uma linha |
| T5 ⚠️ | proxy sobrescreve X-Real-IP; app só em loopback | FASE-8 | Documentado no README |
| T5 ⚠️ | reset apaga as sessões; nunca getSession direto | ACCEPT (resolvido) | Verificado |
| T6 | tenant `FOR UPDATE` × `no key update` | FASE-1 (antes da 1ª tabela com FK para `lava_jatos`) | Uma palavra; hoje só conflita com `tentativas_pin_origem` |
| T6 | teste reset × login aceita os dois desfechos | ACCEPT | Os dois desfechos são seguros; com a barreira, o ramo com cookie sempre roda |
| T6 | log de negação sempre diz `equipe:gerenciar` | FASE-1 | Trilha enganosa quando a negação é de liderança |
| T6 | reset de PIN em lavador desativado | ACCEPT | Inofensivo; a UI esconde |
| T6 | "E-mail já em uso" revela existência de e-mail | ACCEPT | Só dono/gerente chegam nessa mensagem |
| T6 | 'postgres' em LOCAL_HOSTS do seed | ACCEPT (resolvido) | Não está mais lá |
| T6 ⚠️ | UI não pode tratar getSession como autorização | ACCEPT (resolvido) | Verificado em login-form e app-shell |
| T7 | Equipe com sessão revogada mostra "Acesso negado" | ACCEPT | Não vaza nada; em navegação completa o redirect do layout vence |
| T7 | URL do banco E2E de fonte única | ACCEPT (resolvido) | `tests/helpers/test-db.ts` |
| T7 | foco perdido após desativar; teclado só no login no E2E | FASE-1 | Acessibilidade das telas novas |
| T7 | "acesso negado" minúsculo | ACCEPT | Texto literal da spec |
| T7 ⚠️ | traces com senha/PIN | ACCEPT | Desligados no CI; `test-results/` ignorado |
| T7 ⚠️ | E2E builda a cada execução | ACCEPT (resolvido) | `E2E_REUSE_BUILD` no verify |
| T7 | `proxy.ts` | ACCEPT | Só redireciona quem não tem cookie; páginas e actions se protegem |
| T8 | replay do lavador no "criar" e assert `alvoA.ativo` não podem falhar | FASE-1 | Fortalecer junto com as próximas actions |
| T8 | verify-foundation não pega skipIf/runIf/xit/concurrent.skip | FASE-1 | Ampliar a regex |
| T8 | README "segredos do CI são efêmeros" exagera | MUST-FIX | As senhas das roles são fixas (`db-local-init.sql`); corrigir a frase (uma linha) |
| T8 | E2E_REUSE_BUILD manual com build velho | ACCEPT | Só o verify define a variável |
| T8 ⚠️ | CI nunca executado | MUST-FIX | Linha "CI" da matriz de aceite; abrir o PR (o remote GitHub existe) e obter uma execução verde antes do merge |
| T8 ⚠️ | migrate do CI mira `lavaos_dev` | ACCEPT | Prova a migration em banco vazio; os testes migram `lavaos_test` sozinhos |
| novo | CODEBASE_MAP/global-setup: falsa afirmação de grants | MUST-FIX | M4; corrigir as duas frases |
| novo | env exige credencial de DDL em produção | FASE-8 | M3 |
| novo | pool sem timeouts | FASE-8 | M5 |
| novo | guard duplicado por render | FASE-2 | M7 |

## Spec drift

Não há nada de fases posteriores: o schema tem só as tabelas auth + `lava_jatos`, `membros`, `convites` (contrato do plugin, fluxo HTTP bloqueado), `credenciais_lavador` e `tentativas_pin_origem`. As telas são só login, início e equipe. As 24 permissões são exatamente as da §3, com `painel:ver` de fora como a spec manda. Na Fundação só as duas permissões de equipe estão em `IMPLANTADAS`. O README e o CODEBASE_MAP descrevem a árvore real, com as exceções em M4 e na frase sobre os segredos do CI.

## Declinei julgar

- Política de lockout para senha de staff: a spec não exige; o rate limit em memória do Better Auth vale só em produção.
- O lavador ser bloqueável por terceiros (5 PINs errados): é consequência inerente da regra da spec.
- Revogação global de sessões entre tenants: escolha documentada do piloto.

## Não verifiquei

- Não rodei nenhum teste, lint ou build. Confio no ledger (verify:foundation verde em 3 rodadas) e só li o código.
- Não confirmei se o rate limiter do Better Auth pula requisições sem IP em produção, o que tiraria o limite do login de staff se faltar `X-Real-IP`.
- Não medi o custo real do scrypt nem a pressão no pool.
- Não executei o CI do GitHub: tags das actions, psql no runner e a porta do service continuam sem confirmação.
- Não li lockfile, snapshots do drizzle nem o restante do `equipe-form.tsx` além da linha 80.
