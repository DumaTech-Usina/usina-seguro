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
| Lista de propostas | Ordenação de `TEXT` | Ordenação de `timestamptz` | `ORDER BY registered_at DESC, id DESC`. O instante é ISO-8601 UTC, e ISO-8601 ordena lexicograficamente igual a cronologicamente, então a mesma expressão vale nos dois (`REQ-043`, `OUT-01`). O `id` é desempate para que a lista não se reordene entre duas leituras |
| Percentual de comissão | Mesmo problema de `REAL` | `NUMERIC` | `TEXT` com a escala informada (`REQ-121`). A aritmética não acontece no banco: `Money.applyRate` opera em `bigint` no domínio |
| Listagem de cadastro (`IN-01`) | `ORDER BY` de `TEXT` usa a collation `BINARY` (ordem de bytes) | `ORDER BY` de `text` usa a collation do banco/coluna, dependente de locale | A listagem de `reference` ordena pelo **nome** (`ORDER BY kind, name, id`), que é o que um humano procura. O adapter InMemory compara por unidade de código (`a < b`) em vez de `localeCompare`, para responder a mesma ordem que o SQLite — há teste de integração que compara as duas implementações sob a mesma carga. **Em PostgreSQL a ordem pode diferir** com identificador acentuado ou de caixa mista: quando o adapter existir, ou a coluna recebe `COLLATE "C"`, ou a ordem passa a ser explicitamente a do locale e o InMemory acompanha |
| Lista de notificações (`OUT-10`) | Ordenação de `TEXT` | Ordenação de `timestamptz` | `ORDER BY occurred_at DESC, id`. Mesmo argumento da lista de propostas: o instante é ISO-8601 UTC, então a ordem lexicográfica é a cronológica (`REQ-105`). O `id` é o desempate entre duas notificações produzidas no mesmo milissegundo, e o adapter InMemory aplica exatamente o mesmo critério |
| Documento anexo (`REQ-219`) | `BLOB` na mesma tabela, sem limite prático além do tamanho do arquivo do banco | `bytea` (ou *large object* acima de ~1 GB) | A tabela `document` guarda os bytes em `BLOB` e a `proposal` guarda só a identidade do anexo. `node:sqlite` aceita e devolve `Uint8Array`, então o adapter não converte nada; o teste de integração confere `typeof(content) = 'blob'`, pelo mesmo motivo que os valores monetários conferem `'text'` — em coluna de texto, qualquer byte fora do ASCII voltaria alterado. **Em PostgreSQL** a coluna vira `bytea` e o driver troca `Uint8Array` por `Buffer`; nada no núcleo muda, porque o contrato `SourceDocumentStorage` fala em `Uint8Array` |
| Enum | Não existe | `enum` / `CHECK` | `CHECK (... IN (...))` explícito em modo da CT, estado da comissão de repasse e evento de notificação |

## Aberto, deliberadamente

Concorrência e **níveis de isolamento** continuam não cobertos porque nenhum requisito
implementado até aqui escreve de forma concorrente. O que está coberto é a atomicidade
de uma unidade de trabalho: registrar a apólice grava proposta, apólice e comissão
acordada juntas (`REQ-240`) e a importação do relatório aplica o
arquivo inteiro ou nada — em ambos os casos o savepoint garante que uma falha no meio
não deixe metade escrita, e há teste de rollback para os dois.

A idempotência da reimportação (`REQ-086`, `REJ-012`) está implementada como **regra de
domínio**: a comissão guarda a competência em que foi conciliada e recusa a mesma duas
vezes. A tabela `commission` tem `UNIQUE (policy_id)` como garantia de armazenamento, e
não se usou `INSERT ... ON CONFLICT` para decidir a regra — o dialeto ficaria dentro do
comportamento de negócio. Ainda assim, **essa constraint precisa ser validada em
PostgreSQL** quando o adapter existir: é a diferença entre um domínio correto e um
domínio correto *sob concorrência*, que é justamente o que não foi exercitado.

O mesmo vale para a outra unicidade que o caso de uso decide e o schema garante:
`reconciliation_pendency (competence, proposal_number)` (`CA-021`). O número da proposta
e o da apólice **não** são únicos (`DEC-207`), e o schema não os restringe.

## `node:sqlite`

O driver é o módulo nativo do Node (>= 22.6), não uma dependência compilada. A API é
marcada como experimental e emite `ExperimentalWarning`. Aceitável porque SQLite não
roda em produção. Se a API quebrar em um upgrade de Node, o impacto fica contido em
`src/infrastructure/persistence/sqlite/`.
