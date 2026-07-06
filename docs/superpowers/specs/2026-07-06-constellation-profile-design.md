# Constelação de progressão no perfil — design aprovado

Data: 2026-07-06. Aprovado em conversa. Rodada dedicada prevista desde o spec do
tema (a "skill tree" do CLAUDE.md). Base: tema Gelo e Ferro pós passe épico.

## Decisões (fechadas)

- **Nós = níveis** (1 nó por nível). É o único mapeamento 100% derivável dos dados
  existentes (`levelFromXp`/`xpForLevel`) — honesto, sem sistema de badges (segue
  fora de escopo) e sem lógica nova de domínio.
- **Janela deslizante**: `max(0, nível−4)` até `nível+6` (até 11 nós). A constelação
  "anda" conforme o usuário sobe — sempre há caminho à frente.
- **Hero no topo do perfil**: identidade (avatar/nome/papel) vira faixa compacta;
  a constelação é a primeira coisa da página, com a XpBar embutida na base.
  O card "Progresso de XP" morre (redundante). LevelEmblem segue no dashboard.
- **Interação**: nós são botões (tap/hover/teclado); faixa de detalhe fixa sob o
  céu (aria-live) mostra "Nível N — alcançado com X XP" / "faltam Y XP". Nó atual
  selecionado por padrão. Sem tooltip flutuante (mobile-first).
- **Técnica**: SVG inline artesanal, zero dependência nova. Client component leve.

## Visual (linguagem do tema — sem glow, ouro só recompensa)

- Nós são **losangos** (linguagem do emblema). Alcançado = preenchido ouro com anel
  fino; **atual** = losango maior com moldura dupla e número dentro (mini-emblema,
  Cinzel); futuro = contorno aço, número apagado. Números em mono sob os nós.
- Linhas: alcançado→alcançado = ouro sólido; atual→próximo = tracejado aço com
  sobreposição sólida ouro proporcional ao progresso real do nível; futuras =
  tracejado aço.
- Fundo: `texture-iron` + ~40 estrelinhas decorativas (opacidade 4–8%), posições
  determinísticas (seed fixa).
- Posições dos nós: 11 slots art-directed em viewBox fixo (~680×300, serpenteando
  para cima/direita = jornada), com jitter determinístico semeado pelo número do
  nível (mesmo nível ⇒ mesma posição sempre).

## Arquitetura

- `src/lib/constellation.ts` — função pura `constellationNodes(totalXp)` → janela,
  posições, flags reached/current, xpRequired. **Testada em Vitest** (bordas:
  nível 0 ⇒ nós 0..6; janela cheia ⇒ 11 nós com atual no índice 4; posições dentro
  do viewBox; xpRequired crescente).
- `src/components/constellation.tsx` — "use client", recebe `totalXp`, renderiza
  SVG + faixa de detalhe. Importa apenas funções puras (src/domain/xp não tem
  server-only).
- `src/app/(app)/profile/page.tsx` — reorganização descrita acima. Nenhuma mudança
  de schema/servidor.

## Verificação

Vitest (função pura) + build + screenshots (perfil desktop e mobile) com a org demo.
