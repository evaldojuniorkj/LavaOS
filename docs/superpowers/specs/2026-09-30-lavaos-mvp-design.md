# LavaOS — Especificação do MVP

- **Data:** 2026-09-30
- **Atualização:** 2026-10-27 — despacho para um único lavador, comissão por serviço, adicionais, painel para recepção, avaliação do cliente e nova ordem de fases
- **Status:** aprovado pelo usuário em 2026-10-27
- **Escopo:** MVP de software de gestão para lava jatos

## 1. Contexto e objetivos

O LavaOS controla a operação e o financeiro de um lava jato: fila de veículos, ordens de serviço, caixa, despesas, comissões da equipe, agenda interna, aviso de status ao cliente e fidelidade configurável.

- **Agora:** atende **um lava jato real**, usado para validar o produto.
- **Depois:** vira **SaaS** para vários lava jatos. Por isso todo dado pertence a um tenant (`tenant_id`) desde o primeiro dia, e nenhuma consulta é feita sem esse filtro.

### Usuários e dispositivos

| Perfil | Onde usa | Para quê |
|---|---|---|
| Recepção | Computador no balcão | Abrir OS, direcionar ao lavador, receber pagamento, agenda, caixa do dia, acompanhar o painel |
| Lavador | Próprio celular Android (PWA; iPhone funciona sem vibração e sem botão de instalar) | Ver fila, lançar/pegar lavagem, mudar status |
| Gerente | Computador ou celular | Tudo da operação + financeiro e comissões |
| Dono | Celular, de qualquer lugar | Acompanhar o dia, financeiro, configurações |
| Cliente final | Link no WhatsApp | Acompanhar o status do próprio carro |

### Premissas

- Internet estável no lava jato: sistema **100% online**, sem modo offline.
- Pagamentos são feitos na maquininha/Pix existente; o sistema **apenas registra** forma e valor.
- Agenda é **interna** (a equipe agenda); o cliente não agenda sozinho.
- A primeira entrega valida a operação do pátio. A fidelidade é a **última etapa, opcional**, sem ser requisito para nenhuma fase anterior.

### Fora do MVP

Nota fiscal (NFS-e), planos mensais/assinatura de lavagem, estoque de produtos, pagamento integrado (Pix/maquininha), WhatsApp automático via API oficial, contas a receber ("fiado"), vales/adiantamentos de comissão, perfis de acesso personalizáveis, cobrança SaaS e onboarding self-service de novos lava jatos.

## 2. Arquitetura

### Stack

- **Next.js (App Router) + TypeScript**: aplicação única (telas + lógica de negócio + rotas), servidor Node de longa duração.
- **PostgreSQL 16** + **Drizzle ORM** (consultas tipadas, migrations versionadas).
- **Better Auth** para autenticação; o plugin de organizações representa o lava jato (tenant).
- **Tailwind CSS + shadcn/ui**, layout responsivo; app instalável como **PWA**.
- **pnpm** como gerenciador de pacotes.

### Ambientes

- **Local:** `docker compose up` sobe o Postgres; `pnpm dev` roda o app.
- **Produção (VPS do usuário):** Docker Compose com app (build `standalone` do Next.js) + Postgres + **Caddy** (reverse proxy com HTTPS automático). Backup diário com `pg_dump` e retenção configurável.

### Tempo real

- Mudanças relevantes (OS criada, status alterado, responsável adicionado, pagamento registrado, caixa aberto/fechado) são gravadas no banco e publicadas com `NOTIFY` no Postgres, no canal do tenant.
- O servidor mantém um `LISTEN` e repassa os eventos para os clientes conectados via **Server-Sent Events** (`/api/eventos`).
- Cada conexão SSE é autenticada; o servidor só envia eventos do tenant da sessão e **filtra o conteúdo por perfil** (evento enviado ao lavador não contém valores em R$).
- O link público de acompanhamento tem um canal SSE próprio, restrito à OS do token.
- O `EventSource` reconecta sozinho; ao reconectar, o cliente recarrega o estado atual da fila.

### Organização do código

```
src/
  app/                 # rotas e telas (App Router)
  modules/
    ordens/            # OS, itens, responsáveis, status, eventos
    clientes/          # clientes e veículos
    catalogo/          # portes, serviços, preços
    caixa/             # caixas, pagamentos, despesas
    comissoes/         # regras, lançamentos, acertos
    fidelidade/        # programa, créditos e benefícios (última etapa)
    avaliacoes/        # avaliação do cliente após a entrega
    agenda/            # agendamentos
    equipe/            # membros e perfis
  lib/
    auth/              # sessão, perfis, permissões
    db/                # cliente Drizzle, schema, acesso com escopo de tenant
    realtime/          # NOTIFY/LISTEN e SSE
```

Cada módulo separa:

1. **Regras puras** (`*.rules.ts`): funções sem I/O — cálculo de preço, divisão de comissão, transições de status, fechamento de caixa. Testadas com Vitest.
2. **Repositório** (`*.repo.ts`): acesso ao banco, sempre recebendo o contexto do tenant; não existe função de repositório sem `tenant_id`.
3. **Server actions** (`*.actions.ts`): ponto de entrada das telas; cada uma declara a permissão exigida e valida a entrada com Zod.

