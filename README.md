# Usina do Seguro — controle interno

Modular monolith em TypeScript. Um comando, um processo, uma porta.

Fonte de verdade dos requisitos: [`requisitos_refinados.md`](./requisitos_refinados.md).
Identificadores `REQ-xxx`, `CA-xxx`, `ITP-xxx` e `DEC-xxx` no código referenciam esse
documento.

> **Estado atual: `Proposta → Apólice → Parcela → Comissão → Conciliação → Repasse`.**
> `FP-01` vai do registro da proposta (`REQ-040`), passa pelo rastreio das propostas em
> aberto (`REQ-043`, `OUT-01`, passo 5) e chega ao cálculo da comissão acordada no
> momento em que a apólice nasce (`REQ-048`, `REQ-075`, passo 7). `FP-02` concilia o
> relatório de comissionamento contra as apólices (`REQ-082`, `REQ-083`, `REQ-086`) e
> `FP-03` conduz o repasse ao corretor até o registro do pagamento (`REQ-090`–`REQ-095`).
>
> O controle das apólices vendidas e das que estão a vencer (`REQ-055`, `OUT-03`,
> `OUT-04`) é lido da mesma base.
>
> **Fora**: notificação (`REQ-100`–`REQ-105`), cotação, **geração** da renovação
> (`REQ-056`), endosso, sinistro e cancelamento de apólice. O *parser* do arquivo de comissionamento também não existe —
> `DEC-001` não definiu o layout; a conciliação recebe linhas já estruturadas. Ver
> [Decisões em aberto](#decisões-de-negócio-em-aberto).

## Idioma

**Código, nomes de arquivo, identificadores, comentários e descrições de teste são em
inglês.** Todo texto destinado a pessoas é em português e existe em um único lugar:
o dicionário [`src/i18n/messages.ts`](./src/i18n/messages.ts).

O domínio nunca produz frase pronta — ele emite uma **chave estável** mais parâmetros:

```
domínio                              i18n                        HTTP
BusinessRuleViolation(               translate(key, params)      422
  'REQ-040',                    →    "Proposta exige aceite  →   { "rule": "REQ-040",
  'proposal.customer_...' )           do cliente registrado."       "message": "Proposta …" }
```

Duas garantias automáticas:

- o dicionário é tipado como `Record<MessageKey, string>`, então **adicionar uma chave
  no domínio sem traduzir quebra o `npm run typecheck`**;
- um teste de arquitetura falha se qualquer arquivo de `core/**/domain/` contiver
  acento — sinal de que uma frase para o usuário vazou para dentro do domínio.

Exceção deliberada: erros de **configuração** (`src/config/config.ts`) ficam em inglês.
Eles abortam o boot e são lidos por desenvolvedor ou operador, nunca por usuário final.

A documentação (este arquivo, `SQLITE-NOTES.md`) segue em português, acompanhando o
documento de requisitos.

## Requisitos

Node **>= 22.6** (usa execução nativa de TypeScript e `node:sqlite`; validado em 24.11).
Nenhuma dependência nativa compilada, nenhum passo de build.

```bash
npm install
```

## Executar

```bash
npm start          # sobe o serviço
npm run dev        # mesmo, com reload em alteração de arquivo
```

Configuração por ambiente (ver [`.env.example`](./.env.example)); todos têm default:

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `127.0.0.1` | Interface de escuta |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PERSISTENCE_DRIVER` | `sqlite` | `memory` \| `sqlite` \| `postgres` |
| `SQLITE_FILE` | `./data/usina.sqlite` | Só para o driver `sqlite` |
| `DATABASE_URL` | — | Obrigatório para `postgres` |

Prova de vida:

```bash
curl http://127.0.0.1:3000/health
# {"status":"ok"}
```

Fluxo `FP-01` completo:

```bash
# 1. Registrar a proposta (REQ-040)
curl -X POST http://127.0.0.1:3000/proposals -H 'content-type: application/json' -d '{
  "clientId":"client-1","brokerId":"broker-1","insurerId":"insurer-1","productId":"auto",
  "paymentMethodId":"bank-slip","customerAccepted":true,"netPremium":"1200.00"
}'
# 201 {"id":"<proposta>","status":"DRAFT","netPremium":"1200.00","registeredAt":"..."}

