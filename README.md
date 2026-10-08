# Usina do Seguro — controle interno

Modular monolith em TypeScript. Um comando, um processo, uma porta.

Fonte de verdade dos requisitos: [`docs/requisitos_refinados_v2.md`](./docs/requisitos_refinados_v2.md),
em construção. A V1, [`docs/requisitos_refinados.md`](./docs/requisitos_refinados.md), é o
registro do entendimento anterior e não orienta decisões novas; onde as duas divergem, vale
a V2. Identificadores da série `2xx` (`REQ-2xx`, `CA-2xx`, `DEC-2xx`…) no código
referenciam a V2; os demais (`REQ-0xx`/`REQ-1xx`, `IN-xx`, `OUT-xx`) referenciam a V1 e
descrevem o que a V2 ainda não revisou — conciliação, notificação, comissão acordada ×
real e cadastros de referência.

> **Estado atual: `Proposta → Apólice → CR → Comissão elegível` (FP-01 e FP-02 da V2),
> com a conciliação e a notificação da V1.**
> `FP-01` vai do registro da proposta — digitada ou lida do PDF (`REQ-201`–`REQ-219`) —,
> com a CT, a intermediária e o valor esperado pela Usina (`REQ-212`–`REQ-232`), ao
> reconhecimento da emissão, que cria a apólice (`REQ-209`, `REQ-240`–`REQ-247`), ou à
> recusa (`REQ-253`). Quando a apólice nasce, a comissão acordada é calculada pela CT
> (`REQ-236`) e o corretor é notificado (`REQ-100`, `REQ-228`). O `FP-02` vai da CR
> informada na apólice à comissão elegível e ao extrato de elegibilidade
> (`REQ-270`–`REQ-286`), e a CT parcelada segue o seu fluxo próprio (seções 6A e 9B da
> V2); o sistema não paga nem movimenta dinheiro (`REQ-280`). A conciliação do relatório
> de comissionamento contra as apólices (`REQ-082`, `REQ-083`, `REQ-086`) segue a V1.
>
> O controle das apólices vendidas e das que estão a vencer (`REQ-055`, `OUT-03`,
> `OUT-04`) é lido da mesma base.
>
> **Fora**: cotação, renovação, endosso, sinistro (`DEC-206`), cancelamento de apólice e
> o que vem depois da elegibilidade (`DEC-211`). A entrega da notificação é interna (`REQ-102`): o contrato de
> canal existe (`REQ-101`, `REQ-103`, `REQ-104`) e nenhum *adapter* externo está ligado.
> O *parser* do arquivo de comissionamento também não existe —
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
  'REQ-040',                    →    "Proposta exige forma   →   { "rule": "REQ-040",
  'proposal.payment_...' )            de pagamento definida."       "message": "Proposta …" }
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
# 1. Registrar a proposta com todos os dados de REQ-202 — só as parcelas são
#    opcionais com CT integral —, a CT e o seu modo (REQ-213) e o recebimento
#    direto ou através de intermediária (REQ-220). Quem informa assina (REQ-216).
curl -X POST http://127.0.0.1:3000/proposals -H 'content-type: application/json' -d '{
  "clientId":"client-1","brokerId":"broker-1","insurerId":"insurer-1","productId":"auto",
  "paymentMethodId":"bank-slip","proposalNumber":"PRP-9001","netPremium":"1200.00",
  "coverageStart":"2026-10-01","coverageEnd":"2027-10-01",
  "installments":[{"amount":"600.00","dueDate":"2026-10-10"},{"amount":"600.00"}],
  "workedCommission":"35","workedCommissionMode":"INTEGRAL","intermediary":null,
  "userId":"ana"
}'
# 201 {"id":"<proposta>","status":"AWAITING_ISSUANCE","proposalNumber":"PRP-9001",
#      "renewalDate":"2027-10-01","expectedReceipt":{"intermediary":null,"usina":"420.00"},...}

