/*
 * Conciliacao do comissionamento (FP-02) e pendencias (OUT-06)
 *
 * Duas partes:
 *
 * 1. Importacao do relatorio: hoje o endpoint recebe linhas ja estruturadas, entao a
 *    tela seria uma grade editavel (numero da apolice, numero da proposta, comissao
 *    do produtor) mais a competencia. O upload de arquivo de verdade depende de
 *    DEC-001, que nao definiu o layout — sem ele nao ha parser a construir.
 *    O resultado por linha ja vem pronto da API: conciliada, divergente, duplicada,
 *    pendente ou sem comissao.
 *
 * 2. Pendencias (OUT-06): tabela das linhas sem apolice correspondente, que e o
 *    unico endpoint de listagem que ja existe
 *    (GET /commission-reconciliations/pendencies).
 *
 * Bloqueio: Parcialmente pronto: a importacao e as pendencias ja tem endpoint; o upload de arquivo depende de DEC-001.
 */
