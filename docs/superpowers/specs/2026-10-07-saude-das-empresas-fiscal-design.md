# Saúde das empresas no Fiscal — design aprovado

Data: 2026-10-07. Aprovado em conversa com o Bruno.

## Pedido

A "Leitura dos números" da aba Fechamentos (prejuízo, caixa negativo ou
baixo, empréstimo de sócio) também para o pessoal do Fiscal, que controla a
emissão de notas. E, quando a empresa tiver mais de um fechamento, um gráfico
de comparação com a evolução do caixa e do resultado.

## Decisões do Bruno

- **Todas as empresas do escritório**, sem filtro por carteira.
- **Gráfico com caixa e resultado juntos**: caixa em linha, resultado em
  barras, mês a mês; empréstimo de sócio na tabela abaixo do gráfico.
- **Caminho 1**: uma terceira visão no espaço do Fiscal, ao lado de "Carteira e
  fichas" e "Controle mensal" — não uma faixa no topo da Carteira (já densa) e
  não abrir a aba da Contabilidade ao Fiscal (quebraria a visibilidade por clã).

## Desenho

- Visão **"Saúde das empresas"** (`?tab=portfolio&fiscalView=health`), com
  seletor de ano. Lê as empresas ativas do escritório e os períodos do ano.
- **A mesma leitura da Contabilidade**: os três blocos saem de dentro de
  `closing-overview.tsx` para um componente compartilhado
  (`closing-health.tsx`), usado pelos dois clãs. Regra única em
  `analyzeClosingHealth` (período fechado mais recente; piores primeiro;
  campo vazio não vira zero).
- **Evolução**: empresa com 2 ou mais períodos fechados com mês ganha um botão
  de gráfico na linha; abre um diálogo com o caixa em linha e o resultado em
  barras por mês, e a tabela mês · caixa · resultado · empréstimo. A série sai
  de uma função pura (`closingSeries`). Gráfico em SVG próprio, sem biblioteca
  nova. O botão vale nos dois clãs.
- **Só leitura** para quem vê o clã Fiscal; lançar e corrigir números continua
  na Contabilidade. No Fiscal o nome da empresa não leva à aba Fechamentos.
- **Sem banco novo.**

## Plano

1. `closingSeries` em `src/domain/closing-overview.ts` + testes.
2. `closing-health.tsx` (servidor) com os três blocos; `ClosingOverview` passa
   a usá-lo.
3. `closing-evolution.tsx` (cliente): botão + diálogo + gráfico SVG + tabela.
4. `fiscal-health-tab.tsx` + terceira entrada no `FiscalWorkspaceNav` +
   `PortfolioTab` encaminha `fiscalView=health`.
5. Conferência visual medida (bundle com o CSS do app), portões, develop.

— claude, 07/10/2026
