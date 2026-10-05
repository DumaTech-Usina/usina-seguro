# Requisitos Refinados — V2

> **Escopo desta versão**: dois fluxos. **FP-01** — **Criação da Proposta → evolução da
> Proposta → transformação em Apólice**. **FP-02** — **Apólice → comissão de repasse (CR)
> → comissão elegível** (seção 9A). O restante do sistema (conciliação, o que acontece com
> o repasse depois da elegibilidade, notificação, cadastros, renovação, endosso, sinistro)
> **permanece regido pela V1** até ser revisto.
>
> **Fonte**: levantamento com o responsável pelo negócio em **2026-09-22**, em três
> rodadas — a segunda fechou a recusa, a cardinalidade da intermediária, o conjunto
> editável antes da emissão e retirou a divergência proposta × apólice; a terceira
> respondeu `Q-201` e `Q-202` e fechou autoria, obrigatoriedade no registro, identificação
> da intermediária, a base do cálculo enquanto `DEC-203` está aberta e a unicidade do
> número (`DEC-207`). Em **2026-09-23** o negócio confirmou ainda que o número da apólice
> é o da proposta, a data, a hora e o autor do reconhecimento da emissão, e que o número
> da apólice também não é único por ora. Na mesma data confirmou que a proposta recusa
> vigência invertida e parcela sem valor já no registro, que o PDF importado é guardado
> junto com a proposta, e deixou em aberto a relação entre parcelas e recebíveis
> (`DEC-209`).
> Em **2026-09-25**, em duas rodadas, o negócio definiu o FP-02: a CR, o seu cálculo sobre
> o valor da Usina, a comissão calculada e a elegível, a auditoria, o extrato de
> elegibilidade e a consulta; descartou a tabela do corretor e a liberação por forma de
> pagamento da V1, e deixou em aberto a CR com CT parcelada (`DEC-210`) e o que vem depois
> da elegibilidade (`DEC-211`). Na mesma data respondeu `Q-203` (a CR entra no extrato) e
> `Q-204` (lista das apólices sem CR; as três situações da apólice quanto ao repasse), e
> que a apólice com CT parcelada fica fora dessas situações e dessa lista. Definiu ainda o
> arredondamento do valor da Usina: metade para cima, a cada etapa (`REQ-237`).
> Em **2026-09-28** o negócio retirou o aceite do cliente da proposta (`REQ-201`), definiu
> o envio do PDF da apólice (`REQ-247`) e deixou em aberto o conteúdo desse PDF
> (`DEC-213`), o cadastro manual de corretores (`DEC-214`) e o CPF do cliente na proposta
> (`DEC-215`).
> Em **2026-10-05** o negócio definiu a **CT parcelada** como um **fluxo próprio, paralelo
> ao da CT integral e aditivo**: o fluxo da CT integral, já validado, **não muda**. A CT
> parcelada tem dois CTs, base na parcela, valor esperado por parcela, arredondamento pela
> ABNT NBR 5891, parcelas obrigatórias e nenhuma intermediária (seção 6A). Foram respondidas
> `DEC-203` e `DEC-209`, e `DEC-210` em parte — CR em dois campos e elegibilidade por parcela
> (seção 9B), com o restante em aberto. Foi aberta `DEC-216` (faixa dos CTs da parcelada).
> A V1 (`requisitos_refinados.md`) é preservada como registro do entendimento anterior e
> **não é fonte da verdade** para o que está escrito aqui. Onde as duas divergem, **vale a
> V2** — o mapa da seção 12 diz o que foi mantido, alterado ou descartado.
>
> **Marcação `⚠ CONFIRMAR`**: trecho derivado das respostas por encadeamento lógico, não
> dito com todas as letras. Não é regra até ser confirmado. Estão todos reunidos na
> seção 13.
>
> **Convenções de identificadores** — a série `2xx` é da V2 e não colide com a V1.
>
> | Prefixo   | Significado                         |
> | --------- | ----------------------------------- |
> | `REQ-2xx` | Requisito / regra de negócio        |
> | `CA-2xx`  | Critério de aceitação               |
> | `REJ-2xx` | Caso que deve ser rejeitado         |
> | `FA-2xx`  | Fluxo alternativo                   |
> | `EX-2xx`  | Exceção                             |
> | `DEC-2xx` | Ponto que depende de decisão futura |

---

## 1. O que mudou de entendimento

Três descobertas reorganizam o fluxo. Tudo nesta versão decorre delas.

**1. A Proposta é o registro central do negócio, não um rascunho a caminho da apólice.**
Ela carrega os dados comerciais, financeiros, de vigência e de parcelamento. A Apólice
**herda** esses dados em vez de recebê-los digitados de novo.

**2. A comissão trabalhada (CT) é a base de cálculo do que a Usina recebe.**
Na V1 o percentual vinha do acordo comercial cadastrado, e a CT era guardada sem uso. Isso
está invertido: **a CT informada é o que determina o valor**.

**3. A intermediária é uma característica da operação, não do cadastro.**
Na V1 a cadeia era configuração da relação Usina↔Seguradora. Agora é **declarada na
própria proposta**, por quem a registra, e traz consigo um segundo percentual (a **CTU**).

---

## 2. Glossário

| Termo                                  | Definição                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Proposta**                           | Registro do negócio na Usina, com os dados comerciais, financeiros, de vigência e de parcelamento. É o que a Apólice herda                                                           |
| **Emissão**                            | Ato da seguradora que efetiva a proposta e a transforma em apólice. Acontece **fora do sistema**; a Usina registra o **reconhecimento** dele                                         |
| **Reconhecimento da emissão**          | Momento em que um usuário da Usina identifica, no sistema da seguradora, que a proposta foi emitida. É a data que o sistema guarda, porque a data real da seguradora não é conhecida |
| **Apólice**                            | A proposta emitida. Herda todos os dados da proposta e é a **base canônica** do comissionamento                                                                                      |
| **Prêmio líquido**                     | Valor sobre o qual a comissão incide. É o mesmo número na proposta e na apólice                                                                                                      |
| **Comissão trabalhada (CT)**           | Percentual que determina o valor a ser comissionado sobre o prêmio líquido. Sem intermediária, é o que a **Usina** recebe; com intermediária, é o que a **intermediária** recebe     |
| **CTU — comissão trabalhada da Usina** | Percentual que a Usina recebe **do valor que a intermediária recebeu**. Só existe quando há intermediária                                                                            |
| **Intermediária**                      | Empresa que recebe a comissão da seguradora e repassa parte à Usina. Declarada por operação, na proposta                                                                             |
| **Repasse**                            | Pagamento ao corretor da parte que lhe cabe do valor da Usina. **Acontece fora do sistema**: o sistema vai até a **elegibilidade** (seção 9A) e não paga nem movimenta dinheiro        |
| **Valor da Usina**                     | O que a Usina recebe de uma apólice: prêmio líquido × CT, ou prêmio líquido × CT × CTU havendo intermediária (`REQ-230`, `REQ-231`)                                                  |
| **CR — comissão de repasse**           | Percentual do **valor da Usina** a que o corretor tem direito. Informada pela Usina, na apólice                                                                                     |
| **Comissão calculada**                 | A CR informada e o seu cálculo. Serve de **controle** do repasse e ainda pode ser recalculada. **Não** é apta ao repasse                                                             |
| **Comissão elegível**                  | A comissão que atingiu as condições para ser considerada **apta ao repasse**. Definitiva. **Não é sinônimo de calculada**                                                            |
| **Elegibilidade**                      | Ato assinado por um usuário que torna a comissão elegível. É o **gatilho** do controle financeiro externo                                                                            |
| **Extrato de elegibilidade**           | Registro gerado na elegibilidade, com o histórico canônico daquele evento, a partir do qual o sistema financeiro cria o seu próprio controle                                         |
| **CT integral**                        | Modo em que a comissão é recebida em um valor total. Um único CT, sobre o prêmio líquido. Fluxo **validado** (seções 4 a 9A)                                                        |
| **CT parcelada**                       | Modo em que a comissão é recebida **por parcela**. Dois CTs, sobre o valor de cada parcela, sem intermediária. Fluxo **em definição** (seções 6A e 9B)                               |
| **CT da primeira / das subsequentes**  | Na CT parcelada: o percentual aplicado à **parcela de número 1** e o aplicado a **cada uma das demais**                                                                              |

---

## 3. A entidade Proposta

`REQ-200` A **Proposta** é o registro central do negócio. Todo dado que a apólice precisa
existe primeiro nela.

### 3.1 Dados comerciais

`REQ-201` A proposta identifica: **cliente**, **corretor**, **seguradora**,
**produto/ramo** e **forma de pagamento**.

O **aceite do cliente não é dado da proposta** (2026-09-28): no momento do cadastro, o
usuário da Usina não tem essa informação, e nenhuma regra o consome.

### 3.2 Dados padronizados que a Usina guarda

`REQ-202` Independentemente do produto e da seguradora, a proposta guarda:

| Dado                         | Observação                                        |
| ---------------------------- | ------------------------------------------------- |
| **Número da proposta**       | Emitido pela seguradora                           |
| **Prêmio líquido**           | Base do cálculo da comissão                       |
| **Comissão trabalhada (CT)** | Percentual. Ver seção 4                           |
| **Vigência — início**        |                                                   |
| **Vigência — fim**           | **Posterior ao início** — recusado no registro    |
| **Renovação**                | **É a mesma data do fim da vigência** (`REQ-203`) |
| **Parcelas**                 | Ver `REQ-204`                                     |

**Todos esses dados são obrigatórios no registro, exceto as parcelas**, que podem não ser
informadas **com CT integral** — com CT parcelada, ao menos uma é obrigatória (`REQ-292`). O mesmo vale para o **modo da CT** (`REQ-213`). Como nada disso é alterável
depois (`REQ-261`), um dado obrigatório ausente no registro não teria como ser preenchido.

`REQ-203` A **data de renovação é igual à data de fim da vigência**. Não é um dado
informado à parte.

`REQ-204` O **parcelamento** da proposta é composto por: **quantidade de parcelas**,
**valor de cada parcela** e **vencimento de cada parcela**, sendo o **vencimento
opcional**. O **valor de cada parcela é maior que zero**; zero ou negativo é recusado no
registro.

### 3.3 Dados específicos do produto

`REQ-205` A proposta carrega **dados que existem apenas para determinados produtos** —
por exemplo chassi e placa para automóvel, endereço e apartamento para residencial. A
seguradora devolve parte desses dados e omite outros.