# 2. Transmitir à seguradora, com número e comissão trabalhada (REQ-041)
curl -X POST http://127.0.0.1:3000/proposals/<proposta>/transmission \
  -H 'content-type: application/json' \
  -d '{"proposalNumber":"PRP-9001","workedCommission":"32.5"}'
# 200 {"status":"TRANSMITTED","proposalNumber":"PRP-9001","workedCommission":"32.5",...}

# 3. Em aberto, rastreável (REQ-043, OUT-01, passo 5)
curl 'http://127.0.0.1:3000/proposals?status=TRANSMITTED'
# 200 [{"id":"<proposta>","status":"TRANSMITTED","proposalNumber":"PRP-9001",
#       "workedCommission":"32.5","netPremium":"1200.00",...}]
#
# Sem filtro lista todas; `status=REJECTED` é o relatório de recusadas (OUT-02).
curl http://127.0.0.1:3000/proposals/<proposta>

# 4a. Desfecho recusa: motivo obrigatório (REQ-045)
curl -X POST http://127.0.0.1:3000/proposals/<proposta>/rejection \
  -H 'content-type: application/json' -d '{"reason":"perfil de risco"}'
# 200 {"status":"REJECTED","rejectionReason":"perfil de risco"}

# 4b. Desfecho aceite: registra a apólice e as parcelas (REQ-048, REQ-020)
curl -X POST http://127.0.0.1:3000/policies -H 'content-type: application/json' -d '{
  "proposalId":"<proposta>","policyNumber":"APL-4711","premium":"1200.00",
  "coverageStart":"2026-10-01","coverageEnd":"2027-09-30","renewalDate":"2027-09-30",
  "installments":[
    {"number":1,"amount":"600.00","dueDate":"2026-10-10"},
    {"number":2,"amount":"600.00","dueDate":"2026-11-10"}
  ]
}'
# 201 {"id":"<apolice>","policyNumber":"APL-4711","proposalNumber":"PRP-9001",
#      "status":"ACTIVE","installments":[{"number":1,...,"status":"PENDING"},...]}

# 5. Consultar: os dois números e o cronograma (CA-008)
curl http://127.0.0.1:3000/policies/<apolice>

# A apólice que a proposta originou, para quem partiu do rastreio (REQ-049, REQ-050)
curl http://127.0.0.1:3000/proposals/<proposta>/policy

# 6. O controle das apólices vendidas (OUT-03), da renovação mais próxima
#    para a mais distante (REQ-055).
curl http://127.0.0.1:3000/policies
# 200 [{"id":"<apolice>","policyNumber":"APL-4711","proposalNumber":"PRP-9001",
#       "status":"ACTIVE","premium":"1200.00","coverageStart":"2026-10-01",
#       "coverageEnd":"2027-09-30","renewalDate":"2027-09-30",...}]

#    As apólices a vencer (OUT-04, CA-032): as que renovam até o dia informado,
#    ele inclusive. A janela é de quem pergunta — nenhum requisito define o que
#    é uma renovação "próxima".
curl 'http://127.0.0.1:3000/policies?renewalUntil=2027-06-30'
```

Fluxo financeiro `FP-02` / `FP-03`:

```bash
# 0. Cadastros do Administrador (IN-02..IN-06), sem os quais não há o que calcular.
#    Cadeia direta: a seguradora paga 40% do prêmio à Usina (REQ-060, REQ-065).
curl -X POST http://127.0.0.1:3000/commission-agreements \
  -H 'content-type: application/json' -d '{
  "insurerId":"insurer-1","productId":"auto","effectiveFrom":"2026-01-01","insurerRate":"40"
}'
# Cadeia com intermediária (REQ-063/REQ-064): base do corretor configurável.
#   "intermediary":{"intermediaryId":"mega","intermediaryRate":"80","brokerBase":"INTERMEDIARY"}

