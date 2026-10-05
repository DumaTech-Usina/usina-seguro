# Requisitos Refinados — Sistema de Controle de Seguros (Usina do Seguro)

> **Fonte**: `requisitos.md` (requisitos brutos levantados pela empresa) + rodadas de
> esclarecimento com o responsável pelo negócio (2026-09-11).
>
> **Natureza deste documento**: especificação verificável. Cada requisito deve permitir que
> outro agente responda objetivamente *"o sistema atual atende este requisito?"*.
>
> **Convenções de identificadores**
>
> | Prefixo | Significado |
> |---------|-------------|
> | `REQ-xxx` | Requisito / regra de negócio |
> | `CA-xxx`  | Critério de aceitação |
> | `REJ-xxx` | Caso que deve ser rejeitado pelo sistema |
> | `DEC-xxx` | Ponto que depende de decisão futura |
> | `ITP-xxx` | Interpretação inferida (alta confiança, **não confirmada como fato**) |
> | `EX-xxx`  | Exceção |
> | `ITG-xxx` | Integração |
> | `ATR-xxx` | Ator |
>
> Requisitos marcados com **⚠ ITP** derivam de inferência sobre o texto original e devem ser
> confirmados antes de serem tratados como verdade de negócio.

---

## 1. Objetivo do sistema

`REQ-001` O sistema é o **controle interno da Usina do Seguro** sobre negócios de seguro
intermediados por ela. A Usina **não é seguradora e não emite apólices**: ela intermedia a
relação entre clientes e seguradoras.

`REQ-002` O sistema é um **reflexo de um controle que acontece fora dele**. Ele não decide
aceite, recusa, emissão ou efetivação — ele **registra o desfecho** informado por um usuário
ou por arquivo recebido de terceiro.

`REQ-003` A origem externa do desfecho (qual sistema da seguradora produziu o aceite/recusa)
**não é modelada nem diferenciada** pelo sistema. O que importa é o desfecho registrado.
*(Origem: "se o aceite/rejeite veio de sistema X ou Y, isso não importa muito".)*

`REQ-004` O sistema tem duas finalidades financeiras centrais:
1. controlar o **comissionamento que a Usina recebe** (da seguradora, diretamente ou via
   intermediária);
2. controlar o **comissionamento que a Usina paga** aos corretores parceiros.

---

## 2. Escopo

| Área | Incluído |
|------|----------|
| Cotação | Registro **manual e opcional**, apenas para rastreio de funil |
| Proposta | Registro, emissão pela seguradora, desfecho (aceite/recusa com motivo), vínculo com apólice |
| Apólice | Registro, vigência, prêmio, parcelas, sinistro, cancelamento |
| Renovação | Controle de apólices a vencer e geração de renovação |
| Endosso | Registro de alteração de apólice vigente |
| Comissão a receber | Acordo comercial por seguradora/produto, cadeia com ou sem intermediária, override por apólice |
| Conciliação | Importação de arquivo periódico de comissionamento e casamento com apólices |
| Repasse ao corretor | Regra de liberação por forma de pagamento, relatório, recibo, registro do pagamento |
| Divergência | Exibição de **comissão acordada × comissão real** |
| Notificação | Contrato interno de notificação (porta/adapter) com implementação in-app |

---

## 3. Fora de escopo

`REQ-010` O sistema **não emite** seguros, propostas ou apólices perante a seguradora.

`REQ-011` O sistema **não calcula prêmio, tarifa ou preço** de seguro. Preço é definido na
cotação externa. *(Origem: "Momento em que é oferecido os preços, mera especulação".)*

`REQ-012` **Não há integração com o Ager (Agilizador)**. A operação da Usina no Ager é
exclusivamente de visualização humana, sem registro e sem troca de dados com este sistema.

`REQ-013` O sistema **não processa pagamentos** do cliente (não emite boleto, não captura
cartão, não recebe Pix) e **não executa transferências** ao corretor. Ele registra que o
pagamento ocorreu.

`REQ-014` **Nenhuma integração ou migração com o Segfy.** O trecho final de `requisitos.md`
que o menciona foi classificado pelo negócio como conversa informal, sem valor de requisito.

`REQ-015` O sistema **não realiza abatimento automático** de comissão paga indevidamente no
extrato do corretor. Divergências são tratadas manualmente (ver `REQ-084`).

`REQ-016` Cotação que nunca se tornou proposta **não gera nenhum controle financeiro**.

---

## 4. Atores

| ID | Ator | Tipo | Responsabilidade |
|----|------|------|------------------|
| `ATR-001` | Operacional (Usina) | Interno | Registra cotação, proposta, a emissão devolvida pela seguradora, desfecho, apólice, endosso, sinistro, cancelamento |
| `ATR-002` | Financeiro (Usina) | Interno | Importa o arquivo de comissionamento, confirma recebimentos, trata divergências, libera e registra repasses, emite relatório e recibo |
| `ATR-003` | Administrador (Usina) | Interno | Mantém acordos comerciais, percentuais, formas de pagamento e cadastros |
| `ATR-004` | Corretor parceiro | Interno (acesso limitado) | Origina o negócio, obtém o aceite do cliente, recebe notificação e comissão |
| `ATR-005` | Seguradora | Externo | **Emite a proposta** (devolvendo número e comissão trabalhada), aceita/recusa, emite apólice, paga comissão |
| `ATR-006` | Intermediária (ex.: **Mega**) | Externo | Quando existe na cadeia: recebe a comissão da seguradora, repassa à Usina e envia o arquivo periódico de comissionamento |
| `ATR-007` | Cliente / Segurado | Externo | Aceita o produto e paga o prêmio. **Não acessa o sistema** |
| `ATR-008` | Ager (Agilizador) | Sistema externo | Onde a cotação acontece. Consultado por humano, sem integração |