Esses dados são **informativos**: nenhuma regra confirmada até aqui os consome. O conjunto
de campos por produto **ainda não foi levantado** (`DEC-201`).

### 3.4 Origem dos dados

`REQ-206` Os dados da proposta são informados **no momento do registro**, por digitação
ou por importação do documento da seguradora. Isso inclui o **número da proposta**: ele já
existe quando a proposta é registrada e consta do PDF — não é um dado que só aparece na
emissão.

`REQ-207` O sistema **extrai de um PDF** da seguradora os dados que hoje são digitados e
que são a principal fonte de erro: **número da proposta**, **vigência (início e fim)**,
**renovação** (igual ao fim da vigência) e, **opcionalmente**, as **parcelas** (quantidade,
valor e vencimento).

A leitura do PDF existe para **reduzir erro de digitação** — é o contorno adotado enquanto
a correção de um registro errado não for definida (`DEC-205`).

`REQ-218` **Leitura do PDF da proposta — primeira versão.** A leitura é um **acelerador do
cadastro**, não a fonte da verdade: ela preenche o formulário, o usuário revisa, altera o
que quiser, completa o que faltou e registra a proposta pelo fluxo normal. Ler o PDF
**nunca registra** a proposta.

- **Layout conhecido**: o da proposta Allianz (amostra de referência). Reconhecer o layout é
  o que identifica a **seguradora**: um PDF nesse layout preenche a seguradora com
  `ALLIANZ`.
- **O leitor é conservador**: só preenche o que identifica de forma determinística no
  documento; o que não identifica fica **ausente**, nunca estimado.
- **O que é lido**:

  | Campo                | De onde vem no PDF                                   | Normalização                                  |
  | -------------------- | ---------------------------------------------------- | --------------------------------------------- |
  | Número da proposta   | `Nº Proposta`                                        | como está                                     |
  | Cliente              | `Nome` em "Suas informações"                         | o texto do PDF (ver `DEC-208`)                |
  | Corretor             | nome em "Seu corretor"                               | o texto do PDF (ver `DEC-208`)                |
  | Seguradora           | o layout reconhecido                                 | `ALLIANZ`                                     |
  | Produto / ramo       | `Ramo`, pelo **dicionário de ramos**                 | a categoria (ex.: Moto → Auto)                |
  | Forma de pagamento   | "Informações de pagamento"                           | o texto do PDF (ver `DEC-208`)                |
  | Prêmio líquido       | `Preço Líquido`                                      | `R$ 643,85` → `643.85`                        |
  | Vigência início/fim  | `das 24H de DD/MM/AAAA às 24H de DD/MM/AAAA`         | **as datas impressas**, sem hora              |
  | Parcelas             | tabela de parcelas, conferida com `em N parcelas`    | valores; **vencimento vazio** (opcional)      |

- **Não é lido**: a CT, o modo da CT, a intermediária e a CTU vêm da Usina (`REQ-208`,
  `REQ-222`) — o "Intermediário" que aparece no PDF da Allianz é a declaração do corretor e
  o nome de um plano de assistência, não a intermediária da operação. O preço total não tem campo na proposta.
- **Dicionário de ramos**: categoriza o ramo do PDF; hoje `Auto` reúne moto e carro. Pode
  ser ampliado para melhorar o preenchimento; um ramo fora do dicionário fica ausente.
- **Resultado da leitura**: `SUCCESS` quando todos os campos acima foram identificados;
  `PARTIAL` quando o PDF foi lido e algum faltou (os encontrados são aproveitados);
  `FAILED` quando o documento não pôde ser lido ou não tem conteúdo utilizável — inclusive
  um PDF em layout que o leitor não reconhece.
- **Conflito com o que foi digitado** (`DEC-204`, parte respondida): o que o PDF traz
  **sobrescreve** o campo; a tela lista o que foi preenchido para revisão.

`REQ-219` **O PDF importado é guardado.** Quando o registro da proposta usa um PDF
importado (`REQ-218`), o **próprio arquivo** é guardado **associado à proposta**, como o
documento de origem dos dados — para que nada do que o documento trazia se perca por não
ter sido gravado em campo. O documento de origem fica disponível para consulta na
proposta.

- O arquivo é guardado **qualquer que seja o resultado da leitura** — `SUCCESS`,
  `PARTIAL` ou `FAILED`: o documento pode trazer o que o leitor atual não extrai.
- **Uma proposta, um PDF guardado: o último enviado.** Se o usuário envia mais de um PDF
  antes de registrar, só o último é guardado. Não há histórico nem versões do documento.

`REQ-208` A **CT não vem do documento da seguradora**: a seguradora não a exibe. Ela é
levantada pela **comunicação interna da Usina** e informada por um usuário.

### 3.5 Reconhecimento da emissão

`REQ-209` A Usina **não conhece a data e a hora reais** em que a seguradora emitiu a
proposta. O que o sistema registra é a **data e a hora em que um usuário identificou** a
emissão, junto com **quem identificou**. A data e a hora são as do **momento em que o
usuário registra o reconhecimento no sistema** — não são informadas. Quem identificou
assina como em `REQ-216`.

A emissão é a **confirmação de que a proposta foi transformada em apólice do lado da
seguradora e já pode ser utilizada**. Não é a chegada de dados novos: todos os dados já
estavam na proposta desde o registro (`REQ-206`).

---

## 4. Dados financeiros da Proposta

> A distinção que esta seção existe para manter: **a Proposta possui valores financeiros
> e produz uma expectativa de recebimento**, mas **a Apólice é a base canônica do
> comissionamento**. As duas afirmações convivem — ver `REQ-232`.

### 4.1 Classificação

`REQ-210` Cada dado financeiro da proposta tem origem, uso e mutabilidade próprios:

| Dado                                  | Origem                                        | Uso                                                                     | Pode mudar?                        |
| ------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| **Prêmio líquido**                    | Documento da seguradora                       | **Entra no cálculo** — é a base                                         | **Não** (`REQ-211`)                |
| **CT**                                | Levantamento interno da Usina                 | **Entra no cálculo** — determina o valor comissionado                   | **Sim, até a emissão** (`REQ-214`) |
| **CTU**                               | Informada pela Usina, quando há intermediária | **Entra no cálculo** — determina quanto a Usina recebe da intermediária | **Sim, até a emissão** (`REQ-225`) |
| **Intermediária**                     | Declarada pela Usina                          | **Muda a regra de cálculo**                                             | **Sim, até a emissão** (`REQ-225`) |
| **Modo da CT** (integral / parcelada) | Levantamento interno da Usina                 | Declara como a comissão é recebida                                      | **Sim, até a emissão** (`REQ-214`) |
| **Parcelas**                          | Documento da seguradora                       | Informativo com CT integral; **base do cálculo** com CT parcelada (`REQ-293`) | **Não**                      |
| **Dados do produto**                  | Documento da seguradora                       | Informativo                                                             | **Não**                            |

`REQ-211` O **prêmio líquido da proposta e o da apólice são o mesmo valor**. Não há
diferença entre os dois e nenhum deles substitui o outro.

`REQ-217` O **prêmio líquido é maior que zero**. Zero ou negativo é recusado no registro
(ex.: 1.200,00 é aceito; 0,00 e -50,00 são recusados).

### 4.2 A comissão trabalhada

`REQ-212` A **CT é a base de cálculo do valor comissionado** sobre o prêmio líquido. Ela
**substitui**, nessa função, o percentual do acordo comercial cadastrado que a V1 usava.

`REQ-213` A proposta declara **explicitamente** se a CT é trabalhada de forma **integral**
ou **parcelada** — isto é, se a comissão é recebida em um valor total ou por parcela. Esse
dado também é levantado internamente pela Usina. Os dois modos são fluxos distintos: a CT
parcelada tem regras próprias (seção 6A), que não alteram as da integral.

`REQ-214` A **CT e o seu modo podem ser editados enquanto a proposta aguarda emissão**. A
partir do reconhecimento da emissão, não podem mais. O modo é corrigido junto com a CT e
com o mesmo registro de autoria (`REQ-215`).

> Esta regra é **explicitamente revisável**: o negócio sinalizou que pode mudar. A
> especificação a trata como um ponto isolado, não como uma premissa espalhada pelo fluxo.

`REQ-215` A CT é **dado sensível e passível de erro**, porque é levantada por comunicação
interna. Toda informação e toda alteração de CT registra **quem informou e quando**.

`REQ-216` **Identificação de quem assina uma ação.** Enquanto não houver login, o autor de
uma ação auditada (`REQ-209`, `REQ-215`, `REQ-223`, `REQ-247`, `REQ-279`, `REQ-281`) é um **identificador digitado pelo usuário** no
próprio ato. No futuro haverá login e o nome de usuário passará a ser o autor. Por isso a
forma de "assinar" uma ação deve ser **desacoplada** das regras que exigem a assinatura:
trocar o identificador digitado pelo login, ou acrescentar outra forma de assinar, não
pode exigir mudança nas regras da proposta.

---

## 5. Intermediária

`REQ-220` A proposta declara se aquela operação será recebida **diretamente da seguradora**
ou **através de uma intermediária**. É um campo da **proposta**, não do cadastro.

Só há intermediária com **CT integral**: comissão parcelada nunca é recebida através de
intermediária (`REQ-296`).

A intermediária é identificada por uma **referência de cadastro**, como a seguradora e o
corretor. A operação tem **nenhuma ou exatamente uma** intermediária. **Não é possível haver mais de
uma intermediária na mesma proposta** — não existe cadeia de intermediárias, e portanto não
existe encadeamento de CTU.

`REQ-221` Quando há intermediária, a proposta exige **um campo adicional**: a **CTU**, o
percentual que a Usina recebe sobre o valor que a intermediária recebeu. A interface deve
explicar, no próprio campo, **como esse percentual afeta o que a Usina recebe**.

`REQ-222` **Quem informa**: o usuário da Usina, **no momento do registro da proposta**. Não
vem da seguradora e não é deduzido de cadastro — o cadastro só identifica **qual** empresa
é (`REQ-220`); **se** há intermediária e **qual** é, é o usuário quem declara.

`REQ-223` A declaração de intermediária **é auditada**: registra quem afirmou e quando.

`REQ-224` **Não existe distinção** entre "intermediária utilizada" e "intermediária
responsável pelo pagamento". É uma só.