# Tabela do corretor (IN-05): metade do que a Usina recebeu.
curl -X POST http://127.0.0.1:3000/broker-commission-rates \
  -H 'content-type: application/json' -d '{"brokerId":"broker-1","rate":"50"}'

# Regra de liberação por forma de pagamento (REQ-090, REQ-091).
curl -X POST http://127.0.0.1:3000/payment-method-release-rules \
  -H 'content-type: application/json' \
  -d '{"paymentMethodId":"bank-slip","release":"REQUIRES_RECEIPT_CONFIRMATION"}'

# Cada cadastro é lido de volta pela mesma forma com que foi gravado. É o que
# torna REQ-061/REQ-125 utilizáveis: um parâmetro que ninguém consegue conferir
# só aparece errado na comissão que ele já produziu.
curl http://127.0.0.1:3000/commission-agreements
curl http://127.0.0.1:3000/broker-commission-rates
curl http://127.0.0.1:3000/payment-method-release-rules
# Registrar a mesma chave de novo substitui o registro; no acordo comercial a
# chave inclui a vigência, então uma nova vigência é um novo registro e a
# anterior continua listada (REQ-065, REQ-124, CA-012).

# 1. A comissão acordada nasce junto com a apólice (FP-01 passo 7): nada a chamar.
curl http://127.0.0.1:3000/policies/<apolice>/commission
# {"status":"FORECAST","agreedReceivable":"480.00","agreedPayable":"240.00",
#  "realReceivable":null,"divergent":false,...}

# 2. Conciliação do relatório (FP-02). O arquivo em si é DEC-001: aqui entram
#    linhas já estruturadas.
curl -X POST http://127.0.0.1:3000/commission-reconciliations \
  -H 'content-type: application/json' -d '{
  "competence":"2026-10",
  "lines":[{"policyNumber":"APL-4711","proposalNumber":"PRP-9001","producerCommission":"480.00"}]
}'
# 201 {"reconciled":1,"divergent":0,"duplicated":0,"pending":0,"lines":[...]}

curl http://127.0.0.1:3000/commission-reconciliations/pendencies   # OUT-06

#    O painel acordado × real de todas as apólices (OUT-05). Sem filtro é o
#    painel inteiro; por estado é a lista de trabalho de FP-02 passo 5.
curl http://127.0.0.1:3000/commissions
curl 'http://127.0.0.1:3000/commissions?status=DIVERGENT'

# 3. Repasse (FP-03). Em boleto nasce retido (CA-023).
curl -X POST http://127.0.0.1:3000/policies/<apolice>/settlement
# 201 {"status":"AWAITING_CONFIRMATION","amount":"240.00","brokerId":"broker-1"}

#    O extrato de comissão por corretor (OUT-07): previsto, retido, liberado e
#    pago, com os totais somados em centavos exatos. Sem corretor, todos eles.
curl 'http://127.0.0.1:3000/broker-commission-statements?brokerId=broker-1'
# {"brokerId":"broker-1","lines":[...],
#  "totals":{"payable":"240.00","awaitingConfirmation":"240.00","released":"0.00","paid":"0.00"}}

# 4. Confirmação manual do pagamento da 1ª parcela pelo cliente (IN-13, REQ-092).
#    REQ-123 exige registrar quem confirmou: a confirmação é o que libera o repasse.
curl -X POST http://127.0.0.1:3000/policies/<apolice>/installments/1/payment \
  -H 'content-type: application/json' -d '{"userId":"financeiro-1"}'

curl -X POST http://127.0.0.1:3000/policies/<apolice>/settlement/release
# 200 {"status":"RELEASED",...}

