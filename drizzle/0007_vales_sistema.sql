-- "Vales" passa a ser de sistema: a Fase 5 lança os vales nela (lista em src/modules/despesas/categorias-padrao.ts)
UPDATE "categorias_despesa" SET "sistema" = true WHERE "nome" = 'Vales';
