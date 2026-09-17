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
| Transação / isolamento | Sem `SERIALIZABLE` real por transação | Níveis de isolamento configuráveis | **Ainda não exercitado.** Ver abaixo |

## Aberto, deliberadamente

Concorrência e isolamento **não** estão cobertos porque nenhum requisito desta
foundation escreve de forma concorrente. Isso muda na conciliação (`REQ-080`–`REQ-086`),
onde a idempotência da reimportação (`ITP-007`, `REJ-012`) depende de uma constraint de
unicidade e do comportamento de `INSERT ... ON CONFLICT`. Quando esse slice chegar, a
regra de unicidade precisa ser validada **também em PostgreSQL**, não só em SQLite.

## `node:sqlite`

O driver é o módulo nativo do Node (>= 22.6), não uma dependência compilada. A API é
marcada como experimental e emite `ExperimentalWarning`. Aceitável porque SQLite não
roda em produção. Se a API quebrar em um upgrade de Node, o impacto fica contido em
`src/infrastructure/persistence/sqlite/`.