# 5. Registro do pagamento enviado ao corretor (REQ-095, CA-028).
curl -X POST http://127.0.0.1:3000/policies/<apolice>/settlement/payment \
  -H 'content-type: application/json' \
  -d '{"amount":"240.00","proofReference":"comprovante.pdf","userId":"financeiro-1"}'
# 200 {"status":"PAID","payment":{"amount":"240.00",...}}
```

Rejeições, com a regra e o texto traduzido na resposta:

```bash
# Sem aceite do cliente (CA-001)
# 422 {"error":"business_rule_violation","rule":"REQ-040",
#      "messageKey":"proposal.customer_acceptance_required",
#      "message":"Proposta exige aceite do cliente registrado."}

# Segunda apólice para a mesma proposta (CA-007)
# 422 {"rule":"REQ-049","message":"Proposta já possui apólice registrada."}

# Apólice a partir de proposta recusada (CA-006)
# 422 {"rule":"REQ-047","message":"Proposta recusada não origina apólice."}

# Liberar repasse de boleto sem confirmação (REJ-009, EX-07)
# 422 {"rule":"REQ-091",
#      "message":"Repasse exige confirmação do pagamento da primeira parcela pelo cliente."}

# Ajuste de comissão sem justificativa (CA-015, REJ-010)
# 422 {"rule":"REQ-067","message":"Ajuste de comissão por apólice exige justificativa."}

# Número de apólice repetido — é a chave de conciliação (REQ-082, CA-018)
# 422 {"rule":"REQ-082",
#      "message":"Número de apólice 'APL-4711' já registrado em outra apólice."}

# Confirmação de recebimento sem usuário (REQ-123)
# 422 {"rule":"REQ-123",
#      "message":"Confirmação de pagamento da parcela 1 exige a identificação do usuário."}

