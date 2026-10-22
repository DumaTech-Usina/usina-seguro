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
acordada juntas (`REQ-240`), e o savepoint garante que uma falha no meio não deixe
metade escrita.

A tabela `commission` tem `UNIQUE (policy_id)` como garantia de armazenamento de que
cada apólice tem uma só comissão acordada; a regra é do domínio, e não se usou
`INSERT ... ON CONFLICT` para decidi-la — o dialeto ficaria dentro do comportamento de
negócio. Ainda assim, **essa constraint precisa ser validada em
PostgreSQL** quando o adapter existir: é a diferença entre um domínio correto e um
domínio correto *sob concorrência*, que é justamente o que não foi exercitado.

O número da proposta e o da apólice **não** são únicos (`DEC-207`), e o schema não os
restringe.

## `node:sqlite`

O driver é o módulo nativo do Node (>= 22.6), não uma dependência compilada. A API é
marcada como experimental e emite `ExperimentalWarning` (a imagem Docker o silencia com
`--disable-warning=ExperimentalWarning`). O primeiro deploy roda SQLite em produção, numa
única instância (ver README, "Produção"). Se a API quebrar em um upgrade de Node, o impacto fica contido em
`src/infrastructure/persistence/sqlite/`.

## Concorrência: o driver síncrono serializa, PostgreSQL não

Com `node:sqlite` toda leitura e escrita é síncrona, numa única conexão. Entre dois
`await` de repositório nenhuma outra requisição roda; só um passo realmente assíncrono
(o `scrypt` do login, da redefinição e do aceite de convite) abre essa janela.
`LogIn` e `ResetPassword` relêem o usuário depois do hash, para que uma falha contada,
uma suspensão (`REQ-414`) ou uma desativação (`REQ-403`) feitas nesse meio-tempo não
sejam sobrescritas — testado em `tests/integration/identity-flow.test.ts`.

Isso **só é atômico porque o driver é síncrono**. Com um driver assíncrono de
PostgreSQL, ler e gravar em seguida deixa de ser atômico, e a conexão única com
`SAVEPOINT` numerados de `SqliteTransaction` não serve: requisições concorrentes
entrariam no savepoint umas das outras. O adapter de PostgreSQL precisa de uma conexão
por unidade de trabalho e de `SELECT ... FOR UPDATE` (ou `UPDATE` condicional) onde
hoje se relê.

## Nada de rede dentro de uma `Transaction`

Pela mesma razão: uma `Transaction` é um `SAVEPOINT` aberto na conexão compartilhada. Se
o trabalho dentro dela esperar a rede, outras requisições rodam nesse meio-tempo e as
gravações delas entram no savepoint — um `ROLLBACK` depois as desfaz, embora elas já
tenham respondido sucesso. Por isso o PDF (que com `DOCUMENT_STORAGE=r2` vai para um
bucket) é gravado **antes** da transação em `RegisterProposal` e `RegisterPolicy`
(testado nos dois). `SqliteObjectDocumentStorage` envia o objeto e só então grava as duas
linhas, de forma síncrona. Um PDF enviado de uma operação que falha depois fica sem
referência: nada aponta para ele e nada o serve.

## Modo WAL e backup

`openSqliteConnection` liga `journal_mode = WAL` (fica gravado no arquivo) e
`busy_timeout = 5000`. Em WAL um leitor — `npm run backup`, que usa `VACUUM INTO` — não
bloqueia as gravações do servidor. Os arquivos `-wal` e `-shm` fazem parte do banco: o
volume precisa ser disco local (não NFS/SMB), e copiar só o `.sqlite` com o processo no
ar não é backup. PostgreSQL não tem nada disso: backup é `pg_dump`.

## Listagens em páginas (REQ-330 a REQ-333)

Cada listagem paginada lê **uma página e o total** em consultas que filtram, ordenam e
contam no banco (`readPage`, em `sqlite-page.ts`). As de uma tabela só são um `page()` do
repositório (comissões acordadas, clientes, notificações). As que cruzam tabelas — o
cliente de uma proposta, a CT da proposta de uma apólice, o repasse de uma apólice — são
`JOIN`s em `SqliteListings`, que implementa as portas `ProposalListing`, `PolicyListing`
e `PayoutListing` declaradas pelos módulos; o driver em memória responde o mesmo lendo
tudo e cortando (`InMemoryListings`). Os use cases leem cada linha da página pelos
repositórios, como antes.

A busca de texto usa as **regras do core** como funções SQL (`usina_client_matches`,
`usina_contains`, registradas em `openSqliteConnection`): o `LIKE` do SQLite só ignora
maiúsculas em letras ASCII ("JOSÉ" ≠ "josé"), e o core compara com `toLowerCase`. Em
PostgreSQL isso vira `lower()`/`ILIKE` com a collation certa, ou uma coluna normalizada —
a divergência é de semântica, não só de sintaxe.

A ordem de cada listagem termina numa chave única (`id`), senão uma linha poderia aparecer
em duas páginas. Paginação por `OFFSET`: com os índices, a página mais funda de 100 mil
apólices leva ~24 ms. Uma apólice registrada entre duas leituras pode deslocar uma linha
entre páginas — é o custo conhecido do `OFFSET`; cursor ficou de fora por não ser pedido.

## Índices das listagens

Cada índice de `schema.sql` serve o `ORDER BY` e o filtro de uma consulta de listagem, mais
`proposal(client_id)` (busca de propostas e apólices pelo cliente) e
`proposal_worked_commission(proposal_id, sequence, mode)` (o modo da CT nas listas de
repasse, lido só do índice).

Medido em cópias sintéticas, use case inteiro (página de 50, linhas montadas):

| Listagem | 10 mil apólices | 100 mil apólices | Antes da paginação, 100 mil |
|---|---|---|---|
| Apólices, 1ª página / última | 3 / 15 ms | 5 / 24 ms | 12,7 s (todas) |
| Propostas, 1ª página / última | 3 / 10 ms | 12 / 27 ms | — |
| Apólices ou propostas por cliente | 18–21 ms | 87–94 ms | 11,3 s |
| Sem CR / parceladas | 10 / 10 ms | 133 / 40 ms | — |
| Clientes (busca) | 8 ms | 84 ms | 1,0 s |
| Comissões, notificações | 3 / 0,2 ms | 5 / 1 ms | — |

Carga HTTP (gerador e servidor na mesma máquina, 30 s, uma rodada, mistura com 40% de
listagens e 10% de escrita): **300 usuários com ~10 s entre ações** — 10 mil apólices:
p95 15 ms, p99 22 ms; 100 mil: p95 249 ms, p99 382 ms; nenhum erro. Teto sem pausa:
~366 req/s com 10 mil, ~60 req/s com 100 mil. Com 100 mil, o que limita é a contagem das
apólices sem CR e a busca por cliente (a regra do core chamada por linha); os próximos
passos, se o volume chegar lá, são guardar o modo da CT na apólice e uma coluna de busca
normalizada no cliente.