Tabelas, campos, telas e regras de módulos futuros são introduzidos nas respectivas fases; a Fase 1 não implementa a infraestrutura de fidelidade, caixa ou comissões.

### Convenções

- Dinheiro em **centavos** (`integer`); porcentagens em **pontos-base** (30% = `3000`). Nunca ponto flutuante.
- O "dia" (caixa, relatórios) usa o fuso **America/Sao_Paulo**.
- Toda tabela tem `id` (UUID), `tenant_id`, `created_at`, `updated_at`.
- Registros financeiros **nunca são apagados**: pagamento errado é estornado e OS errada é cancelada, sempre com motivo e autor.
- Interface e mensagens em português do Brasil.

## 3. Perfis e permissões

Quatro perfis fixos: `dono`, `gerente`, `recepcao`, `lavador`. Cada perfil é um conjunto de permissões definido em código; toda server action e rota exige uma permissão explícita e o servidor recusa com "acesso negado" quando o perfil não a possui. Esconder itens de menu é apenas conveniência — a regra vale no servidor.

| Permissão | Dono | Gerente | Recepção | Lavador |
|---|:-:|:-:|:-:|:-:|
| `fila:ver` — ver fila em tempo real | ✅ | ✅ | ✅ | ✅ |
| `os:abrir` — abrir OS | ✅ | ✅ | ✅ | ✅ |
| `os:assumir` — pegar uma OS que ainda não tem responsável | ✅ | ✅ | ❌ | ✅ |
| `os:atribuir` — direcionar a OS a um lavador ou corrigir o responsável | ✅ | ✅ | ✅ | ❌ |
| `os:avancar` — mudar status até "pronto" | ✅ | ✅ | ✅ | ✅ |
| `os:corrigir` — voltar status, editar itens | ✅ | ✅ | ✅ | ❌ |
| `os:entregar` — marcar entregue | ✅ | ✅ | ✅ | ❌ |
| `os:cancelar` — cancelar OS | ✅ | ✅ | ✅ | ❌ |
| `os:reabrir` — reabrir OS entregue | ✅ | ✅ | ❌ | ❌ |
| `os:ajustar_valor` — desconto / acréscimo | ✅ | ✅ | ❌ | ❌ |
| `clientes:gerenciar` | ✅ | ✅ | ✅ | ❌ |
| `agenda:gerenciar` | ✅ | ✅ | ✅ | ❌ |
| `caixa:operar` — abrir, receber, fechar | ✅ | ✅ | ✅ | ❌ |
| `caixa:reabrir`, `caixa:estornar` | ✅ | ✅ | ❌ | ❌ |
| `despesas:gerenciar` | ✅ | ✅ | ❌ | ❌ |
| `relatorios:ver` | ✅ | ✅ | ❌ | ❌ |
| `comissoes:gerenciar` — ver, regras, acertos | ✅ | ✅ | ❌ | ❌ |
| `fidelidade:consultar` — ver progresso e benefícios do cliente | ✅ | ✅ | ✅ | ❌ |
| `fidelidade:resgatar` — aplicar um benefício à OS | ✅ | ✅ | ✅ | ❌ |
| `fidelidade:configurar` — ativar e configurar o programa | ✅ | ✅ | ❌ | ❌ |
| `catalogo:gerenciar` — portes, serviços, preços | ✅ | ✅ | ❌ | ❌ |
| `equipe:gerenciar` — cadastrar recepção/lavador | ✅ | ✅ | ❌ | ❌ |
| `equipe:gerenciar_lideranca` — cadastrar dono/gerente | ✅ | ❌ | ❌ | ❌ |

**Regras adicionais:**

- O **lavador nunca recebe valores em R$** — nem nas telas, nem nas respostas das actions, nem nos eventos SSE.
- A recepção vê o total recebido no dia ao operar e fechar o caixa (aceito).
- O lavador pode abrir uma OS **somente para si**: o servidor define o responsável pelo membro autenticado e recusa a indicação de outro membro. A tela não oferece escolha de responsável.
- Quem abriu a OS, quem fez cada ação e quem executou a lavagem são informações distintas. Recepção atribui a lavagem a um membro ativo sem se tornar responsável; dono/gerente só assumem a execução quando de fato participarem do serviço.
- `painel:ver` (dono, gerente e recepção) é introduzida na fase do painel; o lavador não a possui.
- As permissões de fidelidade são habilitadas com a etapa de fidelidade. Aplicar um benefício válido não exige a permissão de desconto manual.

### Login

- Dono, gerente e recepção: **e-mail + senha**.
- Lavador: **usuário + PIN numérico** (4 a 6 dígitos), criado pelo dono/gerente; sessão de 30 dias no PWA. Bloqueio temporário após 5 tentativas erradas.
- Dono/gerente pode redefinir o PIN de um lavador e desativar membros (membro desativado perde a sessão imediatamente).