`REQ-225` A intermediária e a CTU **podem ser alteradas enquanto a proposta aguarda
emissão**. Depois da emissão, não.

`REQ-226` A informação da intermediária **passa para a apólice** junto com o resto
(`REQ-241`).

---

## 6. Cálculo do que a Usina recebe

`REQ-230` **Sem intermediária** — a CT é aplicada sobre o prêmio líquido e o resultado é o
que a **Usina** recebe:

```
valor da Usina = prêmio líquido × CT

exemplo:  100,00 × 20%  =  20,00
```

`REQ-231` **Com intermediária** — a CT é aplicada sobre o prêmio líquido e o resultado é o
que a **intermediária** recebe; a CTU é aplicada sobre esse valor e o resultado é o que a
**Usina** recebe:

```
valor da intermediária = prêmio líquido × CT
valor da Usina         = valor da intermediária × CTU

exemplo:  100,00 × 20%  =  20,00   (intermediária)
           20,00 × 50%  =  10,00   (Usina)
```

`REQ-232` A **expectativa de recebimento existe desde a proposta**: a Usina precisa
enxergar, antes da emissão, quanto espera receber. No reconhecimento da emissão, a apólice
é criada e essa base **é canonizada** — passa a ser a base definitiva do comissionamento.

> É isto que a regra da V1 _"a proposta nunca é base de cálculo"_ queria dizer e dizia mal.
> O que ela pretendia impedir era **uma CT errada virar valor definitivo**, já que a CT é
> levantada internamente e é passível de erro. A proteção continua existindo, agora
> declarada pelo que é: a base **nasce** na proposta e **se fixa** na apólice.

`REQ-235` **Base do cálculo com CT integral.** A base é **sempre o prêmio líquido**, tanto
para a CT (`REQ-230`) quanto para o encadeamento CT → CTU (`REQ-231`). A CT parcelada tem
base própria — o valor de cada parcela (`REQ-293`, `DEC-203` respondida). A escolha da base
fica **desacoplada** do cálculo.

`REQ-236` **A comissão acordada da apólice vem da proposta.** O que a Usina espera receber
de uma apólice é calculado pela **CT** (ou pelo encadeamento **CT → CTU**, havendo
intermediária) informada na proposta (`REQ-230`, `REQ-231`, `REQ-235`) — nunca por um
acordo comercial cadastrado (`REJ-203`). O **cadastro de acordos comerciais** (`IN-02` da
V1) **deixa de existir** (`DEC-202` respondida). A parte do corretor **não vem de tabela**:
a **tabela do corretor** (`IN-05` da V1) também **deixa de existir**; a parte do corretor
é a **CR**, informada na apólice (`REQ-270`).

`REQ-237` **Arredondamento do valor da Usina.** Cada etapa do cálculo é **arredondada no
centavo, metade para cima** (0,5 centavo ou mais sobe), **antes** da etapa seguinte —
porque cada etapa é um valor efetivamente pago: a intermediária recebe um valor em
centavos, e a CTU incide sobre esse valor, não sobre uma fração.

```
sem intermediária:  100,05 × CT 15%   = 15,0075 → 15,01   (valor da Usina)

com intermediária:  100,05 × CT 15%   = 15,0075 → 15,01   (intermediária)
                     15,01 × CTU 50%  =  7,505  →  7,51   (valor da Usina)
```

Não se arredonda só no final (100,05 × 15% × 50% = 7,50375 → 7,50 é **recusado**): o valor
da intermediária exibido precisa fechar com o da Usina. A parte do corretor tem regra
própria — piso (`REQ-275`).

`REQ-233` **O valor a pagar ao corretor não faz parte do FP-01.** Este fluxo determina
apenas **o que a Usina recebe**. A parte do corretor é calculada depois de a apólice
existir, pela CR, no FP-02 (seção 9A); o pagamento em si acontece fora do sistema.

`REQ-234` A **base do repasse ao corretor é o valor da Usina** (`REQ-274`) — não mais
configurável entre o valor da intermediária e o da Usina. A escolha da base continua
**explícita e desacoplada** do cálculo, para que um caso extraordinário ainda não levantado
possa ser acrescentado sem reescrever o fluxo.

---

## 6A. CT parcelada — fluxo em definição

> Definido em **2026-10-05**. A CT parcelada é um **fluxo principal distinto e paralelo** ao
> da CT integral. As regras desta seção são **aditivas**: não substituem, não alteram e não
> invalidam nada do fluxo da CT integral (seções 4 a 9A), que está **validado**. O que é
> comum aos dois só é compartilhado quando isso não muda o comportamento da integral.

`REQ-290` **Dois fluxos.** O modo da CT (`REQ-213`) separa a proposta em dois fluxos:

| | **CT integral** — validado | **CT parcelada** — em definição |
| --- | --- | --- |
| CT | **Um** campo | **Dois** campos: CT da primeira e CT das subsequentes (`REQ-291`) |
| Base | Prêmio líquido (`REQ-235`) | Valor de cada parcela (`REQ-293`) |
| Parcelas | Opcionais (`REQ-202`) | **Ao menos uma**, obrigatória (`REQ-292`) |
| Intermediária | Nenhuma ou uma, com CTU (`REQ-220`) | **Nunca** (`REQ-296`) |
| Valor esperado | Um valor (`REQ-232`) | **Um por parcela**, sem total (`REQ-293`) |
| Arredondamento | Metade para cima, a cada etapa (`REQ-237`) | ABNT NBR 5891, por parcela (`REQ-294`) |
| Repasse e elegibilidade | Seção 9A | Seção 9B |

`REQ-291` **Dois CTs.** Com CT parcelada, a proposta tem **dois** percentuais, ambos
**obrigatórios** no registro — também quando há uma só parcela:

- **CT da primeira parcela** — aplicado à parcela de **número 1**, a primeira da tabela de
  parcelas (não a de vencimento mais próximo: o vencimento é opcional);
- **CT das parcelas subsequentes** — aplicado a cada parcela a partir da de número 2.

Os dois são levantados internamente pela Usina e informados por um usuário, como a CT
integral (`REQ-208`). Com CT integral continua existindo **um único** campo de CT.

`REQ-292` **Parcelas obrigatórias.** Com CT parcelada, a proposta exige **ao menos uma
parcela**; sem parcelas, o registro é recusado. As parcelas são a base do cálculo
(`REQ-293`) e servem a controles posteriores (seção 9B).

`REQ-293` **Cálculo por parcela.** Cada CT incide sobre o **valor da parcela como foi
informado** (`REQ-204`) — **não** sobre o prêmio líquido. O resultado é o **valor esperado
daquela parcela**, que é o que a Usina recebe por ela. O valor **nunca é acumulado**: não há
um total esperado.

```
CT 100 / 30   (CT da primeira 100%, CT das subsequentes 30%)
parcela 1:  100,00 × 100%  =  100,00
parcela 2:  100,00 ×  30%  =   30,00
parcela 3:  100,00 ×  30%  =   30,00
...
última:     100,00 ×  30%  =   30,00
```

- **Antes da emissão**, a proposta exibe **somente o valor esperado de cada parcela**
  (`REQ-232`, aplicado por parcela) — não exibe total.
- **Na apólice**, o valor esperado **de cada parcela** é o que se fixa como base canônica
  (`REQ-245`, aplicado por parcela).

`REQ-294` **Arredondamento da CT parcelada.** O valor esperado de **cada parcela** é
arredondado no centavo segundo a **ABNT NBR 5891**: se a parte descartada é menor que meio
centavo, mantém; se é maior, sobe; se é **exatamente** meio centavo, o centavo fica **par**.
A regra de arredondamento é **desacoplada** do cálculo. O arredondamento da CT integral
(`REQ-237`) **não muda**.

```
100,05 × 15%  =  15,0075  →  15,01   (mais que meio centavo: sobe)
 10,05 × 50%  =   5,025   →   5,02   (exatamente meio: 2 é par, mantém)
 10,15 × 50%  =   5,075   →   5,08   (exatamente meio: 7 é ímpar, sobe para 8)
```

`REQ-295` **Faixa dos CTs da parcelada — provisória.** Os CTs da parcelada **podem passar de
100%**. **Por ora, explicitamente de forma temporária, não há limite superior.** A faixa real
está em aberto (`DEC-216`). A faixa da CT integral não muda.

`REQ-296` **Sem intermediária.** Comissão parcelada **não pode ser recebida através de
intermediária** ("terceiros" = a intermediária de `REQ-220`), e havendo intermediária a CT
**só pode ser integral**. Declarar intermediária numa proposta com CT parcelada é
**recusado**, com mensagem de erro para o usuário. Sem intermediária não existe CTU.

`REQ-297` **Herança.** A apólice herda os dois CTs e as parcelas, como herda todos os dados
da proposta (`REQ-241`).

**⚠ CONFIRMAR (`Q-205`)**: antes da emissão, os dois CTs seriam editáveis como a CT
integral, com o mesmo registro de autoria (`REQ-214`, `REQ-215`, `REQ-252`); trocar o modo
para parcelado com intermediária declarada, ou numa proposta sem parcelas, seria recusado
(`REQ-292`, `REQ-296`).

---

## 7. Transformação Proposta → Apólice

`REQ-240` O **reconhecimento da emissão** transforma a proposta em apólice. É o mesmo ato:
não existe um estado intermediário entre "emitida" e "apólice criada".

`REQ-241` A apólice **herda todos os dados da proposta**: número, prêmio líquido, CT, modo
da CT, intermediária, CTU, vigência, renovação, parcelas e dados do produto. O **número da
apólice é o número da proposta**.

`REQ-242` **Nada é redigitado** na criação da apólice. Ela não recebe valores informados de
novo que pudessem contradizer a proposta.

> `REQ-243` **foi retirada nesta rodada.** Ela dizia que uma divergência entre proposta e
> apólice seria sinalizada. Como a apólice apenas herda e **nada é redigitado**
> (`REQ-242`), essa divergência não tem como surgir dentro deste fluxo — o negócio
> confirmou que ela não existe. O que garante a igualdade é `REQ-242` e sua rejeição
> `REJ-204`. _(A divergência **acordado × real** da conciliação é outra coisa, continua
> valendo e está fora deste escopo — V1 `REQ-076`.)_

`REQ-244` A partir da emissão, a proposta está **congelada**: nenhum dado é alterável
(`REQ-260`).