⚠ `ITP-001` `ATR-004` acessa o sistema porque o negócio definiu a notificação como
"light notification interna" (`REQ-090`), o que pressupõe um destinatário logado. O conjunto
exato de permissões do corretor é `DEC-010`.

---

## 5. Conceitos e entidades

### 5.1 Glossário (termos que estavam indefinidos no documento original)

| Termo | Definição adotada |
|-------|-------------------|
| **Cotação** | Consulta de preço e viabilidade feita no Ager, fora do sistema. Registro interno é manual e opcional. Não vincula nenhuma das partes |
| **Emissão da proposta** | Ato em que a **seguradora emite a proposta**, posterior ao aceite do cliente obtido através do corretor. É nesse ato que a seguradora informa o **número da proposta** e a **comissão trabalhada**. *(Confirmado pelo negócio em 2026-09-21; corrige `ITP-002`, que presumia o sentido inverso — ver Apêndice A.)* No documento original esse ato aparece como "transmissão"; o termo é mantido apenas como sinônimo histórico |
| **Proposta** | Formalização do aceite do cliente perante a seguradora. Contém o aceite do cliente e a forma de pagamento. **Ainda não é contrato** — pode ser recusada |
| **Apólice** | Proposta **efetivada** pela seguradora. É o contrato vigente e a **única base de cálculo de comissionamento** |
| **Número da proposta** | Número gerado **pela seguradora** na emissão da proposta |
| **Número da apólice** | Número da apólice efetivada. **Pode ou não coincidir** com o número da proposta, dependendo da seguradora |
| **Comissão trabalhada** | Percentual de comissão **informado pela seguradora** no ato da emissão da proposta |
| **Comissão do produtor** | Comissão devida à Usina, expressa em percentual e em valor |
| **Comissão acordada** | Valor que a Usina **espera** receber/pagar segundo o acordo comercial vigente |
| **Comissão real** | Valor **efetivamente** recebido/pago, apurado na conciliação |
| **Intermediária** | Empresa entre a seguradora e a Usina na cadeia de comissão (ex.: Mega). Sua presença é **opcional e configurável por relação Usina↔Seguradora** |
| **Baixa de comissionamento** | Momento em que a Usina reconhece que recebeu a comissão |
| **Falso positivo no recebimento** | ⚠ `ITP-003` Situação em que o recebimento é dado como ocorrido e depois não se confirma (boleto não pago, cancelamento, estorno da seguradora) |
| **Repasse** | Pagamento da comissão da Usina ao corretor parceiro |

### 5.2 Entidades

**Núcleo do negócio**: Cliente, Corretor, Seguradora, Intermediária, Produto, Cobertura,
Cotação, Proposta, Apólice, Parcela, Sinistro, Endosso, Renovação, Cancelamento.

**Financeiro**: Acordo Comercial, Tabela de Comissão do Corretor, Comissão a Receber,
Comissão a Pagar, Arquivo de Comissionamento, Linha de Conciliação, Repasse, Recibo.

**Transversal**: Notificação, Documento/Anexo.

#### Atributos obrigatórios explicitados no documento original

`REQ-020` **Apólice** possui: número da apólice, número da proposta de origem, vigência
(**início, fim e renovação**), prêmio (valor em reais), parcelas, sinistros e cancelamento.

`REQ-021` `REQ-020` estabelece que **a parcela é o ponto a partir do qual o comissionamento é
gerado**. *(Origem: "Parcela (a partir daqui é gerado o comissionamento)".)*

`REQ-022` **Proposta** possui, no mínimo: cliente, corretor, seguradora, produto/ramo, número
da proposta, aceite do cliente, forma de pagamento, prêmio líquido e comissão trabalhada.

---

## 6. Regras de negócio

### 6.1 Cotação

- `REQ-030` O sistema **permite** registrar cotação manualmente; o registro é **opcional**.
- `REQ-031` Cotação **não gera** obrigação financeira, comissão, parcela ou apólice.
- `REQ-032` Uma cotação se vincula a **no máximo uma** proposta.
- `REQ-033` Uma proposta **pode existir sem** cotação registrada.
- `REQ-034` O sistema **não calcula** valores de cotação; se registrados, são digitados.

### 6.2 Proposta