# Proposta ou apólice inexistente
# 404 {"error":"not_found","message":"Proposta não encontrada: '...'."}
```

## Interface web

As telas sobem no **mesmo processo e na mesma porta** da API, sob o prefixo `/app`:

```bash
npm start
# http://127.0.0.1:3000  → redireciona para /app/
```

A raiz redireciona para a interface. A API continua onde estava, nas suas rotas
nomeadas (`/proposals`, `/policies`, `/health`, …).

O que existe hoje:

| Tela | Rota | Estado |
|------|------|--------|
| Início | `/app/` | Pronta |
| Nova proposta (`FP-01` passos 3 e 4) | `/app/proposals/new.html` | Pronta |
| Propostas, por estado (`OUT-01`, `OUT-02`, passo 5) | `/app/proposals/` | Pronta |
| Proposta: dados e desfecho — aceite vira apólice, recusa exige motivo (passo 6) | `/app/proposals/detail.html?id=…` | Pronta |
| Apólice: parcelas, comissão acordada × real, repasse | `/app/policies/detail.html?id=…` | Pronta |
| Conciliação do comissionamento (`FP-02`, `OUT-06`) | `/app/reconciliations/` | Pronta — as linhas são digitadas; o arquivo é `DEC-001` |
| Comissões: acordado × real de todas as apólices (`OUT-05`) | `/app/commissions/` | Pronta |
| Repasses: extrato de comissão por corretor (`OUT-07`) | `/app/settlements/` | Pronta — sem relatório do período nem recibo (`DEC-008`, `IN-01`) |
| Cadastros (`IN-02`..`IN-06`) | `/app/settings/` | Pronta — grava e lista cada cadastro; `IN-01` (cliente, corretor, seguradora, produto) não existe |
| Apólices: vendidas e a vencer (`OUT-03`, `OUT-04`) | `/app/policies/` | Pronta — o corte por data de renovação é informado pelo operador (`CA-032` não define a janela) |

O caminho completo pela interface: **nova proposta → transmitir → a proposta aparece em
_Propostas / Em aberto_ → abrir → registrar a apólice (ou a recusa) → abrir a apólice**.
Depois disso a apólice fica encontrável por conta própria, em _Apólices_.
`FP-01` separa esses atos no tempo de propósito: a seguradora responde depois, e o
desfecho é registrado na própria proposta, não no formulário de cadastro.

Comece pelos **cadastros**: sem acordo comercial e tabela do corretor a apólice nasce
sem comissão, e a tela mostra isso explicitamente em vez de inventar um valor. A tela
lista o que já está registrado abaixo de cada formulário, então dá para conferir o
percentual antes de ele virar uma comissão — e ver, pela ausência, qual forma de
pagamento ainda não tem regra de liberação.

**Sem build.** Não há bundler, transpilador nem framework: o que é servido é o que está
em disco — HTML, CSS e ES modules nativos. Por isso o código de browser é `.js` e não
`.ts`: o Node remove tipos do que *ele* executa, e o navegador recebe o arquivo como
está. O Biome linta e formata esses `.js` junto com o resto.

Três regras valem dentro de `interfaces/web/`:

- **nenhuma regra de negócio.** A tela oferece a ação e mostra a recusa; quem decide se
  a transição é admissível é o domínio. `shared/status.js` guarda o único vocabulário de
  domínio que a interface conhece — rótulo e cor de um estado, nunca uma decisão;
- **nenhum texto de erro próprio.** O servidor já devolve a mensagem traduzida por
  `src/i18n`; a tela exibe a frase que recebeu, com o `REQ-xxx` ao lado;
- **`REQ-120` não para na fronteira HTTP.** Nada de `parseFloat`: `shared/money.js`
  formata sobre o texto e a única soma exibida (o total do cronograma, meramente
  informativo) roda em `BigInt`.

**Exceção de i18n, deliberada:** rótulo de tela vive no próprio HTML, não em
`src/i18n/messages.ts`. O dicionário é tipado sobre as chaves *de domínio*, e um texto de
botão não é regra de negócio — do mesmo jeito que os erros de configuração ficam em
inglês por serem lidos por operador. O que **nunca** acontece é a tela reescrever uma
mensagem de domínio.

## Testes

```bash
npm test                  # tudo
npm run test:unit         # unit  — domínio, caso de uso, config, i18n, regra de dependência
npm run test:integration  # integration — SQLite real em disco + composition root
npm run test:e2e          # e2e   — servidor HTTP escutando de verdade, via fetch
npm run check             # typecheck + lint + todos os testes
```

| Suíte | Onde | Propósito |
|-------|------|-----------|
| **unit** | `src/**/*.test.ts` (junto ao código) | Regra de negócio isolada, com InMemory/fakes. Sem I/O |
| **architecture** | `tests/architecture/` (roda em `unit`) | Regra de dependência do `core` e fronteira de i18n, verificadas — não só documentadas |
| **integration** | `tests/integration/` | Componentes reais entre si, incluindo persistência SQLite em arquivo |
| **e2e** | `tests/e2e/` | Sistema pela interface externa real: porta efêmera, HTTP, SQLite em disco — inclusive **pelas telas** (`web-fp01-flow.test.ts`) |

O teste de fluxo da interface (`tests/e2e/web-fp01-flow.test.ts`) carrega **os mesmos
arquivos que o navegador baixa** em um DOM (`jsdom`), contra o servidor real: preenche o
formulário, dispara o envio, e confere os dois lados — o que a tela passou a mostrar e o
que o backend passou a guardar. `vitest.config.ts` resolve o prefixo `/app/` para
`src/interfaces/web/public/`, então não há cópia nem build; `jsdom` é a única dependência
de desenvolvimento acrescentada por isso, e nada dela chega ao processo que roda em
produção.

## Qualidade

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # biome check
npm run format      # biome check --write
```

## Estrutura