`REQ-245` A apólice é a **base canônica do comissionamento**. O que a proposta mantinha era
a expectativa; a apólice fixa o valor.

`REQ-246` Depois da apólice criada, outros eventos podem incidir sobre ela — **endosso**,
**sinistro** e **renovação**. Estão **fora do escopo desta entrega** (`DEC-206`).

`REQ-247` **PDF da apólice.** O usuário da Usina pode enviar o **arquivo PDF da apólice**,
que fica guardado **associado à apólice** e disponível para consulta nela.

- **Quando**: junto com o **reconhecimento da emissão** (`REQ-209`), de forma opcional, ou
  **depois**, na apólice já criada.
- **Uma apólice, um PDF: o último enviado.** Um novo envio passa a ser o PDF da apólice. O
  arquivo anterior não é apagado (`REQ-124` da V1, mantida), mas deixa de ser o da apólice.
- **Cada envio é assinado** (`REQ-216`): registra quem enviou e a data e a hora do momento
  do envio — não são informadas. Enviado com o reconhecimento, a assinatura é a do
  reconhecimento.
- O arquivo é tratado como **PDF**. O sistema **não lê nem valida o seu conteúdo**: não
  extrai dados e não confere campos. Quais informações o PDF da apólice deve conter **não
  foi definido** (`DEC-213`).

---

## 8. Estados e transições

`REQ-250` Estados da proposta:

```
AGUARDANDO_EMISSÃO ──► EMITIDA      (reconhecida; gera a apólice)
                   └─► RECUSADA     (motivo obrigatório; não gera apólice)
```

`REQ-251` **`EMITIDA` é o estado que confirma que a proposta gerou uma apólice.** Não há
estado intermediário entre registrar a proposta e reconhecer a emissão.

`REQ-252` A editabilidade depende do estado:

| Estado               | O que pode ser alterado                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `AGUARDANDO_EMISSÃO` | **CT** e **modo da CT**; **se há ou não intermediária** e **qual**; e a **CTU**, quando houver |
| `EMITIDA`            | **Nada**                                                                                    |
| `RECUSADA`           | **Nada** — a recusa é definitiva (`REQ-253`)                                                |

> O **modo da CT** (integral ou parcelada) acompanha a CT e é editável com ela (`REQ-214`,
> `Q-201` respondida).

`REQ-253` **Recusa.** Quando a seguradora não emite a proposta, o registro vai para
`RECUSADA`. Nesse caso:

- a proposta **não gera apólice**;
- o **motivo da recusa é obrigatório**;
- a recusa é **definitiva**: `RECUSADA` é estado final, sem reabertura, e o registro
  continua consultável (`Q-202` respondida).

---

## 9. Alteração e correção

`REQ-260` Depois da emissão, **nenhum dado da proposta pode ser alterado**.

`REQ-261` Antes da emissão, os dados alteráveis são exatamente os da tabela de `REQ-252`:
a CT e seu modo, a existência e a identidade da intermediária, e a CTU. Todo o resto — prêmio líquido,
número, vigência, parcelas, dados do produto — é imutável desde o registro.

`REQ-262` A **correção de um registro informado errado** — o caso concreto sendo o número
da proposta digitado incorretamente — **ainda não tem regra definida** (`DEC-205`). O
contorno adotado é preventivo: a leitura de PDF de `REQ-207`, que remove a digitação dos
campos mais sujeitos a erro.

---

## 9A. Comissão de repasse e elegibilidade

> O FP-02 começa **depois da apólice gerada** e termina na **elegibilidade**. O sistema
> **não realiza pagamentos, repasses nem movimentações financeiras**: ele produz os
> registros e as informações para que sistemas externos façam isso, e mantém o controle
> correspondente na Usina.
>
> A distinção que esta seção existe para manter: **comissão calculada não é comissão
> elegível**. A calculada é controle e ainda muda; a elegível é apta ao repasse e não muda
> mais.

### 9A.1 A CR

`REQ-270` A **CR (comissão de repasse)** é o **percentual do valor da Usina** a que o
corretor tem direito naquela apólice. É **informada por um usuário da Usina**, como a CT na
proposta; não vem de tabela, de cadastro nem do documento da seguradora. A **tabela do
corretor** (`IN-05` da V1) **deixa de existir**: a comissão do corretor é tratada de forma
singular, por apólice.

`REQ-271` **Quando e quantas.**

- A CR é informada **somente depois de a apólice existir**. Não é dado da proposta.
- Uma apólice tem **no máximo uma** CR.
- A CR desta seção existe **somente para apólice com CT integral** (`REQ-213`). Apólice com
  CT **parcelada** não recebe esta CR única: o comissionamento muda para recebimentos
  parcelados, com dois CRs e elegibilidade por parcela (seção 9B).

`REQ-272` **Faixa e precisão.** A CR vai de **0 a 100%, inclusive**, com **no máximo duas
casas decimais** (ex.: 60, 70,55 e 100 são aceitos; -1, 100,01 e 70,555 são recusados).

A **CR zero é válida, mas só quando informada de forma deliberada** por um usuário. Ela
nunca é assumida, preenchida automaticamente ou deduzida da ausência de CR.

`REQ-273` **Apólice sem CR.** Uma apólice sem CR é **válida para existir**, mas **não tem
repasse calculado**: ainda precisa de uma CR. Ela **não pode ser tornada elegível**. "Sem
CR" é uma das três situações da apólice quanto ao repasse (`REQ-285`).

### 9A.2 Cálculo do repasse

`REQ-274` **Base do cálculo: o valor da Usina.** A CR incide **sempre sobre o que a Usina
recebe** da apólice — o valor de `REQ-230` (recebimento direto) ou de `REQ-231`
(recebimento através de intermediária). A forma de recebimento **não muda a regra da CR**;
só muda o valor da Usina sobre o qual ela incide.

```
valor a repassar ao corretor = valor da Usina × CR          (piso no centavo — REQ-275)
valor que fica na Usina      = valor da Usina − valor a repassar
```

Recebimento direto:

```
prêmio líquido 1.000,00 × CT 30%   =  300,00   (valor da Usina)
         300,00 × CR 60%           =  180,00   (a repassar ao corretor)
         300,00 − 180,00           =  120,00   (fica na Usina)
```

Recebimento através de intermediária:

```
prêmio líquido 1.000,00 × CT 20%   =  200,00   (intermediária)
         200,00 × CTU 80%          =  160,00   (valor da Usina)
         160,00 × CR 70%           =  112,00   (a repassar ao corretor)
         160,00 − 112,00           =   48,00   (fica na Usina)
```

A **escolha da base é uma regra própria, desacoplada do cálculo** (`REQ-234`): um caso
extraordinário ainda não levantado deve poder ser acrescentado sem reescrever o fluxo.

`REQ-275` **Arredondamento e soma.** O valor a repassar é **arredondado para baixo (piso)
no centavo**. O valor que fica na Usina é a **diferença**, de modo que as duas partes
**somam exatamente o valor da Usina** (ex.: valor da Usina 10,00 × CR 70,55% = 7,055 → a
repassar **7,05**; fica na Usina **2,95**). Os valores seguem a precisão decimal exata da
V1 (`REQ-120`, `REQ-121`, mantidas) — nunca ponto flutuante.

### 9A.3 Estados da comissão

`REQ-276` Estados da comissão de repasse de uma apólice:

```
(apólice sem CR) ──CR informada──► CALCULADA ──elegibilidade assinada──► ELEGÍVEL
                                    │     ▲
                                    └─────┘ recálculo (CR alterada)
```

| Estado      | O que significa                                                   | O que pode ser feito                        |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------- |
| `CALCULADA` | A CR foi informada; o cálculo é **controle** do repasse           | **Recálculo** (`REQ-277`) e **elegibilidade** (`REQ-281`) |
| `ELEGÍVEL`  | A comissão atingiu as condições para ser **apta ao repasse**      | **Nada** — só consulta (`REQ-282`)          |

`REQ-285` **Situações da apólice quanto ao repasse.** Toda apólice **com CT integral** está
em **exatamente uma** destas situações, e elas fecham o ciclo neste momento. Apólice com CT
**parcelada** fica **fora das três** (`REQ-271`); as situações dela estão em aberto (`Q-212`).

| Situação                   | Significado                                          |
| -------------------------- | ---------------------------------------------------- |
| **Sem CR**                 | Ainda precisa de uma CR (`REQ-273`)                  |
| **Com CR — calculada**     | A comissão está `CALCULADA` (`REQ-277`)              |
| **Com CR — elegível**      | A comissão está `ELEGÍVEL` (`REQ-282`)               |

A apólice só avança nessa ordem: sem CR → calculada → elegível. Não há volta.

`REQ-277` **Comissão calculada.** Nasce quando a CR é informada pela primeira vez. Enquanto
calculada:

- **só a CR pode ser alterada** — é o **recálculo**, que pode acontecer mais de uma vez. O
  resto vem da apólice, que é imutável (`REQ-260`);
- a comissão **não pode ser cancelada nem descartada**, e a CR **não pode ser retirada**:
  as únicas ações são o recálculo e a elegibilidade.

`REQ-278` **Os valores ficam sempre explícitos.** A comissão calculada exibe **o que fica
na Usina** e **o que será repassado ao corretor**. Ao informar ou alterar a CR, os valores
resultantes são **sempre** exibidos.

`REQ-279` **Auditoria da CR.** O cálculo da CR é sensível. Toda informação e toda
alteração de CR registra:

| Dado                                                          | Na primeira informação | Em cada alteração |
| ------------------------------------------------------------- | ---------------------- | ----------------- |
| **Quem** — assinatura de `REQ-216`                            | Sim                    | Sim               |
| **Data e hora** — o momento do registro, não informadas       | Sim                    | Sim               |
| **CR anterior e CR nova**                                     | —                      | Sim               |
| **Motivo** — obrigatório                                      | Não exigido            | Sim               |
| **Os dados do cálculo como estavam**: valor da Usina (base), CR, valor a repassar, valor que fica na Usina | Sim | Sim |

Os dados do cálculo ficam **como estavam naquele momento** e **nunca são recalculados**
depois. Nada é apagado (`REQ-124` da V1, mantida). **Não há outro item de auditoria**
além destes e o da elegibilidade (`REQ-281`).

### 9A.4 Comissão elegível