## 4. Modelo de dados

Todas as tabelas incluem `id`, `tenant_id`, `created_at`, `updated_at` (omitidos abaixo).

### Tenant e equipe

- **`lava_jatos`**: `nome`, `telefone`, `endereco`. É o tenant.
- **`membros`**: `user_id`, `perfil` (`dono` | `gerente` | `recepcao` | `lavador`), `nome_exibicao`, `ativo`. Único por (`tenant_id`, `user_id`). Tabelas de usuário/sessão são as do Better Auth.

### Catálogo

- **`portes`**: `nome` (ex.: Moto, Carro pequeno, SUV/Sedan grande, Caminhonete), `ordem`, `ativo`.
- **`servicos`**: `nome`, `descricao`, `duracao_estimada_min`, `ativo`, `adicional` (verdadeiro ⇒ só pode ser incluído numa OS que tenha ao menos um serviço principal), `comissao_tipo` (`percentual` | `fixo`) e `comissao_valor` (pontos-base ou centavos), obrigatórios e definidos por `catalogo:gerenciar` no cadastro. Variações (ex.: “Lavagem completa sem motor”) são serviços cadastrados à parte, cada um com seu preço por porte.
- **`precos`**: `servico_id`, `porte_id`, `valor_centavos`. Único por (`servico_id`, `porte_id`). Sem preço para um porte ⇒ serviço indisponível para esse porte.

### Clientes

- **`clientes`**: `nome`, `telefone` (WhatsApp, formato E.164), `observacoes`.
- **`veiculos`**: `placa` (normalizada: maiúsculas, sem hífen/espaço, aceita padrão antigo `AAA9999` e Mercosul `AAA9A99`), `modelo`, `cor`, `porte_id`, `cliente_id` (opcional). Único por (`tenant_id`, `placa`).

### Ordens de serviço

- **`ordens_servico`**:
  - `numero` — sequencial por tenant (tabela de contador com lock de linha);
  - `veiculo_id`, `cliente_id` (opcional), `agendamento_id` (opcional);
  - `responsavel_id` (membro, opcional) e `atribuido_em`: **um único responsável por OS**, que pode ficar vazio enquanto a OS aguarda;
  - `status` — `aguardando` | `em_lavagem` | `pronto` | `entregue` | `cancelada`;
  - `subtotal_centavos`, `desconto_centavos` (manual), `acrescimo_centavos`, `total_centavos`;
  - `desconto_fidelidade_centavos` — soma dos descontos de brinde dos itens; introduzido com fidelidade, padrão zero;
  - `exige_quitacao` — introduzido na Fase 2: falso nas OSs do piloto e verdadeiro nas novas OSs da fase financeira;
  - `token_publico` — 32 bytes aleatórios em base64url, único;
  - `aberta_por` (membro, imutável), `observacoes`, `motivo_cancelamento`;
  - `entrada_em`, `inicio_lavagem_em`, `pronto_em`, `entregue_em`, `cancelada_em`.
- **`os_itens`**: `os_id`, `servico_id`, `porte_id`, `nome_servico`, `valor_centavos`, `comissao_tipo` e `comissao_valor` **copiados no momento da inclusão** (mudança futura na tabela de preços não altera OS existentes). Na etapa de fidelidade, inclui `desconto_fidelidade_centavos` (padrão zero), preservando o preço original do serviço.
- O responsável é a coluna `ordens_servico.responsavel_id`; não existe tabela de responsáveis nem divisão de serviços entre lavadores. A atribuição e suas correções ficam em `os_eventos`.
- **`os_eventos`**: `os_id`, `tipo` (`status`, `responsavel`, `itens`, `valor`, `reabertura`), `de`, `para`, `membro_id`, `motivo`, `em`. Histórico/auditoria e base do tempo médio de lavagem.

### Caixa e financeiro

- **`caixas`**: `data` (dia em America/Sao_Paulo), `troco_inicial_centavos`, `aberto_por`, `aberto_em`, `fechado_por`, `fechado_em`, `dinheiro_contado_centavos`, `diferenca_centavos`, `status` (`aberto` | `fechado`). No máximo um caixa `aberto` por tenant.
- **`pagamentos`**: `os_id`, `caixa_id`, `forma` (`dinheiro` | `pix` | `debito` | `credito`), `valor_centavos`, `recebido_por`, `recebido_em`, `estornado_em`, `estornado_por`, `motivo_estorno`.
- **`categorias_despesa`**: `nome`, `ativo`, `sistema` (a categoria "Comissões" é de sistema e não pode ser removida).
- **`despesas`**: `categoria_id`, `descricao`, `valor_centavos`, `vencimento` (opcional), `pago_em` (nulo ⇒ conta a pagar), `lancada_por`, `acerto_comissao_id` (opcional).

### Comissões

- A regra de comissão é do serviço (`servicos.comissao_tipo` e `comissao_valor`) e é copiada para `os_itens` na inclusão. Não existem regras por lavador nem regra padrão do tenant.
- **`comissoes`**: `os_item_id`, `os_id`, `membro_id`, `valor_centavos`, `acerto_id` (nulo ⇒ pendente).
- **`acertos_comissao`**: `membro_id`, `periodo_inicio`, `periodo_fim`, `total_centavos`, `pago_em`, `pago_por`.