# 2. Enquanto aguarda emissão, a CT pode ser corrigida, com autoria (REQ-214, REQ-215).
curl -X POST http://127.0.0.1:3000/proposals/<proposta>/worked-commission \
  -H 'content-type: application/json' \
  -d '{"workedCommission":"40","workedCommissionMode":"INTEGRAL","userId":"bruno"}'
# 200 {"workedCommission":"40","expectedReceipt":{"intermediary":null,"usina":"480.00"},...}

# 3. Em aberto, rastreável (REQ-043, OUT-01)
curl 'http://127.0.0.1:3000/proposals?status=AWAITING_ISSUANCE'
#
# Sem filtro lista todas; `status=REJECTED` é o relatório de recusadas (OUT-02).
curl http://127.0.0.1:3000/proposals/<proposta>

# 4a. Desfecho recusa: motivo obrigatório (REQ-253)
curl -X POST http://127.0.0.1:3000/proposals/<proposta>/rejection \
  -H 'content-type: application/json' -d '{"reason":"perfil de risco"}'
# 200 {"status":"REJECTED","rejectionReason":"perfil de risco"}

# 4b. Desfecho emitida: reconhecimento da emissão, assinado por quem identificou
#     (REQ-209). Cria a apólice, que herda todos os dados da proposta — o número
#     é o da proposta e nada é redigitado (REQ-240, REQ-241, REQ-242).
curl -X POST http://127.0.0.1:3000/policies -H 'content-type: application/json' \
  -d '{"proposalId":"<proposta>","userId":"carla.dias"}'
# 201 {"id":"<apolice>","policyNumber":"PRP-9001","proposalNumber":"PRP-9001",
#      "status":"ACTIVE","installments":[{"number":1,...,"status":"PENDING"},...]}
#     O PDF da apólice pode ir junto ou depois (REQ-247): POST /policies/<apolice>/document

# 5. Consultar: os dois números e o cronograma (REQ-050, REQ-241)
curl http://127.0.0.1:3000/policies/<apolice>

# A apólice que a proposta originou, para quem partiu do rastreio (REQ-049, REQ-050)
curl http://127.0.0.1:3000/proposals/<proposta>/policy

# 6. O controle das apólices vendidas (OUT-03), da renovação mais próxima
#    para a mais distante (REQ-055).
curl http://127.0.0.1:3000/policies
# 200 [{"id":"<apolice>","policyNumber":"PRP-9001","proposalNumber":"PRP-9001",
#       "status":"ACTIVE","premium":"1200.00","coverageStart":"2026-10-01",
#       "coverageEnd":"2027-10-01","renewalDate":"2027-10-01",...}]

#    As apólices a vencer (OUT-04, CA-032): as que renovam até o dia informado,
#    ele inclusive. A janela é de quem pergunta — nenhum requisito define o que
#    é uma renovação "próxima".
curl 'http://127.0.0.1:3000/policies?renewalUntil=2027-06-30'

# 7. A notificação que o registro da apólice produziu (REQ-100, OUT-10). Não há
#    POST: ela é efeito do passo 4b, não um ato do usuário. Sem recipientId
#    lista todas; com ele, as de um corretor.
curl 'http://127.0.0.1:3000/notifications?recipientId=broker-1'
# 200 [{"event":"POLICY_ISSUED","recipientId":"broker-1","policyNumber":"PRP-9001",
#       "client":{"id":"client-1","name":"Ana Lima"},
#       "broker":{"id":"broker-1","name":"Corretora Alfa"},
#       "product":{"id":"auto","name":"Automóvel"},
#       "workedCommission":"40","netPremium":"1200.00","occurredAt":"..."}]
#
# Os cinco campos de REQ-100 são gravados como foram notificados (REQ-105):
# corrigir um nome em IN-01 depois não reescreve o que já foi dito.
```

Comissão acordada, conciliação e `FP-02`:

```bash
# 0a. Cadastros de referência (IN-01): dão nome a quem aparece na operação.
#     Nada é validado contra eles — uma proposta pode nomear um cliente que
#     ninguém cadastrou (REQ-002); o que falta nesse caso é o nome, não o negócio.
curl -X POST http://127.0.0.1:3000/references \
  -H 'content-type: application/json' \
  -d '{"kind":"CLIENT","id":"client-1","name":"Ana Lima"}'