`REQ-280` **Elegível não é calculada.** A comissão elegível é a que atingiu as condições
para ser considerada **apta ao repasse**. A **elegibilidade é o gatilho** para que o
controle financeiro externo seja acionado, e a Usina usa a mesma informação no seu
controle interno, por outros sistemas. O sistema **continua sem pagar e sem movimentar
caixa**.

`REQ-281` **Condição da elegibilidade.** A comissão se torna elegível quando **a Usina
recebeu** a comissão daquela apólice **e um usuário, tendo verificado isso fora do
sistema, assina a elegibilidade**. É um **ato de um usuário que assina** (`REQ-216`), nunca
automático.

- Só pode se tornar elegível uma comissão **calculada** — isto é, com CR informada
  (`REQ-273`), numa apólice com CT integral (`REQ-271`).
- A elegibilidade registra **quem assinou** e a **data e a hora do momento em que assinou**
  — não são informadas (como em `REQ-209`). Essa data é a **data da elegibilidade**.

`REQ-282` **A elegibilidade é definitiva.** Cada apólice tem **no máximo uma** comissão
elegível. Depois de elegível, a comissão **só serve para consulta**: a CR não é alterável,
a comissão não volta a calculada e não é cancelada. O que pode acontecer depois (estorno e
outros) **não está definido** (`DEC-211`).

### 9A.5 Extrato de elegibilidade e consulta

`REQ-283` **Extrato de elegibilidade.** Quando a comissão se torna elegível, o sistema gera
**automaticamente** um extrato — o **histórico canônico daquele evento** — a partir do qual
o **sistema financeiro** cria o seu próprio controle. Nada nele é digitado: tudo vem da
apólice, da comissão calculada e da assinatura.

| Dado                                  | Observação                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| **Número da apólice**                 |                                                                                  |
| **Corretor**                          | Parte envolvida. Por ora, o **nome** que consta da proposta e da apólice (`DEC-208`) |
| **Cliente**                           | Informativo                                                                      |
| **Prêmio líquido**                    |                                                                                  |
| **CT**                                |                                                                                  |
| **CR**                                | O percentual do repasse (`REQ-270`) — `Q-203` respondida                         |
| **CTU**                               | Só quando o recebimento foi através de intermediária                             |
| **Valor recebido pela Usina**         | O valor da Usina — pela CT, ou pela CTU havendo intermediária (`REQ-274`)        |
| **Data da elegibilidade**             | `REQ-281`                                                                        |
| **Valor que fica na Usina**           | `REQ-275`                                                                        |
| **Valor a repassar ao corretor**      | `REQ-275`                                                                        |
| **Quem confirmou a elegibilidade**    | Quem assinou (`REQ-281`)                                                         |

Os valores são os do momento da elegibilidade; o extrato não é recalculado. O **meio** pelo
qual o sistema financeiro recebe o extrato não é regra de negócio.

`REQ-284` **Consulta das comissões elegíveis.** As comissões elegíveis são **somente
leitura** e podem ser listadas com **filtros** por:

- **número da apólice**;
- **período da elegibilidade**;
- **corretor**;
- **período da renovação** (mês/ano);
- **cliente**.

Como os filtros funcionam (confirmado em 2026-09-25): número da apólice, corretor e cliente
casam **por trecho**, sem diferenciar maiúsculas de minúsculas; o período da elegibilidade é
um **intervalo de datas de/até**, e o da renovação um **intervalo de mês/ano de/até**, ambos
**inclusivos**.

Da comissão elegível se chega à **apólice**, e da apólice se chega à **sua comissão**.

`REQ-286` **Apólices sem CR.** O sistema lista as **apólices sem CR** (`REQ-285`) — as que
ainda precisam de uma CR para ter o repasse calculado (`REQ-273`). `Q-204` respondida.
A lista mostra **só as apólices que podem receber CR hoje**: apólice com CT parcelada
**não aparece** nela (`REQ-271`); se terá lista própria está em aberto (`Q-212`).

---

## 9B. Repasse e elegibilidade com CT parcelada — em definição

> Definido **em parte** em **2026-10-05** (`DEC-210` respondida em parte). Fluxo paralelo ao
> da seção 9A, que vale para a CT integral e **não muda**. O que não está escrito aqui como
> regra está nas perguntas `Q-206` a `Q-213` e **não deve ser implementado**.

`REQ-287` **Dois CRs.** Numa apólice com CT parcelada, a CR passa a ser **dois campos**: a
**CR da primeira parcela** e a **CR das demais** (⚠ CONFIRMAR — `Q-206`: "CR da segunda"
como CR de cada parcela a partir da segunda).

`REQ-288` **Elegibilidade por parcela.** A elegibilidade **não é da apólice nem do prêmio
líquido**: é **de cada parcela**. A confirmação de recebimento de uma parcela é a
**elegibilidade daquela parcela** (o recebimento da seguradora → Usina, `DEC-209`
respondida).

`REQ-289` **CRs congelados.** Os CRs **não podem mudar** depois de uma parcela ser dada como
"reconhecida" (⚠ CONFIRMAR — `Q-209`: se "reconhecida" é a parcela elegível de `REQ-288`).

---

## 10. Fluxo principal

> Os dois fluxos abaixo são os da **CT integral**, **validados**. O fluxo da **CT parcelada**
> vem em seguida, em definição.

### FP-01 — Proposta → Apólice

1. O usuário registra a **proposta** com os dados comerciais e a forma de pagamento
   (`REQ-201`).
2. Informa os dados padronizados: número, prêmio líquido, vigência, renovação e parcelas —
   digitando ou **importando o PDF** da seguradora (`REQ-202`, `REQ-207`).
3. Informa a **CT** e se ela é integral ou parcelada, levantadas internamente
   (`REQ-208`, `REQ-213`). Fica registrado quem informou (`REQ-215`).
4. Declara se o recebimento é **direto ou através de intermediária**. Havendo
   intermediária, informa a **CTU** (`REQ-220`, `REQ-221`). Fica registrado quem declarou
   (`REQ-223`).
5. Informa os **dados específicos do produto**, quando o produto os tiver (`REQ-205`).
6. A proposta fica **`AGUARDANDO_EMISSÃO`**, exibindo **quanto a Usina espera receber**
   (`REQ-230`, `REQ-231`, `REQ-232`).
7. Enquanto aguarda, **CT, modo da CT, intermediária e CTU podem ser corrigidos**
   (`REQ-252`).
8. A seguradora responde, e um usuário da Usina identifica o desfecho no sistema dela:
   - **emitida** → registra o **reconhecimento**, com data, hora e autoria (`REQ-209`), e
     pode enviar o **PDF da apólice** (`REQ-247`);
   - **recusada** → registra a recusa com o **motivo obrigatório**; o fluxo encerra sem
     apólice (`REQ-253`).

9. A **apólice é criada**, herdando todos os dados (`REQ-240`, `REQ-241`). A proposta passa
   a **`EMITIDA`** e fica congelada (`REQ-244`).
10. A base de comissionamento é **canonizada na apólice** (`REQ-245`). O repasse ao corretor
    segue pelo FP-02 (`REQ-233`).

### FP-02 — Apólice → Comissão elegível

1. A **apólice existe** (FP-01, passo 9), ainda **sem CR** (`REQ-273`).
2. Sendo a CT **integral**, um usuário da Usina informa a **CR**, de 0 a 100% com até duas
   casas (`REQ-270`–`REQ-272`). Fica registrado quem informou, quando e os dados do
   cálculo (`REQ-279`).
3. A comissão fica **`CALCULADA`**, exibindo o **valor da Usina**, o **valor a repassar ao
   corretor** e o **valor que fica na Usina** (`REQ-274`, `REQ-275`, `REQ-278`).
4. Enquanto calculada, a CR pode ser **recalculada** — com motivo, autor, data e hora, CR
   anterior e nova (`REQ-277`, `REQ-279`).
5. Um usuário verifica, **fora do sistema**, que a Usina recebeu a comissão da apólice, e
   **assina a elegibilidade** (`REQ-281`).
6. A comissão passa a **`ELEGÍVEL`**, de forma definitiva, e o sistema gera o **extrato de
   elegibilidade** (`REQ-282`, `REQ-283`).
7. O fluxo encerra. O repasse é feito **fora do sistema** (`REQ-280`); a comissão elegível
   fica disponível para consulta (`REQ-284`).

### FP-01 e FP-02 com CT parcelada — em definição

1. O usuário registra a proposta como no FP-01, passos 1, 2 e 5, informando **ao menos uma
   parcela** (`REQ-292`).
2. Informa o modo **parcelado** e os **dois CTs** — da primeira e das subsequentes
   (`REQ-291`, `REQ-295`). Fica registrado quem informou (`REQ-215`).
3. O recebimento é **direto**: não há intermediária nem CTU (`REQ-296`).
4. A proposta fica **`AGUARDANDO_EMISSÃO`**, exibindo **o valor esperado de cada parcela**,
   sem total (`REQ-293`, `REQ-294`).
5. Reconhecimento da emissão ou recusa, como no FP-01, passo 8.
6. A apólice é criada, herdando os dois CTs e as parcelas, e **fixa o valor esperado de cada
   parcela** (`REQ-293`, `REQ-297`).
7. Um usuário informa os **dois CRs** (`REQ-287`).
8. Cada parcela tem o seu recebimento confirmado, que é a **sua elegibilidade** (`REQ-288`).
   Depois disso, os CRs não mudam (`REQ-289`).

O restante deste fluxo (cálculo do repasse por parcela, auditoria, extrato, consulta,
situações) está nas perguntas `Q-207` a `Q-213`.

---

## 11. Fluxos alternativos, exceções, aceitação e rejeição

### 11.1 Fluxos alternativos