### Agenda

- **`agendamentos`**: `cliente_id`, `veiculo_id`, `inicio_em`, `servicos_previstos` (`uuid[]` de `servico_id`), `observacoes`, `status` (`agendado` | `compareceu` | `faltou` | `cancelado`), `os_id` (preenchido ao virar OS).

### Avaliação do cliente (Fase 7)

- **`avaliacoes`**: `os_id` (único), `nota` (inteiro de 1 a 5), `comentario` (opcional), `avaliado_em`. Enviada pelo cliente na página pública depois da entrega.

### Fidelidade (última etapa, opcional)

- **`programas_fidelidade`**: `ativo`, `quantidade_lavagens` (inteiro positivo), `servicos_elegiveis` (`uuid[]` de serviços), `servico_brinde_id`, `validade_beneficio_dias` (nulo ⇒ sem validade; caso contrário, inteiro positivo). Um programa por tenant, com configurações iniciais sugeridas de 6 lavagens e brinde de lavagem simples; permanece desativado até dono/gerente configurá-lo.
- **`fidelidade_creditos`**: `cliente_id`, `os_id`, `beneficio_id` (nulo ⇒ crédito ainda não consumido para gerar benefício), `creditado_em`, `revogado_em`, `motivo_revogacao`. Único por (`tenant_id`, `os_id`), garantindo no máximo um crédito por OS. Reentregar uma OS utiliza o mesmo registro de crédito, sem duplicá-lo.
- **`beneficios_fidelidade`**: `cliente_id`, `programa_id`, `servico_brinde_id`, `nome_servico_brinde`, `quantidade_lavagens`, `validade_beneficio_dias`, `emitido_em`, `expira_em` (opcional), `status` (`disponivel` | `reservado` | `resgatado` | `revogado`), `os_resgate_id` e `os_item_resgate_id` (opcionais), `resgatado_em`, `revogado_em`, `motivo_revogacao`. Serviço, nome, meta e validade são copiados na emissão; alterações futuras no programa não mudam o benefício conquistado. Expiração é verificada por `expira_em`, sem exigir tarefa agendada.
- **`fidelidade_eventos`**: `programa_id`, `cliente_id`, `os_id`, `beneficio_id` (os três últimos opcionais conforme o evento), `tipo` (`configuracao` | `credito` | `concessao` | `reserva` | `liberacao` | `resgate` | `revogacao` | `reativacao`), `de`, `para`, `membro_id`, `motivo`, `em`. Histórico das operações e configurações, preservado mesmo após reversões.

## 5. Fluxos

### 5.1 Abertura da OS

1. Usuário digita a placa; o sistema normaliza e busca o veículo.
   - Encontrado: preenche modelo, porte e cliente; mostra as últimas OSs do veículo.
   - Não encontrado: cadastro rápido — placa e porte obrigatórios; modelo, nome e WhatsApp opcionais.
2. Usuário escolhe serviços; só aparecem serviços com preço para o porte. Adicionais (ex.: cera) só aparecem depois de escolhido um serviço principal, e toda OS exige ao menos um principal. O total é a soma dos itens, sem preço de combo. Para o lavador, a tela não mostra valores.
3. O servidor calcula os itens a partir da tabela de preços (nunca confia em valores vindos do cliente).
4. Status inicial:
   - toda OS entra como `aguardando`, sem preencher `inicio_lavagem_em`;
   - aberta por recepção/gerente/dono ⇒ pode aguardar sem responsável ou receber um responsável escolhido explicitamente;
   - aberta por lavador ⇒ fica atribuída automaticamente a ele, sem poder indicar outro membro. O botão "Iniciar lavagem" é uma ação posterior à criação.
5. O lavador pode cadastrar veículo com placa e porte durante a abertura e identificar o cliente, sem editar clientes existentes. Essa autorização restrita pertence a `os:abrir` e não concede gerenciamento geral de clientes. Histórico e respostas nunca incluem valores monetários para esse perfil.

### 5.2 Transições de status

| De | Para | Quem | Condição |
|---|---|---|---|
| `aguardando` | `em_lavagem` | `os:assumir` ("Pegar" / "Iniciar lavagem") ou `os:atribuir` ("Iniciar com responsável") | Sem responsável: quem assume vira o responsável; com responsável: lavador só inicia se for ele. Balcão seleciona o responsável explicitamente. Preenche `inicio_lavagem_em` |
| `em_lavagem` | `pronto` | `os:avancar` | Responsável definido; lavador só se for o responsável |
| `pronto` | `em_lavagem` | `os:corrigir` | Motivo opcional, registrado |
| `em_lavagem` | `aguardando` | `os:corrigir` | Remove o responsável |
| `pronto` | `entregue` | `os:entregar` | Veículo retirado e responsável definido. Fase 1: conferência do pagamento pela rotina externa. A partir da Fase 2, se `exige_quitacao`: soma dos pagamentos ativos igual ao total; total zero dispensa pagamento |
| `aguardando`/`em_lavagem`/`pronto` | `cancelada` | `os:cancelar` | Motivo obrigatório; a partir da Fase 2, sem pagamentos ativos. Libera eventual benefício reservado |
| `entregue` | `pronto` | `os:reabrir` | Disponível a partir da Fase 2, com motivo obrigatório. Na fase de comissões, exige ausência de acerto pago e remove comissões pendentes; na fidelidade, respeita as regras de reversão da seção 5.9 |

