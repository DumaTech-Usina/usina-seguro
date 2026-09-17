# Usina do Seguro — controle interno

Modular monolith em TypeScript. Um comando, um processo, uma porta.

Fonte de verdade dos requisitos: [`requisitos_refinados.md`](./requisitos_refinados.md).
Identificadores `REQ-xxx`, `CA-xxx`, `ITP-xxx` e `DEC-xxx` no código referenciam esse
documento.

> **Estado atual: slice `Proposta → Apólice → Parcela`.** O fluxo `FP-01` está
> implementado até o registro da apólice com suas parcelas: registro da proposta
> (`REQ-040`), transmissão à seguradora (`REQ-041`), desfecho de recusa (`REQ-045`) e
> desfecho de aceite, que registra a apólice e as parcelas (`REQ-020`, `REQ-048`,
> `REQ-049`, `REQ-111`). Comissionamento, conciliação e repasse **não** foram
> implementados.

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

# 3a. Desfecho recusa: motivo obrigatório (REQ-045)
curl -X POST http://127.0.0.1:3000/proposals/<proposta>/rejection \
  -H 'content-type: application/json' -d '{"reason":"perfil de risco"}'
# 200 {"status":"REJECTED","rejectionReason":"perfil de risco"}

# 3b. Desfecho aceite: registra a apólice e as parcelas (REQ-048, REQ-020)
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

# 4. Consultar: os dois números e o cronograma (CA-008)
curl http://127.0.0.1:3000/policies/<apolice>
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

# Proposta ou apólice inexistente
# 404 {"error":"not_found","message":"Proposta não encontrada: '...'."}
```

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
| **e2e** | `tests/e2e/` | Sistema pela interface externa real: porta efêmera, HTTP, SQLite em disco |

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
│   └── policy/              # apólice e suas parcelas
│       ├── domain/
│       └── application/
├── infrastructure/          # implementações dos contratos
│   └── persistence/{in-memory,sqlite}/
└── interfaces/http/         # traduz HTTP ↔ caso de uso, nada mais
```

Não existem `src/utils/`, `core/shared/` nem `core/common/`: nenhum requisito atual os
justifica.

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

Entre módulos de negócio existe **uma** dependência, `policy → proposal`, declarada e
verificada pelo mesmo teste: a apólice só existe como desfecho de uma proposta
(`REQ-048`), então o módulo de apólice carrega a proposta, conduz sua transição para
`ACCEPTED` (`REQ-111`) e reaproveita o vocabulário que o módulo de proposta já declara
(`Money`, `BusinessRuleViolation`, `RecordNotFound`). A direção inversa não existe — não
há ciclo — e não foi criado `core/shared/` para hospedar esse vocabulário porque nenhum
requisito o justifica.

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

Registrar a apólice altera dois agregados por um único fato de negócio (a proposta vira
`ACCEPTED` e a apólice nasce). Como `REQ-111` amarra os dois e `REQ-112`/`REJ-015`
proíbem reabrir proposta, uma escrita pela metade deixaria um registro que nenhuma
operação conserta. Daí o contrato `Transaction`
(`core/policy/application/transaction.ts`): savepoint no SQLite, transação no
PostgreSQL, execução direta no InMemory.

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
