/*
 * Painel acordado x real (OUT-05)
 *
 * A visao de REQ-076 sobre todas as apolices, e nao uma por vez: comissao acordada,
 * comissao real e a divergenca sinalizada, com filtro por competencia, seguradora e
 * por "somente divergentes".
 *
 * A comparacao por apolice ja esta implementada no cartao de comissao de
 * /app/policies/detail.html; aqui ela vira lista.
 *
 * Bloqueio: GET /commissions (listagem) nao existe — hoje so se le por apolice.
 */