| ID       | Situação                                 | Comportamento                                                                        |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `FA-201` | Recebimento direto da seguradora         | Sem intermediária e sem CTU; vale `REQ-230`                                          |
| `FA-202` | Recebimento através de intermediária     | Intermediária e CTU informadas; vale `REQ-231`                                       |
| `FA-203` | CT corrigida antes da emissão            | Permitido, com registro de autoria (`REQ-214`, `REQ-215`)                            |
| `FA-204` | Intermediária corrigida antes da emissão | Permitido, com registro de autoria (`REQ-225`, `REQ-223`)                            |
| `FA-205` | Parcelas sem vencimento informado        | Permitido — o vencimento é opcional (`REQ-204`)                                      |
| `FA-206` | Produto sem dados específicos            | Permitido (`REQ-205`)                                                                |
| `FA-207` | Importação de PDF não disponível         | O registro segue por digitação (`REQ-206`)                                           |
| `FA-208` | Seguradora não emite a proposta          | `RECUSADA` com motivo obrigatório; não gera apólice (`REQ-253`)                      |
| `FA-209` | Intermediária retirada antes da emissão  | Permitido; a CTU deixa de existir e o cálculo volta ao direto (`REQ-252`, `REQ-230`) |
| `FA-210` | Apólice sem CR                           | Válida; sem comissão calculada e sem elegibilidade até a CR ser informada (`REQ-273`) |
| `FA-211` | CR zero informada deliberadamente        | Permitido; nada a repassar, todo o valor fica na Usina (`REQ-272`)                   |
| `FA-212` | Recálculo da comissão calculada          | Permitido, com motivo e auditoria (`REQ-277`, `REQ-279`)                             |
| `FA-213` | Apólice recebida através de intermediária | A CR incide sobre o valor da Usina pela CTU (`REQ-274`)                              |
| `FA-214` | Apólice com CT parcelada                 | Sem a CR única da seção 9A; fora das situações e da lista de apólices sem CR de `REQ-285`/`REQ-286`. Segue a seção 9B (`REQ-271`) |
| `FA-216` | PDF da apólice não enviado no reconhecimento | Permitido; o PDF pode ser enviado depois, na apólice (`REQ-247`)              |
| `FA-217` | Proposta com CT parcelada                | Dois CTs, ao menos uma parcela, sem intermediária; valor esperado por parcela (`REQ-290`–`REQ-296`) |
| `FA-218` | CT parcelada com uma só parcela          | Permitido; os dois CTs continuam obrigatórios; só o CT da primeira é aplicado (`REQ-291`) |

### 11.2 Exceções

| ID       | Exceção                                  | Tratamento           |
| -------- | ---------------------------------------- | -------------------- |
| `EX-201` | Tentativa de alterar dado após a emissão | Recusada (`REQ-260`) |
| `EX-202` | Intermediária declarada sem CTU          | Recusada (`REQ-221`) |
| `EX-203` | Recusa informada sem motivo              | Recusada (`REQ-253`) |
| `EX-204` | Alteração de CR sem motivo               | Recusada (`REQ-279`) |
| `EX-205` | Elegibilidade de apólice sem CR          | Recusada (`REQ-273`, `REQ-281`) |
| `EX-206` | Tentativa de alterar comissão elegível   | Recusada (`REQ-282`) |
| `EX-207` | Intermediária declarada em proposta com CT parcelada | Recusada, com mensagem de erro (`REQ-296`) |
| `EX-208` | CT parcelada sem parcelas                | Recusada (`REQ-292`) |
| `EX-209` | CT parcelada sem um dos dois CTs         | Recusada (`REQ-291`) |

### 11.3 Critérios de aceitação

| ID       | Critério                                                                                                                           | Verifica             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `CA-201` | Prêmio líquido 100,00 com CT 20% e sem intermediária faz a Usina esperar 20,00                                                     | `REQ-230`            |
| `CA-202` | Prêmio líquido 100,00 com CT 20% e CTU 50% faz a intermediária receber 20,00 e a Usina esperar 10,00                               | `REQ-231`            |
| `CA-203` | A proposta exibe o valor esperado **antes** da emissão                                                                             | `REQ-232`            |
| `CA-204` | A CT pode ser corrigida enquanto a proposta aguarda emissão, e a correção registra autor e data                                    | `REQ-214`, `REQ-215` |
| `CA-205` | Reconhecida a emissão, a apólice é criada com **os mesmos** número, prêmio, CT, intermediária, CTU, vigência, renovação e parcelas | `REQ-241`            |
| `CA-206` | A data de renovação da apólice é igual à data de fim da vigência                                                                   | `REQ-203`            |
| `CA-207` | O reconhecimento da emissão registra data, hora e quem identificou                                                                 | `REQ-209`            |
| `CA-208` | Uma parcela sem vencimento é aceita                                                                                                | `REQ-204`            |
| `CA-209` | A importação do PDF preenche número, vigência, renovação e parcelas                                                                | `REQ-207`            |
| `CA-210` | A proposta declara se a CT é integral ou parcelada                                                                                 | `REQ-213`            |
| `CA-211` | Acrescentar outra regra de base do repasse ao corretor não exige reescrever o cálculo do que a Usina recebe                        | `REQ-234`, `REQ-274` |
| `CA-212` | Uma proposta recusada registra o motivo e **não** origina apólice                                                                  | `REQ-253`            |
| `CA-213` | Uma proposta aceita no máximo **uma** intermediária                                                                                | `REQ-220`            |
| `CA-214` | Retirar a intermediária antes da emissão faz o valor esperado voltar a ser prêmio × CT                                             | `REQ-230`, `REQ-252` |
| `CA-216` | Uma proposta sem parcelas é aceita; sem qualquer outro dado de `REQ-202` ou sem o modo da CT, é recusada                           | `REQ-202`            |
| `CA-217` | O modo da CT pode ser corrigido antes da emissão, com autor e data                                                                 | `REQ-214`, `REQ-215` |
| `CA-218` | Proposta com prêmio líquido 0,00 ou negativo é recusada                                                                            | `REQ-217`            |
| `CA-220` | O PDF de referência preenche número, cliente, corretor, seguradora, ramo, forma de pagamento, prêmio líquido, vigência e parcelas, sem registrar a proposta | `REQ-218`            |
| `CA-221` | Um PDF legível sem algum desses dados resulta em `PARTIAL`; o dado ausente fica vazio, não estimado                                | `REQ-218`            |
| `CA-222` | Um arquivo que não é PDF, ou PDF sem conteúdo utilizável, resulta em `FAILED`                                                      | `REQ-218`            |
| `CA-219` | Prêmio 100,00, CT 20% e CTU 50%: a comissão acordada da apólice é 10,00 a receber; nenhuma parte do corretor vem de tabela         | `REQ-236`            |
| `CA-223` | A proposta registrada a partir de um PDF importado guarda o arquivo, que pode ser aberto na proposta — também quando a leitura falhou | `REQ-219`            |
| `CA-224` | Enviados dois PDFs antes do registro, a proposta guarda só o último                                                                 | `REQ-219`            |
| `CA-225` | Recebimento direto: prêmio 1.000,00, CT 30% e CR 60% — valor da Usina 300,00, a repassar 180,00, fica na Usina 120,00              | `REQ-274`            |
| `CA-226` | Com intermediária: prêmio 1.000,00, CT 20%, CTU 80% e CR 70% — valor da Usina 160,00, a repassar 112,00, fica na Usina 48,00       | `REQ-274`            |
| `CA-227` | Valor da Usina 10,00 e CR 70,55%: a repassar 7,05 (piso), fica na Usina 2,95                                                        | `REQ-275`            |
| `CA-228` | CR 0 informada: a repassar 0,00, todo o valor fica na Usina                                                                         | `REQ-272`            |
| `CA-229` | CR 0, 70,55 e 100 são aceitas                                                                                                        | `REQ-272`            |
| `CA-230` | Informar a CR registra autor, data e hora e os dados do cálculo; alterá-la registra ainda CR anterior, CR nova e motivo              | `REQ-279`            |
| `CA-231` | Ao informar ou alterar a CR, são exibidos o valor a repassar e o valor que fica na Usina                                            | `REQ-278`            |
| `CA-232` | A elegibilidade registra quem assinou e a data e a hora do momento da assinatura                                                     | `REQ-281`            |
| `CA-233` | A elegibilidade gera o extrato com todos os dados de `REQ-283`, sem digitação                                                        | `REQ-283`            |
| `CA-234` | As comissões elegíveis podem ser filtradas por número da apólice, período da elegibilidade, corretor, período da renovação e cliente | `REQ-284`            |
| `CA-235` | Da comissão elegível se abre a apólice, e da apólice se abre a sua comissão                                                          | `REQ-284`            |
| `CA-236` | Uma apólice sem CR existe e é consultável, sem comissão calculada                                                                    | `REQ-273`            |
| `CA-237` | O extrato de elegibilidade traz o percentual da CR                                                                                   | `REQ-283`            |
| `CA-238` | Uma apólice sem CR aparece na lista de apólices sem CR; informada a CR, deixa de aparecer                                            | `REQ-286`            |
| `CA-239` | Toda apólice com CT integral está em exatamente uma situação: sem CR, com CR calculada ou com CR elegível                            | `REQ-285`            |
| `CA-240` | Uma apólice com CT parcelada não aparece na lista de apólices sem CR                                                                 | `REQ-286`            |
| `CA-241` | Prêmio 100,05 e CT 15%: valor da Usina 15,01. Com CTU 50%: intermediária 15,01 e valor da Usina 7,51 (não 7,50)                     | `REQ-237`            |
| `CA-243` | O PDF da apólice, enviado no reconhecimento ou depois, fica guardado e pode ser aberto na apólice, com quem o enviou e quando       | `REQ-247`            |
| `CA-244` | Enviados dois PDFs para a mesma apólice, o da apólice é o último                                                                     | `REQ-247`            |
| `CA-245` | CT integral exibe um campo de CT; CT parcelada exibe dois — da primeira e das subsequentes                                           | `REQ-291`            |
| `CA-246` | Parcelas de 100,00 e CT 100/30: parcela 1 espera 100,00; cada uma das demais espera 30,00; nenhum total é exibido                    | `REQ-293`            |
| `CA-247` | A base da CT parcelada é o valor da parcela, não o prêmio líquido                                                                    | `REQ-293`            |
| `CA-248` | Arredondamento por parcela pela ABNT NBR 5891: 15,0075 → 15,01; 5,025 → 5,02; 5,075 → 5,08                                          | `REQ-294`            |
| `CA-249` | CTs da parcelada acima de 100% são aceitos (provisório, `DEC-216`)                                                                   | `REQ-295`            |
| `CA-250` | A apólice com CT parcelada guarda o valor esperado de cada parcela                                                                   | `REQ-293`            |
| `CA-251` | O fluxo da CT integral é o mesmo de antes: um CT, base no prêmio líquido, intermediária permitida, `REQ-237`                         | `REQ-290`            |

### 11.4 Casos que devem ser rejeitados