- Toda transição é feita com `UPDATE ... WHERE id = ? AND status = <status esperado>`. Se nenhuma linha for afetada, a action retorna conflito ("Essa OS já foi pega por Fulano" / "Essa OS mudou de status") e a tela recarrega.
- Toda transição grava um `os_eventos` e publica evento de tempo real.
- Alteração de status, vinculação de responsável e histórico são feitos na mesma transação. Repetir "Pegar" por quem já é o responsável retorna sucesso sem duplicar evento; "Pegar" concorrendo com "Pronto" ou "Cancelar" respeita o estado atual da OS.
- `aberta_por` nunca muda. O autor do evento é quem realizou a ação; o responsável registrado é quem executa a lavagem. Um lavador não pode iniciar uma OS aguardando atribuída a outro; a correção de atribuição exige `os:atribuir` e histórico.
- `cancelada` é terminal e somente leitura; atendimento retomado exige nova OS. Na Fase 1, `entregue` também encerra a edição, sem reabertura.
- Edição de itens, desconto e acréscimo só é permitida em `aguardando`, `em_lavagem` ou `pronto`; recalcula `total_centavos`. Com fidelidade: `total = subtotal − desconto_manual − desconto_fidelidade + acrescimo`. Total nunca fica negativo.
- O responsável só pode ser alterado nos mesmos estados ativos. Marcar como pronto ou entregar exige responsável definido. Se a soma dos valores dos itens após o brinde for zero, desconto manual e acréscimo gerais ficam zerados; serviços adicionais são lançados como itens cobrados. Esta regra vale desde a fidelidade, independentemente das comissões.
- Com o caixa implantado, qualquer alteração de itens, valores ou benefício é recusada se deixar o total menor que os pagamentos ativos; é necessário estornar o excedente antes de reduzir o valor. A validação e a alteração ocorrem na mesma transação.
- "Entregue" registra a retirada do veículo e não comprova pagamento. OSs do piloto preservam `exige_quitacao = falso`, sem presumir pagamento nem criar cobranças retroativas. Comissões e fidelidade só são geradas após a implantação de seus módulos, sem geração retroativa automática.

### 5.2.1 Direcionamento ao lavador

- Recepção, gerente e dono direcionam a OS a qualquer membro ativo com perfil de lavador; direcionar é opcional (a OS pode ficar sem responsável e ser pega por um lavador).
- A tela mostra cada lavador como **livre** (nenhuma OS `em_lavagem`) ou **ocupado**, e sugere como "próximo" o livre há mais tempo (menor `pronto_em` mais recente ou, sem histórico, o de cadastro mais antigo). A sugestão é só orientação: nada é bloqueado, qualquer lavador pode receber a OS e pode ter várias OSs em lavagem.

### 5.3 Aviso ao cliente

- **Na entrada:** botão "Enviar acompanhamento" abre `https://wa.me/<telefone>?text=<mensagem>` com a mensagem pronta, incluindo o link de acompanhamento.
- **No pronto:** a fila da recepção destaca a OS com o botão "Avisar pronto" (mensagem com veículo e total).
- Sem telefone cadastrado, o botão pede o número e oferece salvá-lo no cliente.
- **Página `/acompanhar/{token}`** (pública, sem login): nome do lava jato, veículo (modelo e placa), linha do tempo do status em tempo real, serviços e total. Não mostra nomes da equipe nem dados de outros clientes. Expira **7 dias após a entrega** (ou cancelamento); token inválido/expirado mostra página genérica, sem revelar se a OS existe. Rota com rate limit.

### 5.4 Caixa

1. **Abrir:** informa troco inicial. Se existir caixa aberto de dia anterior, o sistema exige fechá-lo antes.
2. **Receber:** só com caixa aberto. Um ou mais pagamentos por OS (forma + valor); para dinheiro, informa valor recebido e o sistema mostra o troco. Soma dos pagamentos não pode ultrapassar o total da OS.
3. **Fechar:** o sistema mostra o esperado por forma; usuário informa o dinheiro contado; grava `diferenca_centavos = contado − (troco_inicial + dinheiro recebido)`. Caixa fechado não aceita pagamentos.
4. **Reabrir:** apenas `caixa:reabrir`, registrado.
5. **Estornar pagamento:** apenas `caixa:estornar`, com motivo; não é permitido em OS já entregue (reabrir a OS antes).

OS de total zero pode ser entregue sem pagamento fictício de valor zero e sem caixa aberto. Havendo extras cobrados, estes precisam estar quitados nas OSs que exigem quitação.