- `REQ-040` A proposta só pode ser registrada com **aceite do cliente** e **forma de
  pagamento** definidos. *(Origem: "é feita com os seguintes dados: Aceite do cliente e a
  forma de pagamento".)*
- `REQ-041` O sistema registra o momento da **emissão da proposta pela seguradora** e os
  dados que a seguradora informa nesse ato: o **número da proposta** e a **comissão
  trabalhada**. *(Revisado em 2026-09-21: o documento original dizia "transmissão à
  seguradora", presumindo que a Usina é quem informava esses valores. O negócio confirmou
  que os dois **vêm da seguradora** — o que o glossário já afirmava do número da proposta.
  Ver `ITP-002` no Apêndice A e `DEC-015`.)*
- `REQ-042` A emissão da proposta é posterior ao aceite do cliente obtido através do
  corretor.
- `REQ-041-A` ⚠ A seguradora devolve, na emissão, **outros dados além desses dois**. Quais
  são, quais o sistema deve guardar e o que cada um significa para o controle **ainda não
  foram levantados** — ver `DEC-015`. O sistema registra hoje apenas os dois campos que as
  regras confirmadas consomem, e a ausência dos demais não é decisão de escopo: é
  levantamento pendente.
- `REQ-043` O sistema permite **rastrear propostas em aberto** (emitidas pela seguradora e
  sem desfecho).
- `REQ-044` O desfecho da proposta é **aceite** ou **recusa**, registrado por um usuário. O
  sistema não infere desfecho.
- `REQ-045` Em caso de **recusa**: a proposta assume estado `RECUSADA` e o **motivo é
  obrigatório**. O registro **permanece** no sistema para consulta e relatório.
- `REQ-046` ⚠ `ITP-004` "Já era", no documento original, significa **encerramento do ciclo
  comercial** daquela proposta — não exclusão do registro. A permanência é exigida por
  `REQ-045`, escolhida explicitamente pelo negócio.
- `REQ-047` Proposta recusada **não gera** apólice, parcela nem comissionamento.
- `REQ-048` Em caso de **aceite**: a seguradora efetiva a proposta e o sistema registra a
  **apólice** correspondente.
- `REQ-049` Uma proposta origina **no máximo uma** apólice.

### 6.3 Apólice

- `REQ-050` O sistema armazena **os dois números** — o da proposta e o da apólice — mesmo
  quando idênticos, para reconstituir o ciclo de vida interno.
- `REQ-051` Para **cálculo de comissionamento**, somente a **apólice** pode ser usada como
  base. A proposta nunca é base de cálculo.
- `REQ-052` A apólice registra **sinistros** ocorridos durante a vigência.
- `REQ-053` A apólice registra **cancelamento** (data e motivo).
- `REQ-054` ⚠ `ITP-005` Cancelamento de apólice **bloqueia a liberação de repasses ainda não
  pagos** vinculados a ela e **sinaliza como divergência** os repasses já pagos. O efeito
  financeiro sobre valores já pagos é tratado manualmente (`REQ-084`). Confirmar em `DEC-003`.
- `REQ-055` O sistema controla a **data de renovação** e permite listar apólices a vencer.
- `REQ-056` A renovação gera **nova apólice** vinculada à apólice anterior.
- `REQ-057` O **endosso** é registrado como alteração de apólice vigente, vinculado à apólice
  original, preservando o registro anterior.

### 6.4 Comissão a receber (Seguradora / Intermediária → Usina)

- `REQ-060` A cadeia de comissão tem **duas configurações possíveis** por relação
  Usina↔Seguradora:
  - **Direta**: Seguradora → Usina → Corretor;
  - **Via intermediária**: Seguradora → Intermediária → Usina → Corretor.
- `REQ-061` A configuração da cadeia é **dado cadastral**, não código.
- `REQ-062` **Sem intermediária**: a base de cálculo da comissão interna é o valor que a
  **Usina recebeu**.
- `REQ-063` **Com intermediária**: a base de cálculo da comissão interna é, **por padrão**, o
  valor que a **intermediária recebeu** da seguradora.
- `REQ-064` `REQ-063` é **configurável por intermediária**: deve ser possível determinar,
  por intermediária, se a base é o valor recebido pela intermediária ou o recebido pela Usina.
- `REQ-065` Os percentuais de comissão **variam por seguradora e por produto** e são
  mantidos como **acordo comercial** com vigência.
- `REQ-066` Deve existir **ajuste (override) por apólice** para:
  - o percentual/valor que a **Usina recebe**;
  - o percentual/valor que a **Usina paga ao corretor**.
- `REQ-067` Todo override por apólice exige **justificativa e identificação do usuário**.
- `REQ-068` Comportamento padrão de referência, sem intermediária (exemplo do documento):
  prêmio R$ 100,00 → seguradora paga R$ 40,00 de comissão à Usina → Usina repassa R$ 20,00 ao
  corretor. Os valores são **ilustrativos**, não constantes do sistema.
- `REQ-069` Exemplo de referência com intermediária (documento original):
  `Seguradora R$ 100,00 → Mega R$ 40,00 → Usina R$ 32,00 → Corretor X`, onde `X` resulta da
  tabela do corretor aplicada sobre a base definida em `REQ-063`/`REQ-064`.
- `REQ-070` Comissionamento só existe **quando existe apólice** (decorre de `REQ-051`).

### 6.5 Acordado × Real

- `REQ-075` Para cada apólice o sistema mantém, separadamente, a **comissão acordada**
  (esperada, calculada pelo acordo vigente) e a **comissão real** (apurada na conciliação),
  tanto do lado a receber quanto do lado a pagar.
- `REQ-076` O sistema **exibe os dois valores lado a lado** e **sinaliza divergência** quando
  acordado ≠ real.
- `REQ-077` Divergência **não bloqueia** a operação; ela é informação para tratamento humano.
- `REQ-078` ⚠ `ITP-006` Alteração de acordo comercial, percentual ou tabela **não altera
  retroativamente** cálculos já realizados; valores apurados preservam os percentuais
  vigentes na data do cálculo. *(Necessário para que `REQ-076` seja auditável.)*

### 6.6 Conciliação do arquivo de comissionamento

- `REQ-080` O sistema recebe o arquivo de comissionamento por **upload manual** feito pelo
  Financeiro. A periodicidade informada é **semanal (sexta-feira)**; o sistema **não depende**
  do dia da semana para aceitar o arquivo.
- `REQ-081` Campos presentes no relatório, conforme o documento original: Segurado, Ramo,
  Número da proposta, Vigência (início e fim), Forma de pagamento, Prêmio líquido, Valor da
  primeira parcela, Comissão trabalhada, Comissão do produtor (percentual e valor), Nome do
  cliente.
- `REQ-082` A **chave de conciliação é o número da apólice**. Quando o arquivo trouxer apenas
  o número da proposta, o sistema resolve a apólice pelo vínculo proposta → apólice
  (`REQ-050`).
- `REQ-083` Linha do arquivo **sem apólice correspondente** não é conciliada: vira
  **pendência de conciliação** para tratamento manual, e não gera lançamento de comissão.
- `REQ-084` **Falso positivo no recebimento**: o sistema **registra a divergência e sinaliza**
  para tratamento manual. Não há abatimento nem estorno automático no extrato do corretor.
- `REQ-085` A resolução manual de uma divergência é registrada com **usuário, data e
  justificativa**.
- `REQ-086` ⚠ `ITP-007` Reimportar o mesmo arquivo **não duplica** lançamentos de comissão
  para a mesma apólice/competência. *(Necessário para que `REQ-075` seja confiável.)*

### 6.7 Repasse ao corretor

- `REQ-090` Cada **forma de pagamento** possui um atributo configurável de liberação:
  `LIBERACAO_IMEDIATA` ou `EXIGE_CONFIRMACAO_DE_RECEBIMENTO`.
- `REQ-091` Valores definidos no documento original:
  | Forma | Liberação | Origem |
  |-------|-----------|--------|
  | Crédito | Imediata | "Sendo débito ou crédito o corretor já recebe de imediato" |
  | Débito | Imediata | idem |
  | Boleto | Exige confirmação do pagamento da **primeira parcela** pelo cliente | "O pagamento ao corretor é somente quando o cliente realiza o pagamento da primeira parcela, em boleto" |
  | Pix | **Não definido** — configurável | `DEC-002` |
- `REQ-092` ⚠ `ITP-008` A confirmação do pagamento do boleto é **manual**, feita por um
  usuário da Usina. *(Origem: "Boleto precisa ser observado na Usina".)* Não há integração
  bancária (`REQ-013`).
- `REQ-093` O valor do repasse é o percentual da **tabela do corretor** aplicado sobre a base
  definida em `REQ-062`/`REQ-063`/`REQ-064`, salvo override de `REQ-066`.
- `REQ-094` O sistema **gera o relatório de repasse** do período e o **recibo por corretor**.
- `REQ-095` O sistema registra o pagamento enviado ao corretor com **data, valor e
  comprovante anexo**.
- `REQ-096` O relatório de repasse e o recibo identificam: **nome do cliente, corretor,
  percentual trabalhado, valor líquido e ramo**. *(Campos exigidos no documento original.)*

### 6.8 Notificação

- `REQ-100` Ao registrar a **efetivação da emissão** (proposta → apólice), o sistema notifica
  o corretor com: nome do cliente, corretor, percentual trabalhado, valor líquido e ramo.
- `REQ-101` A notificação é publicada através de um **contrato (porta) único**, independente
  do canal.
- `REQ-102` A implementação inicial é **notificação interna (in-app)**.
- `REQ-103` Novos canais (e-mail, WhatsApp, Facebook, outros) devem ser adicionados como
  **adapters** que implementam o contrato de `REQ-101`, sem alteração do núcleo de negócio.
- `REQ-104` O contrato deve admitir **entrega assíncrona** via fila externa (ex.: Redis,
  RabbitMQ) sem que o núcleo conheça a tecnologia de fila.
- `REQ-105` A notificação de `REQ-100` é registrada (o que foi notificado, para quem, quando).

---

## 7. Fluxos principais

### FP-01 — Cotação → Proposta → Apólice

1. `ATR-004`/`ATR-001` realiza a cotação **no Ager** (fora do sistema).
2. Havendo interesse do cliente e aceite preliminar da seguradora, `ATR-001` **pode**
   registrar a cotação no sistema (`REQ-030`).
3. Com **aceite do cliente** e **forma de pagamento** definidos, `ATR-001` registra a
   **proposta** (`REQ-040`).
4. A seguradora **emite a proposta** e devolve o **número da proposta** e a **comissão
   trabalhada**, que são registrados (`REQ-041`). Outros dados devolvidos nesse ato ainda
   não foram levantados (`REQ-041-A`, `DEC-015`).
5. A proposta fica **em aberto**, rastreável (`REQ-043`).
6. `ATR-001` registra o desfecho:
   - **Aceite** → registra a **apólice**, com número da apólice e número da proposta
     (`REQ-048`, `REQ-050`);
   - **Recusa** → estado `RECUSADA` com **motivo obrigatório** (`REQ-045`) — encerra o fluxo.
7. Criada a apólice, o sistema calcula a **comissão acordada** (`REQ-075`) e **notifica o
   corretor** (`REQ-100`).
8. A apólice é encaminhada ao corretor, que a envia ao segurado.

### FP-02 — Conciliação do comissionamento recebido

1. `ATR-002` recebe o arquivo da intermediária/seguradora (semanal) e faz o **upload**
   (`REQ-080`).
2. O sistema casa cada linha com uma **apólice** pelo número da apólice, ou pela proposta
   vinculada (`REQ-082`).
3. Linhas casadas geram **comissão real** (`REQ-075`); linhas não casadas viram **pendência**
   (`REQ-083`).
4. O sistema compara **acordado × real** e sinaliza divergências (`REQ-076`).
5. `ATR-002` trata as divergências manualmente, registrando justificativa (`REQ-085`).

### FP-03 — Repasse ao corretor

1. Com comissão real apurada, o sistema avalia a **regra de liberação da forma de pagamento**
   (`REQ-090`, `REQ-091`).
2. Forma com liberação imediata → repasse fica **liberado**.
3. Forma que exige confirmação → repasse permanece **aguardando confirmação** até `ATR-002`
   confirmar manualmente o pagamento da primeira parcela (`REQ-092`).
4. `ATR-002` gera **relatório de repasse** e **recibo** (`REQ-094`).
5. `ATR-002` registra o pagamento enviado, com comprovante (`REQ-095`).

---

## 8. Fluxos alternativos

| ID | Situação | Comportamento |
|----|----------|---------------|
| `FA-01` | Proposta registrada sem cotação prévia no sistema | Permitido (`REQ-033`) |
| `FA-02` | Cotação registrada que nunca vira proposta | Permanece registrada; sem efeito financeiro (`REQ-016`, `REQ-031`) |
| `FA-03` | Proposta recusada | `RECUSADA` + motivo; ciclo encerrado (`REQ-045`, `REQ-047`) |
| `FA-04` | Apólice com número diferente do número da proposta | Ambos armazenados (`REQ-050`) |
| `FA-05` | Cadeia sem intermediária | Base = valor recebido pela Usina (`REQ-062`) |
| `FA-06` | Cadeia com intermediária configurada para base "Usina" | Base = valor recebido pela Usina (`REQ-064`) |
| `FA-07` | Acordo extraordinário em uma apólice específica | Override com justificativa (`REQ-066`, `REQ-067`) |
| `FA-08` | Apólice cancelada antes do repasse | Repasse não liberado (`REQ-054`) |
| `FA-09` | Apólice renovada | Nova apólice vinculada à anterior (`REQ-056`) |
| `FA-10` | Endosso durante a vigência | Registro vinculado, preservando o anterior (`REQ-057`) |

---

## 9. Exceções

| ID | Exceção | Tratamento |
|----|---------|------------|
| `EX-01` | Linha do arquivo sem apólice correspondente | Pendência de conciliação; nenhum lançamento gerado (`REQ-083`) |
| `EX-02` | Valor real ≠ valor acordado | Divergência sinalizada; operação não bloqueada (`REQ-076`, `REQ-077`) |
| `EX-03` | Falso positivo no recebimento | Divergência registrada; tratamento manual, sem estorno automático (`REQ-084`) |
| `EX-04` | Apólice cancelada com repasse já pago | Sinalizado como divergência para tratamento manual (`REQ-054`) |
| `EX-05` | Reimportação do mesmo arquivo | Não duplica lançamentos (`REQ-086`) |
| `EX-06` | Recusa informada sem motivo | Operação rejeitada (`REJ-003`) |
| `EX-07` | Boleto sem confirmação de pagamento da 1ª parcela | Repasse permanece retido (`REQ-091`) |

---

## 10. Estados e transições

### 10.1 Cotação
```
ABERTA ──► CONVERTIDA      (proposta registrada a partir dela)
       └─► NAO_CONVERTIDA  (não evoluiu para proposta)
```
`REQ-110` Cotação em qualquer estado **nunca** produz efeito financeiro. Conjunto definitivo
de estados: `DEC-005`.

### 10.2 Proposta
```
RASCUNHO ──► TRANSMITIDA ──► ACEITA ──► (origina APÓLICE)
                         └─► RECUSADA (motivo obrigatório, estado final)
RASCUNHO / TRANSMITIDA ──► CANCELADA (estado final)
```
`REQ-111` `ACEITA` só é alcançável com apólice registrada (`REQ-048`).
`REQ-112` `RECUSADA` e `CANCELADA` são **finais**: não retornam a `TRANSMITIDA`.

### 10.3 Apólice
```
VIGENTE ──► RENOVADA   (gera nova apólice vinculada)
        ├─► CANCELADA  (final)
        └─► EXPIRADA   (fim de vigência sem renovação)
```
`REQ-113` Transição para `CANCELADA` aplica `REQ-054`.

### 10.4 Parcela
```
PENDENTE ──► PAGA
         ├─► ATRASADA ──► PAGA
         └─► CANCELADA
```

### 10.5 Comissão a receber
```
PREVISTA (acordada) ──► CONCILIADA ──► RECEBIDA
                                   └─► DIVERGENTE ──► RESOLVIDA (manual, com justificativa)
```

### 10.6 Repasse ao corretor
```
AGUARDANDO_CONFIRMACAO ──► LIBERADO ──► PAGO
LIBERADO (imediato)    ──► PAGO
qualquer ──► DIVERGENTE ──► RESOLVIDO (manual, com justificativa)
```

---

## 11. Entradas

| ID | Entrada | Origem | Momento |
|----|---------|--------|---------|
| `IN-01` | Cadastro de cliente, corretor, seguradora, intermediária, produto, cobertura | `ATR-003` | Contínuo |
| `IN-02` | Acordo comercial (percentuais por seguradora × produto, com vigência) | `ATR-003` | Contínuo |
| `IN-03` | Configuração da cadeia por relação Usina↔Seguradora (com/sem intermediária) | `ATR-003` | Contínuo |
| `IN-04` | Configuração da base de cálculo por intermediária | `ATR-003` | Contínuo |
| `IN-05` | Tabela de comissão do corretor | `ATR-003` | Contínuo |
| `IN-06` | Configuração de liberação por forma de pagamento | `ATR-003` | Contínuo |
| `IN-07` | Cotação (manual, opcional) | `ATR-001` | Pré-proposta |
| `IN-08` | Proposta (aceite do cliente + forma de pagamento + comissão trabalhada) | `ATR-001` | Transmissão |
| `IN-09` | Desfecho da proposta (aceite / recusa + motivo) | `ATR-001` | Pós-transmissão |
| `IN-10` | Apólice (número, vigência, prêmio, parcelas) | `ATR-001` | Pós-aceite |
| `IN-11` | Sinistro, cancelamento, endosso, renovação | `ATR-001` | Durante a vigência |
| `IN-12` | Arquivo periódico de comissionamento | `ATR-002` (upload) | Semanal |
| `IN-13` | Confirmação manual de recebimento (boleto e demais formas que exigem confirmação) | `ATR-002` | Após pagamento do cliente |
| `IN-14` | Override de comissão por apólice + justificativa | `ATR-002`/`ATR-003` | Excepcional |
| `IN-15` | Registro do repasse pago (data, valor, comprovante) | `ATR-002` | Após pagamento |

---

## 12. Saídas

| ID | Saída | Conteúdo |
|----|-------|----------|
| `OUT-01` | Lista de propostas em aberto | Propostas transmitidas sem desfecho (`REQ-043`) |
| `OUT-02` | Relatório de propostas recusadas | Proposta, seguradora, motivo (`REQ-045`) |
| `OUT-03` | Controle de apólices | Apólices vendidas, vigência, status (`REQ-020`) |
| `OUT-04` | Lista de apólices a vencer / a renovar | Apólices por data de renovação (`REQ-055`) |
| `OUT-05` | Painel acordado × real | Comissão acordada, real e divergência por apólice (`REQ-076`) |
| `OUT-06` | Pendências de conciliação | Linhas do arquivo sem apólice correspondente (`REQ-083`) |
| `OUT-07` | Extrato de comissão por corretor | Comissões previstas, liberadas, pagas e divergentes |
| `OUT-08` | Relatório de repasse do período | Nome do cliente, corretor, % trabalhada, valor líquido, ramo (`REQ-094`, `REQ-096`) |
| `OUT-09` | Recibo por corretor | Comprova o pagamento enviado (`REQ-094`) |
| `OUT-10` | Notificação de emissão efetivada | Nome do cliente, corretor, % trabalhada, valor líquido, ramo (`REQ-100`) |

---

## 13. Integrações

| ID | Contraparte | Tipo | Direção | Observação |
|----|-------------|------|---------|------------|
| `ITG-001` | **Ager (Agilizador)** | Nenhuma | — | Uso humano, somente visualização, zero registro (`REQ-012`) |
| `ITG-002` | **Intermediária / Seguradora** | Arquivo | Entrada | Upload manual do relatório periódico de comissionamento (`REQ-080`) |
| `ITG-003` | **Canais de notificação** | Porta/adapter | Saída | Contrato definido; apenas adapter interno implementado (`REQ-101`–`REQ-104`) |
| `ITG-004` | **Fila assíncrona** (Redis/RabbitMQ/outra) | Porta | Saída | Opcional, atrás do contrato de `REQ-104` |
| `ITG-005` | **Segfy** | Nenhuma | — | Explicitamente fora de escopo (`REQ-014`) |
| `ITG-006` | **Instituição financeira / meio de pagamento** | Nenhuma | — | Confirmação de recebimento é manual (`REQ-013`, `REQ-092`) |

---

## 14. Restrições

- `REQ-120` Valores monetários são tratados com precisão decimal fixa (nunca ponto flutuante
  binário).
- `REQ-121` Percentuais de comissão são armazenados com a precisão necessária para reproduzir
  o valor apurado sem arredondamento divergente do informado pela seguradora/intermediária.
- `REQ-122` O sistema **não é fonte de verdade** sobre aceite, emissão ou efetivação: ele
  reflete decisões externas (`REQ-002`).
- `REQ-123` Toda operação que altera valor financeiro (override, resolução de divergência,
  registro de repasse, confirmação de recebimento) deve registrar **quem, quando e por quê**.
- `REQ-124` Nenhum registro financeiro é apagado; correções ocorrem por novo lançamento ou
  por registro de resolução, preservando o histórico.
- `REQ-125` Parâmetros de negócio (percentuais, cadeia, base de cálculo, regra de liberação
  por forma de pagamento) são **configuráveis sem alteração de código** (`REQ-061`,
  `REQ-064`, `REQ-065`, `REQ-090`).

---

## 15. Critérios de aceitação

| ID | Critério | Verifica |
|----|----------|----------|
| `CA-001` | Registrar uma proposta sem aceite do cliente **ou** sem forma de pagamento é rejeitado | `REQ-040` |
| `CA-002` | Uma proposta pode ser registrada sem cotação vinculada | `REQ-033` |
| `CA-003` | Uma cotação registrada e não convertida não produz nenhum lançamento de comissão | `REQ-016`, `REQ-031` |
| `CA-004` | Ao marcar uma proposta como recusada sem informar motivo, a operação é rejeitada | `REQ-045` |
| `CA-005` | Proposta recusada continua consultável e aparece no relatório de recusas | `REQ-045`, `OUT-02` |
| `CA-006` | Uma proposta recusada não permite criação de apólice | `REQ-047` |
| `CA-007` | Tentar criar uma segunda apólice para a mesma proposta é rejeitado | `REQ-049` |
| `CA-008` | Uma apólice cujo número difere do número da proposta é registrada mantendo ambos os números consultáveis | `REQ-050` |
| `CA-009` | Nenhum cálculo de comissão é produzido enquanto não existir apólice | `REQ-051`, `REQ-070` |
| `CA-010` | Para uma seguradora configurada sem intermediária, a base de cálculo do corretor é o valor recebido pela Usina | `REQ-062` |
| `CA-011` | Para uma seguradora configurada com intermediária, a base padrão é o valor recebido pela intermediária | `REQ-063` |
| `CA-012` | Alterar a configuração de base de uma intermediária muda a base usada em cálculos **futuros**, sem alterar os já realizados | `REQ-064`, `REQ-078` |
| `CA-013` | Percentuais diferentes para seguradoras/produtos diferentes produzem comissões diferentes para o mesmo prêmio | `REQ-065` |
| `CA-014` | É possível ajustar, em uma apólice específica, o valor recebido pela Usina e o valor pago ao corretor | `REQ-066` |
| `CA-015` | Um override sem justificativa é rejeitado | `REQ-067` |
| `CA-016` | Toda apólice exibe comissão acordada e comissão real lado a lado | `REQ-075`, `REQ-076` |
| `CA-017` | Quando acordado ≠ real, a apólice aparece sinalizada como divergente sem que a operação seja bloqueada | `REQ-076`, `REQ-077` |
| `CA-018` | O upload do arquivo concilia linhas pelo número da apólice | `REQ-082` |
| `CA-019` | Uma linha que traz apenas o número da proposta é conciliada pela apólice vinculada a essa proposta | `REQ-082` |
| `CA-020` | Uma linha sem apólice correspondente aparece como pendência e não gera lançamento | `REQ-083` |
| `CA-021` | Reimportar o mesmo arquivo não duplica lançamentos | `REQ-086` |
| `CA-022` | Comissão de proposta paga em crédito ou débito fica liberada para repasse imediatamente | `REQ-091` |
| `CA-023` | Comissão de proposta paga em boleto permanece retida até a confirmação manual do pagamento da primeira parcela | `REQ-091`, `REQ-092` |
| `CA-024` | Alterar a regra de liberação de uma forma de pagamento na configuração altera o comportamento sem mudança de código | `REQ-090`, `REQ-125` |
| `CA-025` | Um falso positivo no recebimento gera divergência visível e **nenhum** abatimento automático no extrato do corretor | `REQ-084`, `REQ-015` |
| `CA-026` | A resolução manual de uma divergência registra usuário, data e justificativa | `REQ-085`, `REQ-123` |
| `CA-027` | O relatório de repasse e o recibo contêm nome do cliente, corretor, percentual trabalhado, valor líquido e ramo | `REQ-096` |
| `CA-028` | O pagamento ao corretor pode ser registrado com data, valor e comprovante anexo | `REQ-095` |
| `CA-029` | Ao registrar a apólice, uma notificação de emissão efetivada é produzida para o corretor com os cinco campos exigidos | `REQ-100` |
| `CA-030` | Adicionar um novo canal de notificação não exige alteração das regras de negócio que disparam a notificação | `REQ-101`, `REQ-103` |
| `CA-031` | Cancelar uma apólice impede a liberação de repasses ainda não pagos daquela apólice | `REQ-054` |
| `CA-032` | Apólices com data de renovação próxima aparecem na listagem de apólices a vencer | `REQ-055`, `OUT-04` |
| `CA-033` | Uma renovação gera nova apólice mantendo o vínculo com a anterior | `REQ-056` |
| `CA-034` | Um endosso preserva o registro da apólice antes da alteração | `REQ-057` |
| `CA-035` | Nenhuma tela ou rotina do sistema consulta ou grava dados no Ager | `REQ-012` |
| `CA-036` | Nenhuma rotina calcula prêmio ou preço de seguro | `REQ-011` |

---

## 16. Casos que devem ser rejeitados

| ID | Caso | Regra |
|----|------|-------|
| `REJ-001` | Calcular ou lançar comissão tendo a **proposta** como base | `REQ-051` |
| `REJ-002` | Gerar comissão para apólice inexistente | `REQ-070` |
| `REJ-003` | Marcar proposta como recusada sem motivo | `REQ-045` |
| `REJ-004` | Registrar proposta sem aceite do cliente ou sem forma de pagamento | `REQ-040` |
| `REJ-005` | Criar mais de uma apólice para a mesma proposta | `REQ-049` |
| `REJ-006` | Registrar apólice sem número de apólice | `REQ-020`, `REQ-050` |
| `REJ-007` | Vincular uma cotação a mais de uma proposta | `REQ-032` |
| `REJ-008` | Gerar lançamento financeiro a partir de cotação | `REQ-031` |
| `REJ-009` | Liberar repasse de forma de pagamento que exige confirmação, sem confirmação registrada | `REQ-091` |
| `REJ-010` | Aplicar override de comissão sem justificativa e usuário | `REQ-067`, `REQ-123` |
| `REJ-011` | Alterar retroativamente cálculos já realizados ao editar acordo/percentual | `REQ-078` |
| `REJ-012` | Duplicar lançamentos ao reimportar o mesmo arquivo | `REQ-086` |
| `REJ-013` | Conciliar automaticamente linha sem apólice correspondente | `REQ-083` |
| `REJ-014` | Excluir registro financeiro para corrigir divergência | `REQ-124` |
| `REJ-015` | Reabrir proposta `RECUSADA` ou `CANCELADA` | `REQ-112` |
| `REJ-016` | Liberar repasse de apólice cancelada ainda não pago | `REQ-054` |
| `REJ-017` | Acoplar regra de negócio a um canal de notificação específico | `REQ-101`, `REQ-103` |

---

## 17. Pontos que dependem de decisão futura

| ID | Pendência | Impacto se não decidido |
|----|-----------|-------------------------|
| `DEC-001` | **Layout exato do arquivo de comissionamento** (formato — planilha/CSV/PDF —, nomes e ordem das colunas, presença ou não do número da apólice, uma ou várias intermediárias com layouts distintos) | `REQ-080`–`REQ-083` não são implementáveis nem testáveis sem uma amostra real |
| `DEC-002` | **Regra padrão do Pix** (liberação imediata ou exige confirmação) | `REQ-091` fica incompleto para essa forma de pagamento |
| `DEC-003` | **Efeito financeiro do cancelamento de apólice sobre repasses já pagos** (devolução, abatimento futuro, baixa contábil) | `REQ-054` está registrado como interpretação `ITP-005` |
| `DEC-004` | **A apólice pode ser revalidada/renovada sem nova proposta?** — pergunta aberta no documento original | Define se a renovação reentra em `FP-01` ou é fluxo próprio (`REQ-056`) |
| `DEC-005` | Conjunto definitivo de **estados da cotação** | `REQ-110` usa um conjunto mínimo |
| `DEC-006` | **Efeito do endosso sobre o comissionamento** (gera comissão adicional, recalcula, é neutro) | `REQ-057` não define consequência financeira |
| `DEC-007` | **Registro de sinistro**: quais dados e se há efeito sobre comissão/renovação | `REQ-052` define apenas a existência do registro |
| `DEC-008` | **Prazo e periodicidade do repasse ao corretor** (a cada arquivo, quinzenal, mensal) | `REQ-094` não define janela de apuração |
| `DEC-009` | **Tributos e retenções** sobre o repasse ao corretor (PF × PJ) | Pode alterar o valor do recibo (`REQ-094`) |
| `DEC-010` | **Permissões por perfil**, em especial o que o corretor (`ATR-004`) enxerga | `ITP-001` assume acesso do corretor |
| `DEC-011` | **Múltiplas intermediárias simultâneas** para a mesma seguradora | `REQ-060` assume no máximo uma por relação |
| `DEC-012` | **Apólice suspensa** é um estado necessário? | Não foi citado no documento original; não incluído em 10.3 |
| `DEC-013` | **Origem dos dados da proposta**: digitação manual, importação de PDF da seguradora, ou ambos | `IN-08` assume digitação manual; o documento original não trata do meio de entrada |
| `DEC-014` | **Categorias de motivo de recusa** (lista fechada, texto livre ou ambos) | `REQ-045` exige motivo, sem definir formato |
| `DEC-015` | **Quais outros dados a seguradora devolve na emissão da proposta** — e quais deles o controle precisa guardar. Hoje só o número da proposta e a comissão trabalhada estão levantados; o negócio confirmou em 2026-09-21 que **vêm mais campos**, ainda não inventariados | `REQ-041`/`REQ-041-A` cobrem apenas dois campos. Enquanto o levantamento não acontecer, não se sabe se algum desses dados é insumo de regra (comissionamento, conciliação, relatório) ou apenas informativo — nem se o formulário de emissão está incompleto |

---

## Apêndice A — Interpretações registradas

Itens inferidos com alta confiança a partir do próprio documento. **Não são fatos
confirmados** e devem ser validados antes da implementação.

| ID | Interpretação | Base textual |
|----|---------------|--------------|
| `ITP-001` | O corretor acessa o sistema | Decisão de notificação interna |
| ~~`ITP-002`~~ | ~~"Transmissão" = envio da proposta à seguradora, após o aceite do cliente via corretor~~ | **Validada e corrigida em 2026-09-21.** A inferência estava **errada no sentido**: o negócio confirmou que o número da proposta e a comissão trabalhada **são informados pela seguradora**, não pela Usina — o que o glossário já dizia do número ("gerado pela seguradora na emissão da proposta") e contradizia esta linha. O texto bruto ("comissão **informada** no ato da transmissão") está na voz passiva e nunca nomeou o agente; a inferência supriu o agente errado. O ato passou a se chamar **emissão da proposta** (glossário, `REQ-041`). O que permanece confirmado da inferência original é a **ordem**: o ato é posterior ao aceite do cliente (`REQ-042`) |
| `ITP-003` | "Falso positivo no recebimento" = recebimento dado como ocorrido e não confirmado depois | "Obs: Um falso positivo no recebimento" |
| `ITP-004` | "(Já era)" = encerramento comercial, não exclusão do registro | "Em caso de recusa: A Usina precisa entender o que aconteceu. (Já era)" |
| `ITP-005` | Cancelamento bloqueia repasse não pago e sinaliza o já pago | Cancelamento citado como atributo da apólice, sem regra |
| `ITP-006` | Alterações de acordo não são retroativas | Necessário para `REQ-076` ser auditável |
| `ITP-007` | Importação idempotente do arquivo | Necessário para a confiabilidade de `REQ-075` |
| `ITP-008` | Confirmação do boleto é manual | "Obs: Boleto precisa ser observado na Usina" |

---

## Apêndice B — Perguntas do documento original e seu desfecho

| Pergunta em `requisitos.md` | Situação |
|------------------------------|----------|
| "É possível uma proposta não se tornar uma apólice? A Usina precisa saber desse tipo de ocorrência?" | **Respondida**: sim; registra-se `RECUSADA` com motivo obrigatório (`REQ-045`) |
| "Qual a principal diferença entre uma proposta e uma apólice?" | **Respondida**: a proposta é a formalização do aceite ainda sujeita a recusa; a apólice é o contrato efetivado e **a única base de cálculo de comissionamento** (glossário 5.1, `REQ-051`) |
| "A apólice pode ser revalidada sem passar por outro fluxo de geração de proposta?" | **Em aberto** — `DEC-004` |

## Apêndice C — Rastreabilidade ao documento original

| Trecho de `requisitos.md` | Requisitos gerados |
|---------------------------|--------------------|
| "A Usina não emite seguros diretamente" | `REQ-001`, `REQ-010` |
| "Ager… somente visualização, zero registro" | `REQ-012`, `ITG-001` |
| "Momento em que é oferecido os preços, mera especulação" | `REQ-011` |
| "é feita com os seguintes dados: Aceite do cliente e a forma de pagamento" | `REQ-040` |
| "a Usina pode rastrear propostas em aberto" | `REQ-043`, `OUT-01` |
| "Em caso de recusa… (Já era)" | `REQ-045`, `REQ-046`, `ITP-004` |
| "A seguradora efetiva a proposta, transformando-a em Apólice" | `REQ-048` |
| "se o aceite/rejeite veio de sistema X ou Y, isso não importa" | `REQ-003` |
| "o sistema deve mostrar propostas que se tornaram apólices" | `REQ-050`, `OUT-03` |
| "Encaminhamos para o corretor para ele enviar para o segurado" | `FP-01` passo 8 |
| "Baixa de comissionamento (crédito, débito, boleto e pix)" | `REQ-090`, `REQ-091` |
| "Boleto precisa ser observado na Usina" | `REQ-092`, `ITP-008` |
| "O pagamento ao corretor é somente quando o cliente realiza o pagamento da primeira parcela, em boleto" | `REQ-091` |
| "Seguradora → Mega → Usina → Corretor (100/40/32/X)" | `REQ-060`–`REQ-069` |
| "Toda sexta, a Mega envia o relatório de comissionamento" | `REQ-080`, `REQ-081` |
| Campos do relatório | `REQ-081` |
| "quando a emissão é efetivada é necessário notificar…" | `REQ-100`, `REQ-096` |
| "É emitido o relatório manual e um recibo" | `REQ-094`, `REQ-095` |
| "Obs: Um falso positivo no recebimento" | `REQ-084`, `ITP-003` |
| "Preciso rever a questão da transmissão" | `REQ-041`, `REQ-042`, `ITP-002` — **revisto em 2026-09-21**: o ato é a **emissão da proposta pela seguradora**, e é dela que vêm o número e a comissão trabalhada. Abriu `DEC-015` (os demais dados devolvidos na emissão) |
| "Uma apólice possui… Sinistros e Cancelamento" | `REQ-020`, `REQ-052`, `REQ-053` |
| "Parcela (a partir daqui é gerado o comissionamento)" | `REQ-021` |
| Domínios levantados por IA | Renovação, Endosso, Cancelamento e Sinistro **em escopo**; os demais não geraram requisito |
| Trecho final ("Fofoca" / Segfy) | Sem valor de requisito — `REQ-014` |