```
src/
├── main.ts                  # entrypoint: config → composição → listen
├── composition-root.ts      # único arquivo que conhece core E infraestrutura
├── config/                  # único lugar que lê process.env
├── i18n/                    # único lugar com texto em português
├── core/                    # agnóstico de infraestrutura
│   ├── proposal/
│   │   ├── domain/          # o que é verdade no negócio
│   │   └── application/     # como a operação é orquestrada + contratos (ports)
│   ├── policy/              # apólice e suas parcelas
│   │   ├── domain/
│   │   └── application/
│   ├── commission/          # quanto a Usina recebe e quanto paga, acordado e real
│   │   ├── domain/
│   │   └── application/
│   ├── reconciliation/      # casar o informado pelo terceiro com o que o sistema sabe
│   │   ├── domain/
│   │   └── application/
│   └── settlement/          # repasse ao corretor
│       ├── domain/
│       └── application/
├── infrastructure/          # implementações dos contratos
│   └── persistence/{in-memory,sqlite}/
└── interfaces/
    ├── http/                # traduz HTTP ↔ caso de uso, nada mais
    └── web/                 # as telas do operador, servidas em /app
        ├── web.ts           # registra o static; não conhece caso de uso
        └── public/
            ├── shared/      # design system, cliente HTTP, formatação, estados
            └── <capacidade>/ # uma pasta por módulo do core, .html/.css/.js por página
```

Não existem `src/utils/`, `core/shared/`, `core/common/` nem `core/financial/`: nenhum
requisito atual os justifica. Os três módulos financeiros são três porque são três
capacidades, com atores e fluxos distintos — `FP-01` passo 7 (`ATR-001`), `FP-02`
(`ATR-002`) e `FP-03` (`ATR-002`) — e cada uma tem o seu próprio agregado com ciclo de
vida próprio (seções 10.5 e 10.6). Os cadastros que alimentam o cálculo (acordo
comercial, cadeia, tabela do corretor) vivem no módulo que os lê, `commission/`; a regra
de liberação por forma de pagamento vive em `settlement/`, pelo mesmo motivo. Não há um
módulo de cadastros.

### Direção das dependências

```
interfaces ──┐
             ├──► core (domain ← application)
composition ─┘        ▲
     │                │ implementa os contratos
     ├──► infrastructure
     │
   i18n ──────────────┘   (lê as chaves do core; o core nunca lê i18n)
```

`core/` não importa infraestrutura, interfaces, i18n, framework, dependência externa
**nem builtin do Node**. Isso é garantido por teste
(`tests/architecture/core-dependencies.test.ts`), que quebra a suíte se alguém violar a
regra. Por isso os casos de uso recebem `newId` e `now` por injeção: são as duas fontes
de não-determinismo do fluxo e ficam fora do core.

Entre módulos de negócio as dependências são **declaradas uma a uma**, com a sua
justificativa, no mesmo teste — e um segundo teste faz a ordenação topológica do grafo,
então um ciclo quebra a suíte:

```
proposal ◄── policy ◄── commission ◄── reconciliation
                            ▲
                            └────────── settlement ──► policy, proposal
```

Todos leem o vocabulário que o módulo de proposta declara (`Money`, `Percentage`,
`BusinessRuleViolation`, `RecordNotFound`) — ele fica lá por ser o módulo do qual todos
os outros já dependem, e não em `core/shared/`, que nenhum requisito justifica.

Duas travessias merecem nota:

- **`commission → policy` e não o contrário.** `FP-01` passo 7 manda calcular a comissão
  acordada assim que a apólice nasce, mas quem declara o contrato é o módulo de apólice
  (`AgreedCommissionCalculator`, em `core/policy/application/`) e quem o implementa é o
  de comissão. O `RegisterPolicy` chama uma interface que ele mesmo definiu e nunca
  aprende que comissão existe; o composition root liga os dois. O contrato leva o mínimo:
  id da apólice, id da proposta, prêmio e data do cálculo.