### 5.5 Comissões

Geradas na transição para `entregue`, na mesma transação:

1. Para cada item da OS (serviços e adicionais), calcula o **valor-base do item** = `valor_centavos − desconto_fidelidade_centavos`, com desconto manual e acréscimo da OS rateados proporcionalmente a esses valores após o brinde. A sobra de centavos do rateio vai para o item de maior valor-base, garantindo que a soma seja igual ao total da OS. Item totalmente gratuito não recebe esse rateio; se todos os itens forem gratuitos, desconto manual e acréscimo gerais ficam zerados e serviços adicionais são lançados como itens cobrados.
2. A regra de cada item é a copiada em `os_itens` na inclusão (tipo e valor definidos no serviço); como o campo é obrigatório no serviço, sempre existe.
3. Calcula a comissão cheia do item pela regra (arredondamento meio-para-cima em centavos):
   - **Percentual:** `valor-base × pontos-base / 10000`.
   - **Fixo:** o valor fixo da regra.
   - No serviço de brinde, regra percentual gera zero porque a base é zero; regra fixa mantém o valor contratado. O benefício não altera a regra de remuneração da equipe.
4. O responsável da OS recebe a comissão inteira de cada item, em um registro de `comissoes` por item. Não há divisão entre lavadores.

**Acerto:** dono/gerente escolhe lavador e período, revisa as comissões pendentes e confirma "Pagar acerto". Na mesma transação: cria `acertos_comissao`, vincula as comissões e cria uma despesa paga na categoria "Comissões".

### 5.6 Despesas

- Lançar despesa paga (com data) ou a pagar (com vencimento).
- Lista de contas a pagar ordenada por vencimento, vencidas em destaque; ação "Marcar como paga".

### 5.7 Agenda

- Visão diária por horário; criar, editar e cancelar agendamento.
- Botão de lembrete por WhatsApp (mesmo mecanismo `wa.me`).
- "Iniciar OS" cria a OS preenchida a partir do agendamento e marca `compareceu`; "Faltou" marca o não comparecimento.

### 5.8 Relatórios

- **Painel** (dono, gerente e recepção; PC e celular; tempo real; tela inicial do dono e do gerente no celular): OSs por status, entregues no dia, tempo médio de lavagem, OSs atrasadas (aguardando ou em lavagem há mais de 60 minutos, valor fixo), lavadores livres/ocupados e, após o caixa, recebido no dia por forma e caixa aberto/fechado. Faturamento por período, despesas e resultado continuam só para dono e gerente.
- **Por período:** faturamento (recebido) por dia, por serviço e por forma; despesas por categoria; **resultado = recebido − despesas pagas** (regime de caixa); ticket médio; carros por dia; tempo médio de lavagem (`inicio_lavagem_em` → `pronto_em`).

### 5.8.1 Avaliação do cliente (Fase 7)

Depois da entrega, a página `/acompanhar/{token}` oferece nota de 1 a 5 e comentário opcional, uma única vez por OS e dentro da validade do link. Dono e gerente veem notas e comentários e a média por período. Sem disparo automático de WhatsApp.

### 5.9 Fidelidade

Programa simples por cliente: **a cada N lavagens elegíveis e pagas, ganha um serviço de brinde no próximo atendimento**. Exemplo: 6 lavagens qualificadas geram uma lavagem simples gratuita na sétima visita; o brinde não conta para o próximo benefício. Depende do caixa, mas não depende do módulo de comissões; as regras que relacionam os dois módulos só são aplicadas quando ambos estiverem implantados.

**Configurações por lava jato:**

| Opção | Regra / exemplo |
|---|---|
| Programa ativo | Dono/gerente podem ativar ou desativar |
| Quantidade necessária | Inteiro positivo; exemplo: 6 lavagens |
| Serviços que contam | Lista do catálogo; exemplo: lavagem simples e completa |
| Serviço de brinde | Um serviço do catálogo; exemplo: lavagem simples |
| Validade do benefício | Sem validade ou quantidade de dias contada desde a emissão |

**Contagem e concessão:**

1. Participação exige cliente cadastrado e identificado na OS; nome e telefone devem estar preenchidos. A contagem pertence ao cliente no lava jato e pode acumular atendimentos de veículos diferentes. Abertura de OS para quem não participa continua permitindo cliente opcional.
2. Na entrega, uma OS quitada, de total maior que zero e com ao menos um serviço elegível efetivamente cobrado após descontos registra **um crédito**, independentemente da quantidade de serviços. OS com brinde não gera crédito, mesmo que tenha extras pagos. O programa precisa estar ativo; não existe importação automática de lavagens anteriores à implantação.
3. Ao atingir a quantidade configurada, os créditos disponíveis mais antigos são vinculados a um novo benefício. A geração e o registro do crédito ocorrem na mesma transação da entrega; repetições não duplicam crédito ou benefício. Créditos excedentes permanecem para o próximo benefício, e o cliente pode acumular benefícios.
4. Mudanças na configuração preservam créditos existentes e benefícios conquistados. Serviços elegíveis são avaliados nas próximas entregas; a meta atual é usada na próxima concessão, consumindo a quantidade correspondente de créditos disponíveis. Alterar a configuração não emite benefícios por si só; a próxima entrega elegível verifica o saldo. Benefícios já emitidos conservam serviço e validade originais. Desativar o programa suspende novas contagens e concessões, mas permite usar benefícios já emitidos dentro da validade.