| ID        | Caso                                                                      | Regra                                                           |
| --------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `REJ-201` | Alterar qualquer dado da proposta depois da emissão                       | `REQ-260`                                                       |
| `REJ-202` | Declarar intermediária sem informar a CTU                                 | `REQ-221`                                                       |
| `REJ-203` | Usar o percentual do acordo comercial cadastrado no lugar da CT informada | `REQ-212`                                                       |
| `REJ-204` | Criar a apólice com qualquer valor diferente do da proposta               | `REQ-242` — é a **única** guarda, já que `REQ-243` foi retirada |
| `REJ-205` | Registrar a emissão sem identificar quem a reconheceu                     | `REQ-209`                                                       |
| `REJ-206` | Informar ou alterar CT sem registrar autoria                              | `REQ-215`                                                       |
| `REJ-207` | Calcular o repasse ao corretor dentro do FP-01                            | `REQ-233`                                                       |
| `REJ-208` | Registrar recusa sem motivo                                               | `REQ-253`                                                       |
| `REJ-209` | Declarar mais de uma intermediária na mesma proposta                      | `REQ-220`                                                       |
| `REJ-210` | Originar apólice de uma proposta recusada                                 | `REQ-253`                                                       |
| `REJ-211` | Alterar prêmio líquido, número, vigência ou parcelas depois do registro   | `REQ-261`                                                       |
| `REJ-212` | Alterar uma proposta recusada                                             | `REQ-253`                                                       |
| `REJ-213` | Declarar intermediária ou alterar CT sem identificar o autor              | `REQ-215`, `REQ-216`, `REQ-223`                                 |
| `REJ-214` | Registrar proposta com fim da vigência igual ou anterior ao início        | `REQ-202`                                                       |
| `REJ-215` | Registrar proposta com parcela de valor zero ou negativo                  | `REQ-204`                                                       |
| `REJ-216` | Informar a CR na proposta, antes de a apólice existir                     | `REQ-271`                                                       |
| `REJ-217` | Informar uma segunda CR na mesma apólice                                  | `REQ-271`                                                       |
| `REJ-218` | Informar a CR única (seção 9A) em apólice com CT parcelada                | `REQ-271`, `REQ-287`                                            |
| `REJ-219` | CR negativa, acima de 100% ou com mais de duas casas decimais             | `REQ-272`                                                       |
| `REJ-220` | Assumir uma CR (inclusive zero) que não foi informada deliberadamente     | `REQ-272`                                                       |
| `REJ-221` | Calcular o repasse sobre base que não o valor da Usina                    | `REQ-274`                                                       |
| `REJ-222` | Usar tabela do corretor no lugar da CR informada                          | `REQ-270`                                                       |
| `REJ-223` | Informar ou alterar a CR sem identificar o autor                          | `REQ-216`, `REQ-279`                                            |
| `REJ-224` | Alterar a CR sem motivo                                                   | `REQ-279`                                                       |
| `REJ-225` | Cancelar ou descartar a comissão calculada, ou retirar a CR               | `REQ-277`                                                       |
| `REJ-226` | Tornar elegível a comissão de uma apólice sem CR                          | `REQ-273`, `REQ-281`                                            |
| `REJ-227` | Tornar a comissão elegível automaticamente ou sem identificar quem assinou | `REQ-281`                                                      |
| `REJ-228` | Alterar, cancelar ou devolver a calculada uma comissão elegível, ou torná-la elegível de novo | `REQ-282`                                   |
| `REJ-229` | Executar pagamento ou movimentação financeira no sistema                  | `REQ-280`                                                       |
| `REJ-230` | Receber comissão parcelada através de intermediária                       | `REQ-296`                                                       |
| `REJ-231` | Aplicar a CT parcelada sobre o prêmio líquido                             | `REQ-293`                                                       |
| `REJ-232` | Acumular os valores esperados das parcelas num total                      | `REQ-293`                                                       |
| `REJ-233` | Registrar CT parcelada sem parcelas ou sem um dos dois CTs                | `REQ-291`, `REQ-292`                                            |
| `REJ-234` | Alterar os CRs da parcelada depois de uma parcela reconhecida             | `REQ-289`                                                       |

---

## 12. Mapa V1 → V2

### 12.1 Regras **descartadas**

| V1                                                                                                       | Por quê                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REQ-051`, `REJ-001`, `CA-009` — "somente a apólice pode ser base de cálculo; a proposta nunca"          | Substituídas por `REQ-232`: a base **nasce** na proposta e **se fixa** na apólice. A proteção que a regra queria dar está em `REQ-214`/`REQ-215` |
| `REQ-061`, `IN-03` — "a configuração da cadeia é dado cadastral"                                         | Substituídas por `REQ-220`: a intermediária é declarada **na proposta**                                                                          |
| `REQ-063`, `REQ-064`, `CA-011`, `CA-012` — base padrão e configurável **por intermediária**, no cadastro | Substituídas por `REQ-231` (CTU) e `REQ-234` (base do repasse)                                                                                   |
| `REQ-065` (uso no recebível) — percentual do acordo comercial define o que a Usina recebe                | Substituída por `REQ-212`: quem define é a **CT**                                                                                                |
| `IN-02`, `REQ-065` — cadastro de acordos comerciais por seguradora e produto                             | Removido por `REQ-236` (`DEC-202` respondida): a comissão acordada vem da CT/CTU da proposta                                                     |
| `REQ-041` — "transmissão"                                                                                | Substituída por `REQ-209`: o que se registra é o **reconhecimento da emissão**                                                                   |
| `IN-05`, `REQ-093` — tabela de comissão do corretor aplicada sobre a base                                | Substituídas por `REQ-270`: a parte do corretor é a **CR**, informada por apólice                                                                |
| `REQ-090`, `REQ-091`, `REQ-092`, `ITP-008`, `CA-022`–`CA-024`, `REJ-009`, `DEC-002` — liberação do repasse por forma de pagamento | Substituídas por `REQ-281`: a elegibilidade é **a Usina ter recebido**, verificado e assinado por um usuário |
| `REQ-040` (parte do aceite), `CA-001` — a proposta só é registrada com o aceite do cliente | Retirado em 2026-09-28 (`REQ-201`): o aceite do cliente **deixou de ser dado da proposta** — o usuário da Usina não o tem no cadastro e nenhuma regra o consome. A forma de pagamento continua obrigatória |

### 12.2 Regras **alteradas**

| V1                                                                               | V2                                                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `REQ-020` — vigência, prêmio e parcelas são atributos da **apólice**             | `REQ-202`, `REQ-241` — são atributos da **proposta**, herdados pela apólice                                      |
| `REQ-022` — prêmio líquido e CT entre os atributos da proposta, sem uso definido | `REQ-210`, `REQ-212` — com origem, uso e mutabilidade declarados                                                 |
| Seção 10.2 — quatro estados (`RASCUNHO`, `TRANSMITIDA`, `ACEITA`, `RECUSADA`)    | `REQ-250` — três: `AGUARDANDO_EMISSÃO` → `EMITIDA` \| `RECUSADA`. `TRANSMITIDA` e `ACEITA` colapsam em `EMITIDA` |
| `REQ-045`, `REQ-047` — recusa com motivo, sem apólice                            | `REQ-253` — mantidas em substância, renumeradas                                                                  |
| `REQ-055` — data de renovação informada                                          | `REQ-203` — é a data de fim da vigência                                                                          |
| `DEC-013` — origem dos dados da proposta indefinida                              | `REQ-206`, `REQ-207` — digitação **e** importação de PDF                                                         |
| `REQ-082`, `CA-019` — número da proposta único, validado na "transmissão"        | `DEC-207` — sem restrição por ora                                                                                |
| `DEC-015` — outros dados devolvidos pela seguradora                              | `REQ-205` — existem, variam por produto, informativos; catálogo em `DEC-201`                                     |
| FP-03 — repasse ao corretor, da liberação ao pagamento registrado                | FP-02 — da CR à **elegibilidade**; o pagamento acontece fora do sistema (`REQ-280`)                              |
| `REQ-094`, `REQ-095`, `REQ-096` — relatório de repasse, recibo, registro do pagamento | **Suspensas**, não descartadas: aguardam os fluxos posteriores à elegibilidade (`DEC-211`). O repasse da V1 (abertura, liberação, pagamento, comprovante, extrato por corretor) foi **removido do sistema** em 2026-09-25; volta, sob a V2, quando `DEC-211` for decidida |
| `REQ-066` — ajuste extraordinário da comissão acordada, a receber e a pagar | Mantido **só no lado a receber** (2026-09-25): sem tabela do corretor não há "a pagar" a ajustar; a parte do corretor é a CR (`REQ-270`) |

### 12.3 Retiradas **durante** o levantamento

| Item                                                       | Por quê                                                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-243` — sinalizar divergência entre proposta e apólice | Proposta na primeira rodada e **retirada na segunda**: como a apólice só herda e nada é redigitado, a divergência não tem como surgir neste fluxo. A igualdade é garantida por `REQ-242`/`REJ-204` |
| `EX-201` (versão anterior) — exceção da divergência acima  | Retirada junto                                                                                                                                                                                     |
| `REQ-234` (versão anterior) — base do repasse configurável entre o valor da intermediária e o da Usina | Em 2026-09-25 a base passou a ser **sempre o valor da Usina** (`REQ-274`), mantida desacoplada do cálculo                                                          |
| `REQ-236` (trecho) — "a parte do corretor continua sendo a tabela do corretor" | Retirado com a tabela do corretor (`REQ-270`). `CA-219` perdeu a parte "1,00 a pagar", que vinha da tabela                                                                     |
| `CA-215` — "com a CT parcelada, o valor esperado é o mesmo da CT integral"  | Em 2026-10-05 a CT parcelada ganhou cálculo próprio, por parcela (`REQ-293`, `DEC-203` respondida). O identificador não é reaproveitado |
| `REQ-235` (versão anterior) — base = prêmio líquido **qualquer que seja o modo** | Passou a valer só para a CT integral; a parcelada usa a parcela (`REQ-293`) |
| `REQ-271`, `FA-214`, `REJ-218` (versões anteriores) — apólice com CT parcelada sem CR, sem comissão calculada nem elegível | Em 2026-10-05 a parcelada ganhou dois CRs e elegibilidade por parcela (seção 9B). A CR única da seção 9A continua só para a integral |
| `FA-215`, `CA-242` — proposta registrada sem o aceite do cliente                | Em 2026-09-28 o aceite deixou primeiro de ser obrigatório e, na mesma data, foi retirado da proposta (`REQ-201`). Os dois itens perderam o objeto; os identificadores não são reaproveitados |