- **`settlement` não depende de `reconciliation`.** A sequência conceitual
  `Comissão → Conciliação → Repasse` existe, mas o que o repasse precisa saber é o valor
  a pagar (`REQ-093`) e se a comissão real foi apurada (`FP-03` passo 1) — ambos estão na
  comissão. Quem conciliou não interessa.

### Persistência

O contrato (`ProposalRepository`) vive em `core/proposal/application/`, declarado por
quem precisa dele. As implementações ficam em `infrastructure/` e são escolhidas no
composition root:

- **InMemory** — testes unitários e execução rápida;
- **SQLite** — integração, carga e desenvolvimento local;
- **PostgreSQL** — produção. **Ainda não implementado**: o driver é aceito pela config e
  falha com mensagem explícita no composition root, que é onde o adapter entra.

SQLite **não** é tratado como PostgreSQL equivalente. As diferenças conhecidas e o que
ainda não foi exercitado estão em [`SQLITE-NOTES.md`](./SQLITE-NOTES.md).

Valores monetários nunca passam por ponto flutuante binário (`REQ-120`): são `string`
decimal na fronteira HTTP, `Money` (bigint em centavos) no domínio e `TEXT` no SQLite
— `NUMERIC` no PostgreSQL. O percentual de comissão trabalhada segue a mesma regra por
`REQ-121`, com um tipo próprio (`Percentage`) que preserva a escala informada em vez de
arredondá-la para duas casas.

Vigência, data de renovação e vencimento de parcela são **dias de calendário**, não
instantes: `CalendarDate` guarda `AAAA-MM-DD` sem fuso, para que um vencimento não mude
de dia conforme onde o processo roda.

As duas chaves de conciliação de `REQ-082` — número da apólice e número da proposta —
**identificam um registro só**. Sem isso, uma linha do relatório de `FP-02` casaria com
qualquer uma das apólices que repetissem o número, e o valor real cairia na apólice
errada. A recusa fica no caso de uso (que enxerga os outros registros) e a constraint
`UNIQUE` no schema é a garantia de armazenamento, como já acontece com `REQ-049`.

Registrar a apólice altera três registros por um único fato de negócio (a proposta vira
`ACCEPTED`, a apólice nasce e a comissão acordada é calculada — `FP-01` passo 7). Como
`REQ-111` amarra os dois primeiros e `REQ-112`/`REJ-015` proíbem reabrir proposta, uma
escrita pela metade deixaria um registro que nenhuma operação conserta. Daí o contrato
`Transaction` (`core/policy/application/transaction.ts`): savepoint no SQLite, transação
no PostgreSQL, execução direta no InMemory.

A importação do relatório de comissionamento reusa **o mesmo contrato**, sem alteração:
um arquivo aplicado pela metade deixaria parte das apólices conciliadas na competência e,
na reimportação, `REQ-086` recusaria justamente essa parte.

Não há framework de migration (decisão da foundation): o `schema.sql` usa
`CREATE TABLE IF NOT EXISTS`, então um arquivo SQLite criado **antes** deste slice não
ganha as colunas novas. Em desenvolvimento, apague `./data/usina.sqlite` e deixe recriar.

## Decisões técnicas