**Resgate:**

1. Recepção/dono/gerente identificam o cliente e escolhem um benefício disponível e não expirado numa OS em `aguardando`, `em_lavagem` ou `pronto`. O benefício deve pertencer ao cliente e ao tenant da OS e ter sido conquistado em atendimento anterior.
2. O serviço de brinde precisa estar disponível para o porte do veículo. O benefício cobre integralmente **um item** desse serviço pelo preço copiado na OS, registrado como `desconto_fidelidade_centavos`; extras continuam com seus preços normais. Exemplo: lavagem simples de R$ 50 + extra de R$ 30, com brinde da simples ⇒ total de R$ 30. No recorte inicial, permite-se um benefício por OS.
3. A aplicação reserva o benefício exclusivamente para aquela OS, em uma transação; duas OSs não podem usar o mesmo benefício. A validade é conferida também na entrega. Benefício expirado deve ser removido antes de entregar, restaurando o preço do serviço.
4. A entrega muda o benefício de `reservado` para `resgatado` e registra OS, item, autor e horário no histórico. Remover o brinde ou cancelar a OS libera a reserva e recalcula os valores; se já expirado, o benefício continua indisponível. Trocar o cliente ou excluir/alterar o item beneficiado exige remover o benefício primeiro.
5. O catálogo não pode excluir definitivamente serviços vinculados a benefícios; desativá-los para novas vendas preserva o resgate dos benefícios emitidos, usando os preços existentes para o porte. Sem preço para o porte, a aplicação é recusada e o benefício permanece disponível.

**Correções e histórico:**

- Créditos, concessões, reservas, resgates e revogações mantêm autor, horário e motivo quando houver correção; não são apagados. Alterações de configuração também registram autor e horário.
- Concessão, reversão, reserva e resgate são serializados por cliente do tenant, bloqueando a linha do cliente durante a transação e mantendo uma ordem consistente de bloqueio dos registros envolvidos. Entregas simultâneas não consomem os mesmos créditos, e um benefício não pode ser usado enquanto sua origem é revertida.
- Para manter este módulo pequeno, não se permite reabrir uma OS que consumiu um brinde, nem uma OS cujos créditos geraram um benefício já reservado ou resgatado. Essas correções com efeitos em outros atendimentos ficam fora desta etapa.
- Se a OS reaberta concedeu apenas crédito ainda livre, ele é revogado. Se ajudou a gerar benefício ainda disponível e sem uso, esse benefício é revogado, todos os seus créditos são desvinculados, os demais voltam ao saldo e o crédito da OS é revogado. Uma nova entrega revalida a elegibilidade antes de reativar o crédito, sem duplicação.
- A regra de comissão do serviço gratuito segue a seção 5.5; a configuração da fidelidade não cria regras adicionais de comissão.

## 6. Telas

- **Recepção / gerente / dono (desktop):** menu lateral — Painel, Fila (colunas Aguardando | Em lavagem | Pronto), Nova OS, Agenda, Clientes, Caixa; para dono/gerente também Despesas, Comissões, Relatórios, Configurações (lava jato, portes, serviços, preços, regras de comissão, equipe, categorias de despesa e fidelidade). Quando a fidelidade estiver disponível, a ficha do cliente e a OS mostram progresso, benefícios e ação de resgate para os perfis autorizados.
- **Lavador (PWA mobile):** apenas Fila (cartões grandes com Pegar / Iniciar lavagem / Pronto) e "+ Nova lavagem". Nova lavagem é atribuída ao próprio lavador e fica aguardando até ele iniciar; uma OS atribuída a outro não oferece "Pegar". Alvos de toque grandes, sem valores ou escolha de outro responsável.
- **Dono (mobile):** abre no Painel do dia.
- **Cliente:** `/acompanhar/{token}`.
- **Primeiro acesso:** assistente cria o lava jato, o usuário dono, portes padrão e serviços de exemplo para ajustar preços.

## 7. Tratamento de erros

- Validação de entrada com Zod em toda action; mensagens de erro em português, próximas ao campo.
- Conflitos de concorrência (status, caixa) retornam erro específico e a tela recarrega o estado.
- Falha de permissão retorna "acesso negado" sem detalhar o recurso; tentativas são registradas em log.
- Operações com mais de uma escrita (status + responsáveis + histórico, entrega + comissões + fidelidade, reserva/resgate de benefício, reversão de crédito, acerto + despesa, fechamento de caixa) rodam em **uma transação**, conforme os módulos já implantados.
- Perda da conexão SSE mostra um indicador discreto "reconectando…"; ações continuam funcionando via requisições normais.

## 8. Testes

