# SQLite × PostgreSQL — diferenças que importam

SQLite é usado para **teste de integração, teste de carga e desenvolvimento local**.
PostgreSQL é o banco de **produção**. Os dois não são semanticamente iguais, e este
arquivo registra as diferenças já conhecidas para que um teste verde em SQLite não
esconda uma regressão em produção.

Regra adotada: **não construir abstração de banco**. Cada driver tem o seu próprio
schema, no seu próprio dialeto. Quando uma diferença aparecer, ela é tratada aqui e
no adapter correspondente — não em uma camada genérica.

| Tema | SQLite | PostgreSQL | O que foi feito |
|------|--------|------------|-----------------|
| Valor monetário | Não tem `NUMERIC` real; `REAL` é ponto flutuante binário | `NUMERIC(p,s)` é decimal exato | Coluna é `TEXT` com decimal exato (REQ-120). Teste de integração assere `typeof(net_premium) = 'text'` |
| Data/hora | Não existe tipo nativo | `timestamptz` | ISO-8601 UTC em `TEXT`. Conversão fica no adapter |
| Booleano | Não existe; usa `INTEGER` | `boolean` nativo | `INTEGER` + `CHECK (... IN (0,1))`; adapter converte |
| Foreign keys | **Desligadas por padrão** | Sempre aplicadas | `PRAGMA foreign_keys = ON` em `sqlite-connection.ts` |
| Tipagem de coluna | Afinidade dinâmica: aceita string em coluna numérica | Tipagem estrita | `CHECK` constraints explícitos onde a diferença importa |
| Concorrência | Um escritor por vez; lock no banco inteiro | MVCC, lock por linha | **Ainda não exercitado.** Nenhum requisito atual depende de escrita concorrente |
| Transação / isolamento | Sem `SERIALIZABLE` real por transação | Níveis de isolamento configuráveis | Atomicidade **exercitada**: `SqliteTransaction` usa `SAVEPOINT` (aninhável, ao contrário de `BEGIN`) e há teste de rollback. Níveis de isolamento continuam não exercitados — ver abaixo |
| Data de calendário | Não existe tipo nativo | `date` | `AAAA-MM-DD` em `TEXT`; `CalendarDate` no domínio evita fuso |
| Vigência do acordo comercial | Ordenação de `TEXT` | Ordenação de `date` | `effective_from <= ? ORDER BY ... DESC LIMIT 1`. ISO-8601 ordena lexicograficamente igual a cronologicamente, então a mesma expressão vale nos dois (`REQ-065`) |
| Percentual de comissão | Mesmo problema de `REAL` | `NUMERIC` | `TEXT` com a escala informada (`REQ-121`). A aritmética não acontece no banco: `Money.applyRate` opera em `bigint` no domínio |
| Enum | Não existe | `enum` / `CHECK` | `CHECK (... IN (...))` explícito em cadeia de comissão, base do corretor e regra de liberação |

## Aberto, deliberadamente

Concorrência e **níveis de isolamento** continuam não cobertos porque nenhum requisito
implementado até aqui escreve de forma concorrente. O que está coberto é a atomicidade
de uma unidade de trabalho: registrar a apólice grava proposta, apólice e comissão
acordada juntas (`REQ-111`, `FP-01` passo 7) e a importação do relatório aplica o
arquivo inteiro ou nada — em ambos os casos o savepoint garante que uma falha no meio
não deixe metade escrita, e há teste de rollback para os dois.

A idempotência da reimportação (`REQ-086`, `REJ-012`) está implementada como **regra de
domínio**: a comissão guarda a competência em que foi conciliada e recusa a mesma duas
vezes. A tabela `commission` tem `UNIQUE (policy_id)` como garantia de armazenamento, e
não se usou `INSERT ... ON CONFLICT` para decidir a regra — o dialeto ficaria dentro do
comportamento de negócio. Ainda assim, **essa constraint precisa ser validada em
PostgreSQL** quando o adapter existir: é a diferença entre um domínio correto e um
domínio correto *sob concorrência*, que é justamente o que não foi exercitado.

O mesmo vale para as outras unicidades que o caso de uso decide e o schema garante:
`policy.policy_number` e `proposal.proposal_number` (as chaves de `REQ-082`) e
`reconciliation_pendency (competence, proposal_number)` (`CA-021`). Nos dois bancos um
`UNIQUE` sobre coluna anulável trata `NULL`s como distintos, então uma proposta ainda em
`DRAFT`, sem número, não colide com outra — mas isso também precisa ser conferido no
adapter PostgreSQL.

## `node:sqlite`

O driver é o módulo nativo do Node (>= 22.6), não uma dependência compilada. A API é
marcada como experimental e emite `ExperimentalWarning`. Aceitável porque SQLite não
roda em produção. Se a API quebrar em um upgrade de Node, o impacto fica contido em
`src/infrastructure/persistence/sqlite/`.