# kind: CLIENT | BROKER | INSURER | INTERMEDIARY | PRODUCT. Cobertura não existe:
# nenhuma regra confirmada lê uma cobertura.
curl 'http://127.0.0.1:3000/references?kind=CLIENT'

# 1. A comissão acordada nasce junto com a apólice, calculada pela CT (ou CT → CTU)
#    da proposta (REQ-236): nada a chamar.
curl http://127.0.0.1:3000/policies/<apolice>/commission
# {"status":"FORECAST","agreedReceivable":"480.00",
#  "realReceivable":null,"divergent":false,...}

# 2. Conciliação do relatório (V1). O arquivo em si é DEC-001: aqui entram
#    linhas já estruturadas.
curl -X POST http://127.0.0.1:3000/commission-reconciliations \
  -H 'content-type: application/json' -d '{
  "competence":"2026-10",
  "lines":[{"policyNumber":"PRP-9001","proposalNumber":"PRP-9001","producerCommission":"480.00"}]
}'
# 201 {"reconciled":1,"divergent":0,"duplicated":0,"pending":0,"lines":[...]}

curl http://127.0.0.1:3000/commission-reconciliations/pendencies   # OUT-06

#    O painel acordado × real de todas as apólices (OUT-05). Sem filtro é o
#    painel inteiro; por estado, a lista do que divergiu.
curl http://127.0.0.1:3000/commissions
curl 'http://127.0.0.1:3000/commissions?status=DIVERGENT'

# 3. CR da apólice (FP-02 da V2, REQ-270–REQ-279). A base é o valor da Usina.
curl http://127.0.0.1:3000/policies/<apolice>/payout
# {"situation":"WITHOUT_CR","usinaValue":"480.00","commission":null,...}
curl -X POST http://127.0.0.1:3000/policies/<apolice>/payout \
  -H 'content-type: application/json' -d '{"rate":"60","userId":"ana"}'
# 201 {"situation":"CALCULATED","commission":{"payout":"288.00","retained":"192.00",...}}
curl -X POST http://127.0.0.1:3000/policies/<apolice>/payout/revision \
  -H 'content-type: application/json' -d '{"rate":"50","reason":"renegociado","userId":"bruno"}'

# 4. Elegibilidade assinada (REQ-281–REQ-283): gera o extrato de elegibilidade.
curl -X POST http://127.0.0.1:3000/policies/<apolice>/payout/eligibility \
  -H 'content-type: application/json' -d '{"userId":"carla"}'

# 5. Consultas (REQ-284, REQ-286).
curl 'http://127.0.0.1:3000/payouts/eligible?broker=alfa&renewalFrom=2027-01&renewalUntil=2027-12'
curl http://127.0.0.1:3000/payouts/policies-without-rate
```

Rejeições, com a regra e o texto traduzido na resposta:

```bash
# Sem forma de pagamento (REQ-040)
# 422 {"error":"business_rule_violation","rule":"REQ-040",
#      "messageKey":"proposal.payment_method_required",
#      "message":"Proposta exige forma de pagamento definida."}

# Segunda apólice para a mesma proposta (CA-007)
# 422 {"rule":"REQ-049","message":"Proposta já possui apólice registrada."}

# Apólice a partir de proposta recusada (REJ-210)
# 422 {"rule":"REQ-253","message":"Proposta recusada não origina apólice."}

# Elegibilidade de apólice sem CR (EX-205)
# 422 {"rule":"REQ-273","message":"A apólice ainda não tem CR informada."}

# Ajuste de comissão sem justificativa (CA-015, REJ-010)
# 422 {"rule":"REQ-067","message":"Ajuste de comissão por apólice exige justificativa."}

