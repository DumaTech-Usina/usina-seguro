/*
 * Propostas em aberto (OUT-01)
 *
 * Lista das propostas transmitidas e ainda sem desfecho, que REQ-043 exige poder
 * rastrear. Colunas: numero da proposta, cliente, corretor, seguradora, premio
 * liquido, comissao trabalhada e ha quanto tempo esta em aberto.
 *
 * Acoes por linha: abrir o desfecho (aceite -> apolice, recusa -> motivo), que hoje
 * vivem no passo 3 de /app/proposals/new.html.
 *
 * Tambem cobre OUT-02, o relatorio de recusadas (REQ-045), como um filtro por
 * estado sobre a mesma tabela.
 *
 * Bloqueio: GET /proposals (listagem e filtro por estado) nao existe.
 */