- **Unitários (Vitest):** regras puras — preço por porte, rateio de desconto, resolução de regra de comissão, divisão e arredondamento, transições de status permitidas, cálculo de fechamento de caixa, normalização de placa. Na etapa de fidelidade: elegibilidade, meta configurável, validade, preço de extras, serviço gratuito com comissão percentual/fixa e preservação dos benefícios após mudança de configuração.
- **Integração (Vitest + Postgres em Docker):** repositórios e actions, incluindo:
  - **isolamento de tenant:** dados criados no tenant A nunca aparecem em consultas do tenant B;
  - **permissões:** para cada action, perfis sem permissão recebem "acesso negado"; lavador nunca recebe campos monetários;
  - concorrência no "Pegar", "Pegar" contra "Pronto" e fechamento de caixa;
  - lavador abre OS aguardando atribuída a si, não atribui a outro e só inicia OS já atribuída se for responsável; ação de balcão registra autor diferente do executor;
  - OS cancelada bloqueia edição; entrega do piloto não exige pagamento nem gera lançamentos retroativos;
  - na fidelidade: um crédito por OS, nenhuma pontuação para brinde, geração repetida sem duplicação, concessões simultâneas para o mesmo cliente, reserva concorrente, resgate concorrendo com reversão, validade na entrega, liberação ao cancelar e reversão dos créditos sem benefícios já utilizados;
  - aplicação de benefício e edição de valores não podem reduzir o total abaixo dos pagamentos ativos;
  - OS de total zero dispensa pagamento e caixa aberto; OS com extras exige a quitação correspondente quando aplicável.
- **Ponta a ponta (Playwright):** por fase, o fluxo principal — ex.: abrir OS → pegar → pronto → receber → entregar → comissão gerada.
- **Ponta a ponta de fidelidade:** cliente completa 6 OSs elegíveis e pagas → recebe benefício → resgata lavagem simples na próxima OS → paga apenas os extras → entrega consome benefício sem gerar novo crédito.
- Scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`.

## 9. Fases de entrega

Cada fase tem seu próprio plano, escrito quando chegar a sua vez, e uma branch própria integrada à `main` só após a revisão final da fase.

**Ordem de execução (revista em 2026-10-31):** 4 → 5 → 8 → 6 → 7 → 3 → 9. Os números das fases não mudam; o porquê e o escopo de cada uma estão no [roteiro](../plans/2026-10-31-roteiro.md).

| Fase | Conteúdo | Resultado |
|---|---|---|
| **0. Fundação** | Next.js, Docker Compose (Postgres), Drizzle e migrations, Better Auth (e-mail/senha e usuário/PIN), tenant e membros, perfis e permissões, layout base, scripts de qualidade, infraestrutura de testes | Base pronta |
| **1. Operação** | Catálogo (serviços, adicionais, preços por porte, comissão por serviço), clientes e veículos, OS com um responsável, direcionamento e sugestão de lavador livre, fila em tempo real (NOTIFY + SSE), PWA do lavador (Android-first), link de acompanhamento, botões de WhatsApp, assistente de primeiro acesso | Controla o pátio; entrega sem validação financeira, cancelada somente leitura e entregue sem reabertura |
| **2. Painel** (concluída) | Painel operacional para dono, gerente e recepção (PC e celular); recebido do dia fica na Fase 4 | Acompanhamento ao vivo |
| **3. App nativo do lavador** | App Expo (Android e iPhone) com API JSON sobre os mesmos serviços e push | Lavador com app de loja |
| **4. Dinheiro** | Caixa (abrir, receber, fechar, reabrir, estornar), novas OSs exigem quitação e OSs do piloto preservam a regra anterior, reabertura de OS entregue, despesas e contas a pagar; painel ganha o recebido do dia | Substitui o controle de caixa |
| **5. Comissões** | Geração na entrega a partir da regra do serviço, reabertura remove comissões pendentes e é bloqueada após acerto pago, acertos com despesa automática | Acerto da equipe |
| **6. Gestão** | Agenda e relatórios por período | MVP completo |
| **7. Avaliação do cliente** | Nota e comentário na página pública, visão para dono e gerente | Feedback do cliente |
| **8. Produção** | Imagem Docker do app, Compose de produção com Caddy (HTTPS), backup diário, guia de deploy/atualização | Online na VPS |
| **9. Fidelidade (opcional)** | Programa configurável por lava jato, contagem por cliente, benefício a cada N OSs elegíveis e pagas, validade, reserva e resgate, extras cobrados e histórico | Cliente ganha e usa o serviço de brinde |

Antes da Fase 8 os testes com lavadores acontecem no navegador do celular em rede local; a instalação do PWA exige HTTPS e só vale na produção.

## 10. Caminho para SaaS (não implementado no MVP)

Já preparado: `tenant_id` em todas as tabelas, repositórios com escopo obrigatório de tenant, membros desacoplados de usuários, organizações do Better Auth. Faltará: cadastro self-service de lava jatos, cobrança de assinatura, perfis personalizáveis e painel administrativo da plataforma.