# Reconhecimento da emissão sem identificar quem reconheceu (REJ-205, REQ-216)
# 422 {"rule":"REQ-216","message":"Informe quem está registrando esta informação."}

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
| Nova proposta, digitada ou lida do PDF (`FP-01` passos 1–5, `REQ-218`) | `/app/proposals/new.html` | Pronta |
| Propostas, por estado (`OUT-01`, `OUT-02`) | `/app/proposals/` | Pronta |
| Proposta: dados, correções e desfecho — o reconhecimento da emissão gera a apólice, a recusa exige motivo (`FP-01` passos 6–9) | `/app/proposals/detail.html?id=…` | Pronta |
| Apólice: parcelas, comissão acordada × real, CR e elegibilidade (`FP-02`) | `/app/policies/detail.html?id=…` | Pronta |
| Conciliação do comissionamento (`FP-02`, `OUT-06`) | `/app/reconciliations/` | Pronta — as linhas são digitadas; o arquivo é `DEC-001` |
| Comissões: acordado × real de todas as apólices (`OUT-05`) | `/app/commissions/` | Pronta |
| Repasses: apólices sem CR e comissões elegíveis (`REQ-284`, `REQ-286`) | `/app/payouts/` | Pronta — o pagamento acontece fora do sistema (`REQ-280`) |
| Cadastros de referência (`IN-01`) | `/app/settings/` | Pronta (cobertura fora) |
| Apólices: vendidas e a vencer (`OUT-03`, `OUT-04`) | `/app/policies/` | Pronta — o corte por data de renovação é informado pelo operador (`CA-032` não define a janela) |
| Notificações de emissão efetivada (`OUT-10`, `REQ-100`) | `/app/notifications/` | Pronta — só leitura; a entrega é interna (`REQ-102`) |

O caminho completo pela interface: **nova proposta → a proposta aparece em
_Propostas_, aguardando emissão → abrir → reconhecer a emissão (ou registrar a recusa) →
abrir a apólice**. Depois disso a apólice fica encontrável por conta própria, em
_Apólices_, e o corretor encontra em _Notificações_ o que lhe foi comunicado sobre a
emissão (`REQ-100`), com o caminho de volta para a apólice. `FP-01` separa esses atos no
tempo de propósito: a seguradora responde depois, e o desfecho é registrado na própria
proposta, não no formulário de cadastro.

Cadastre as **referências de `IN-01`** (cliente, corretor, seguradora, intermediária,
produto/ramo): é o que faz as telas dizerem *Ana Lima* em vez de `client-1`. Nenhuma tela
exige esse cadastro — sem ele o identificador aparece como sempre apareceu.

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
│   ├── commission/          # comissão acordada × real, CR e elegibilidade
│   │   ├── domain/
│   │   └── application/
│   ├── reconciliation/      # casar o informado pelo terceiro com o que o sistema sabe
│   │   ├── domain/
│   │   └── application/
│   ├── registry/            # IN-01: o nome de cada referência que o negócio guarda
│   │   ├── domain/
│   │   └── application/
│   └── notification/        # REQ-100..REQ-105: o que o corretor foi avisado
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
requisito atual os justifica. Nenhum percentual vem de cadastro: a CT e a CTU são
informadas na proposta (`REQ-212`, `REQ-221`) e a CR na apólice (`REQ-270`). Não há um
módulo de cadastros — `registry/` guarda apenas o **nome** de uma referência (`IN-01`),
que é uma capacidade de leitura, não um parâmetro de cálculo.

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