### 12.4 Regras **mantidas** da V1

`REQ-002`, `REQ-003` (o sistema reflete decisões externas) · `REQ-040` (forma de pagamento;
o aceite do cliente foi retirado — seção 12.1) · `REQ-048`, `REQ-049`, `REQ-050` (a proposta origina no máximo uma
apólice; os dois números seguem consultáveis) · `REQ-120`, `REQ-121` (precisão decimal) ·
`REQ-123` (quem, quando e por quê) · `REQ-124` (nada é apagado).

---

## 13. Decisões pendentes e perguntas abertas

### 13.1 Decisões pendentes

| ID        | Pendência                                                                                                                                                                              | Impacto                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `DEC-201` | **Catálogo de dados por produto** — quais campos existem para automóvel, residencial e demais produtos, e quem define a lista                                                          | `REQ-205` fica sem conjunto definido                        |
| `DEC-204` | **Layouts de PDF** — de quais outras seguradoras além da Allianz (`REQ-218`)                                                                                                         | Cada novo layout precisa de amostra                         |
| `DEC-205` | **Correção de registro errado** — como um registro com dado incorreto é encerrado e se o número volta a ficar disponível                                                               | `REQ-262`; deixado em aberto por decisão do negócio         |
| `DEC-206` | **Endosso, sinistro e renovação** sobre a apólice                                                                                                                                      | `REQ-246`; fora desta entrega                               |
| `DEC-208` | **Governança de dados dos cadastros** — hoje cliente, corretor e forma de pagamento lidos do PDF entram como o texto do documento. No futuro haverá cadastro formal (prévio ou não) e busca de identificadores já conhecidos (ex.: renovação, cliente recorrente). A identificação deve ficar desacoplada da leitura. **O corretor também terá identificação por id**, para controle e governança: hoje vale o nome declarado na proposta e na apólice — inclusive no extrato de elegibilidade (`REQ-283`) —, mas no futuro próximo o corretor terá dados enriquecidos e o nome não bastará, ali e em outros pontos do sistema | Os identificadores lidos do PDF são provisórios; o corretor do extrato é, por ora, só o nome |
| `DEC-210` | **Repasse e elegibilidade com CT parcelada** — respondida **em parte** em 2026-10-05: dois CRs (`REQ-287`), elegibilidade por parcela (`REQ-288`), CRs congelados depois de uma parcela reconhecida (`REQ-289`). O restante está em `Q-206`–`Q-213` | A seção 9B só tem o que foi confirmado; o resto não é implementado |
| `DEC-216` | **Faixa dos CTs da parcelada** — como funciona de fato: o negócio citou 0–200% e precisa levantar mais. **Provisório**, explícito: acima de 100% e sem limite superior (`REQ-295`) | Só os CTs da parcelada; a faixa da CT integral não muda |
| `DEC-211` | **Depois da elegibilidade** — estorno e outras possibilidades ainda não levantadas; relatório de repasse, recibo e registro do pagamento (`REQ-094`–`REQ-096` da V1, suspensas) | A comissão elegível é final e só consultável (`REQ-282`) |
| `DEC-212` | **Valor efetivamente recebido diferente do valor da Usina** — a CR incide sobre o valor da Usina calculado da apólice (`REQ-274`); o que acontece se a Usina receber outro valor **não foi discutido** | Nenhuma regra: a elegibilidade não registra o valor efetivamente recebido |
| `DEC-213` | **Conteúdo do PDF da apólice** — quais informações o PDF da apólice deve conter, e se o sistema deve ler, extrair ou conferir algum dado dele. Deixado em aberto para uma rodada futura de levantamento de requisitos | `REQ-247`: o arquivo é guardado como enviado; nenhum conteúdo é lido nem validado |
| `DEC-214` | **Cadastro manual de corretores** — se os usuários da Usina poderão cadastrar corretores manualmente. Objetivo: permitir, posteriormente, o **controle, a busca e a filtragem** de informações relacionadas aos corretores pelos usuários da Usina. **Não definidos**: os campos do corretor, as regras de cadastro, as validações, as permissões, o fluxo de aprovação e os filtros. Relacionada a `DEC-208` | Nenhuma regra: não há cadastro manual de corretores |
| `DEC-215` | **CPF do cliente na proposta** — se o CPF do cliente poderá ser informado no cadastro da proposta. Objetivo: avaliar se essa informação será necessária para permitir, posteriormente, o **controle, a busca e a filtragem** de informações relacionadas aos clientes e às propostas pelos usuários da Usina. **Não definidos**: a obrigatoriedade, o formato e a validação, a etapa do fluxo em que é informado, os filtros, as regras de privacidade e de acesso, e se a decisão depende ou não de `DEC-214` | Nenhuma regra: a proposta não tem CPF do cliente |
| `DEC-207` | **Unicidade do número da proposta** — se dois registros podem ter o mesmo número. **Por ora, sem restrição**; relacionada a `DEC-205` (o número "voltar a ficar disponível")          | Nenhuma unicidade é validada no registro. Confirmado: quando a conciliação busca pelo número e há repetição, vale a proposta **registrada primeiro**. Como o número da apólice é o da proposta (`REQ-241`), ele **também não é validado como único** por ora |

### 13.2 Confirmações pendentes

**CT parcelada (2026-10-05)** — perguntas abertas. Nada delas é regra:

| ID | Pergunta |
| --- | --- |
| `Q-205` | **Edição antes da emissão** (`REQ-297`): os dois CTs são editáveis como a CT integral, com autoria? Trocar o modo para parcelado com intermediária já declarada é recusado (como declarar intermediária numa parcelada, `REQ-296`)? E trocar para parcelado numa proposta registrada **sem parcelas**, que não podem mais ser incluídas (`REQ-261`)? |
| `Q-206` | **Os dois CRs** (`REQ-287`): "CR da segunda" é a CR de **cada parcela a partir da segunda**, como o CT das subsequentes? A faixa é a da integral (0–100%, até duas casas, zero só deliberado — `REQ-272`)? Os dois são informados juntos e são obrigatórios? |
| `Q-207` | **Cálculo do repasse por parcela**: a base é o valor esperado da parcela (`REQ-293`) × a CR correspondente? O valor do corretor é arredondado com **piso** (`REQ-275`) ou pela **ABNT NBR 5891** (`REQ-294`)? O que fica na Usina é a diferença? |
| `Q-208` | **Recálculo e auditoria**: antes da primeira parcela reconhecida, os CRs podem ser alterados com motivo e auditoria, como em `REQ-277`/`REQ-279`? |
| `Q-209` | **"Reconhecida"** (`REQ-289`): é a parcela que se tornou **elegível** (`REQ-288`)? Os CRs congelam para **todas** as parcelas a partir da primeira reconhecida? |
| `Q-210` | **Ato da elegibilidade da parcela** (`REQ-288`): é assinado por um usuário (`REQ-216`) no momento do registro, como `REQ-281`? Exige os CRs informados? Precisa seguir a ordem das parcelas? É definitivo, como `REQ-282`? |
| `Q-211` | **Extrato e consulta**: cada parcela elegível gera um extrato? Com quais dados além dos de `REQ-283` (número da parcela, valor, CT e CR aplicados)? A consulta de `REQ-284` lista parcelas, com os mesmos filtros? |
| `Q-212` | **Situações e lista**: quais são as situações de uma apólice parcelada quanto ao repasse (`REQ-285` vale só para a integral)? Existe uma lista de apólices parceladas sem CR, como `REQ-286`? |
| `Q-213` | **"Confirmar recebimento" existente**: a confirmação de pagamento de parcela que já existe na apólice vem da V1 (o **cliente** pagou — `REQ-092`, descartada na seção 12.1). Na apólice parcelada ela passa a ser a elegibilidade da parcela. E na apólice com CT **integral**, ela continua como está? |
| `Q-214` | **Arredondamento — padronizar**: a ABNT NBR 5891 vale **só para a parcelada**, ou deve passar a valer também na integral? Na integral isso mudaria `REQ-237` e valores já validados (`CA-241`: 7,505 → 7,51 hoje; pela norma seria 7,50). |

**Respondidas anteriormente:**

- **`DEC-203`** (2026-10-05) — com CT parcelada, os CTs incidem sobre o valor de cada
  parcela, e o valor esperado é por parcela; são dois CTs (`REQ-291`, `REQ-293`).
- **`DEC-209`** (2026-10-05) — com CT parcelada, as parcelas são a base do recebimento
  seguradora → Usina e da elegibilidade (`REQ-293`, `REQ-288`). Com CT integral nada
  muda: nenhuma regra depende das parcelas.

- **`Q-201`** — o modo da CT é editável antes da emissão, junto com a CT e com autoria
  (`REQ-214`, `REQ-252`).
- **`Q-202`** — a recusa é definitiva; o registro fica consultável (`REQ-253`).
- **`Q-203`** — o percentual da CR entra no extrato de elegibilidade (`REQ-283`).
- **`Q-204`** — o sistema lista as apólices sem CR (`REQ-286`); a apólice está sempre em
  uma de três situações: sem CR, com CR calculada, com CR elegível (`REQ-285`).

---

## 14. Critério de parada — situação

| Critério                                                    | Situação              |
| ----------------------------------------------------------- | --------------------- |
| Responsabilidades da Proposta explicitamente definidas      | ✅ seções 3 e 4       |
| Fluxo Proposta → Apólice definido                           | ✅ seções 7 e 10      |
| Dados financeiros da Proposta identificados e classificados | ✅ `REQ-210`          |
| Comportamento da intermediária na Proposta definido         | ✅ seções 5 e 6       |
| Regras mantidas distinguidas das descartadas e alteradas    | ✅ seção 12           |
| Fluxo Apólice → Comissão elegível definido                  | ✅ seção 9A e FP-02   |
| Comissão calculada distinguida da elegível                  | ✅ `REQ-276`–`REQ-282` |
| Auditoria da CR e da elegibilidade definida                 | ✅ `REQ-279`, `REQ-281` |
| Limite do sistema no financeiro declarado                   | ✅ `REQ-280`          |
| Dúvidas restantes registradas como pendências               | ✅ seções 13.1 e 13.2 |

**Não foi escrito nenhum código.** A comparação desta especificação com o sistema existente
é a próxima etapa, e só deve começar depois da sua validação — na ordem que você definiu:
requisito confirmado → comparação com o código → divergência → menor alteração necessária.