| Decisão | Motivo |
|---------|--------|
| TypeScript executado nativamente pelo Node | Um comando, um processo, zero build. `erasableSyntaxOnly` no `tsconfig` garante que o código continue executável sem transpilação |
| Código em inglês, texto em português via i18n | Padrão do código independe do idioma do negócio; a tradução fica em um ponto só, trocável |
| Fastify | Maduro, tipado, validação de schema embutida, baixo overhead |
| `node:sqlite` | Nativo do Node; evita dependência compilada. Não roda em produção |
| Vitest com 3 *projects* | Um runner, três suítes com propósitos distintos e comandos separados |
| Biome | Lint + format em uma ferramenta, sem cadeia de plugins |
| Composição manual, sem container de DI | A ligação cabe em uma função legível; um container só acrescentaria indireção |
| Sem framework de migration | Um `schema.sql` por driver. Migration entra quando houver schema em produção para evoluir |
| Percentuais e cadeia de comissão como **cadastro**, não como código | `REQ-061`, `REQ-065` e `REQ-125` exigem mudar percentual, cadeia, base e regra de liberação sem deploy. Nenhuma forma de pagamento é nomeada no código |
| Arredondamento meio para cima, no centavo, ao aplicar percentual | O cálculo inteiro roda em `bigint` (`REQ-120`) e usa a escala informada do percentual (`REQ-121`), mas o resultado precisa cair num centavo. Nenhum requisito define o modo; a regra fica declarada em um só lugar, `Money.applyRate` |
| Frontend como MPA sem build, servido pelo próprio monolito | `erasableSyntaxOnly` e "um comando, um processo, zero build" são decisões já tomadas; Next/Vite as reverteria para ganhar ergonomia que cinco telas de back office não pedem. Uma pasta por capacidade, `.html`/`.css`/`.js` por página, ES modules nativos para o que é comum |
| Design system escrito à mão, no vocabulário do Material | Elevação, grid de 4px, campo *outlined*, chip de estado — o padrão que o operador já conhece, sem arrastar biblioteca de componentes e bundler atrás. `<dialog>` nativo dá foco preso e ESC de graça |
| `@fastify/static` como segunda dependência de runtime | Servir arquivo à mão traria *path traversal* e content-type para dentro do nosso código |
| Percentuais **copiados** para o registro da comissão | `REJ-011`: editar o acordo não pode alterar cálculo já feito. Guardar o acordo por referência exigiria reler o cadastro na hora de exibir, e o painel de `REQ-076` deixaria de ser auditável |

## Decisões de negócio em aberto

O que os requisitos deixaram pendente e onde isso aparece no código:

| ID | Pendência | Efeito neste slice |
|----|-----------|--------------------|
| `DEC-001` | Layout do arquivo de comissionamento | **Bloqueia o parser.** `POST /commission-reconciliations` recebe linhas já estruturadas; tudo o que `REQ-082`, `REQ-083` e `REQ-086` fazem com uma linha está implementado e testado |
| `DEC-002` | Regra padrão do Pix | Nenhuma. A regra é cadastro (`REQ-090`); o Pix simplesmente não tem uma registrada, e abrir repasse sem ela é recusado em vez de adivinhado |
| `DEC-003` / `ITP-005` | Efeito do cancelamento de apólice sobre repasses | `REQ-054`/`REJ-016`/`CA-031` **não** implementados: o cancelamento de apólice em si não está modelado. `DIVERGENTE`/`RESOLVIDO` seguem na união de estados do repasse, sem transição que os alcance |
| `DEC-008` | Prazo e periodicidade do repasse | Não há janela de apuração nem relatório do período (`REQ-094`). O repasse é aberto por operação explícita do Financeiro e é um por apólice |
| `DEC-009` | Tributos e retenções sobre o repasse | O valor pago é informado e registrado como veio (`REQ-095`); nada é deduzido |
| `ITP-006` | Não retroatividade de alteração de acordo | Não virou regra: o que existe é a cópia dos percentuais no registro da comissão, que é o que `REJ-011` (confirmado) pede |
| `ITP-008` | Confirmação do boleto é manual | Implementada como manual, mas apoiada em `REQ-013` e `IN-13`, que são confirmados |

Também ficaram de fora, por serem outras capacidades e não decisões pendentes:
notificação ao corretor (`REQ-100`–`REQ-105`), cotação, renovação, endosso, sinistro,
`RECEBIDA` da comissão (a *baixa* de `REQ-075` — nenhum requisito diz quem a registra) e
os relatórios/recibo de `REQ-094`/`REQ-096`, que precisam de nome de cliente, corretor e
ramo — cadastros (`IN-01`) ainda não modelados.