registry ──► proposal          ◄── policy, commission, notification
notification ──► policy, proposal
```

Todos leem o vocabulário que o módulo de proposta declara (`Money`, `Percentage`,
`BusinessRuleViolation`, `RecordNotFound`) — ele fica lá por ser o módulo do qual todos
os outros já dependem, e não em `core/shared/`, que nenhum requisito justifica.

Duas travessias merecem nota:

- **`commission → policy` e não o contrário.** A comissão acordada é calculada assim que a
  apólice nasce (`REQ-236`), mas quem declara o contrato é o módulo de apólice
  (`AgreedCommissionCalculator`, em `core/policy/application/`) e quem o implementa é o
  de comissão. O `RegisterPolicy` chama uma interface que ele mesmo definiu e nunca
  aprende que comissão existe; o composition root liga os dois. O contrato leva o mínimo:
  id da apólice, id da proposta, prêmio e data do cálculo.
- **`notification → policy`, pelo mesmo motivo que a comissão.** Quando a apólice nasce, o
  corretor é avisado (`REQ-100`), e de novo quem declara o contrato é o
  módulo de apólice (`PolicyIssuedNotifier`). É isso que torna `REJ-017` verdadeiro na
  estrutura e não só na intenção: a regra que dispara a notificação não nomeia canal
  nenhum. Os canais ficam atrás de um segundo contrato, `NotificationChannel`
  (`REQ-101`), que é onde e-mail, WhatsApp ou fila entram como *adapter* sem que
  nenhuma regra mude (`REQ-103`, `REQ-104`, `CA-030`). Hoje nenhum está ligado: por
  `REQ-102` a entrega inicial é interna, e o registro de `REQ-105` — o que foi
  notificado, para quem e quando — é a própria notificação in-app que `/app/notifications/`
  lê.

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

O número da proposta — e, portanto, o da apólice — **não é único** (`DEC-207`): quando a
conciliação encontra um número repetido, vale a apólice registrada primeiro.

Registrar a apólice altera três registros por um único fato de negócio (a proposta vira
`ISSUED`, a apólice nasce e a comissão acordada é calculada). O reconhecimento da emissão
e a criação da apólice são o mesmo ato (`REQ-240`) e a proposta emitida fica congelada
(`REQ-244`), então uma escrita pela metade deixaria um registro que nenhuma operação
conserta. Daí o contrato
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
| Arredondamento pela ABNT NBR 5891, no centavo, ao aplicar percentual | O cálculo inteiro roda em `bigint` (`REQ-120`) e usa a escala informada do percentual (`REQ-121`); o resultado cai no centavo pela ABNT NBR 5891 (`REQ-298`), declarada em um só lugar, `Money.applyRate` |
| Frontend como MPA sem build, servido pelo próprio monolito | `erasableSyntaxOnly` e "um comando, um processo, zero build" são decisões já tomadas; Next/Vite as reverteria para ganhar ergonomia que cinco telas de back office não pedem. Uma pasta por capacidade, `.html`/`.css`/`.js` por página, ES modules nativos para o que é comum |
| Design system escrito à mão, no vocabulário do Material | Elevação, grid de 4px, campo *outlined*, chip de estado — o padrão que o operador já conhece, sem arrastar biblioteca de componentes e bundler atrás. `<dialog>` nativo dá foco preso e ESC de graça |
| `@fastify/static` como segunda dependência de runtime | Servir arquivo à mão traria *path traversal* e content-type para dentro do nosso código |
| Percentuais **copiados** para o registro da comissão | A CT e a CTU com que a comissão acordada foi calculada ficam no próprio registro (`REQ-245`), e o painel de `REQ-076` continua auditável sem reler a proposta |

## Decisões de negócio em aberto

As decisões pendentes da V2 estão na seção 13 de
[`docs/requisitos_refinados_v2.md`](./docs/requisitos_refinados_v2.md). Fora dela, a
conciliação ainda depende de uma decisão da V1:

| ID | Pendência | Efeito neste slice |
|----|-----------|--------------------|
| `DEC-001` | Layout do arquivo de comissionamento | **Bloqueia o parser.** `POST /commission-reconciliations` recebe linhas já estruturadas; tudo o que `REQ-082`, `REQ-083` e `REQ-086` fazem com uma linha está implementado e testado |

Também ficaram de fora, por serem outras capacidades e não decisões pendentes: cotação e
`RECEBIDA` da comissão (a *baixa* de `REQ-075` — nenhum requisito diz quem a registra). O
relatório de repasse, o recibo e o registro do pagamento (`REQ-094`–`REQ-096` da V1) estão
suspensos até `DEC-211`.
