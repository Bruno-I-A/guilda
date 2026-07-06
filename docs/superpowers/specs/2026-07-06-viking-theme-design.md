# Tema visual "Gelo e Ferro" — design aprovado

Data: 2026-07-06. Aprovado em conversa. Escopo: tema viking dark aplicado às telas
existentes. A skill tree do perfil fica para uma rodada dedicada, em cima deste tema.

## Decisões (fechadas — não redecidir)

- **Direção**: dark, estilo viking, estética de game. **Sem brilho/glow/neon** — isto
  substitui o "acentos neon" da seção Design e UX do CLAUDE.md (atualizar lá).
- **Intensidade**: ambientação forte. Ornamentos e texturas só nas telas de vitrine
  (perfil, leaderboard, auth); telas de uso diário (dashboard, tarefas) ficam limpas,
  só com paleta e hierarquia.
- **Paleta**: "Gelo e ferro" — fiorde à noite, inverno nórdico.
- **Tipografia**: títulos em Cinzel (next/font). Corpo continua Geist Sans; números
  de XP/nível continuam Geist Mono (decisão anterior do CLAUDE.md, mantida).
- **Estratégia**: tokens primeiro. Componentes shadcn intactos; tudo entra via
  variáveis CSS no globals.css + utilitários temáticos + passe tela a tela.
- **Sem renomear features** (leaderboard continua leaderboard etc.).
- **Dark é o tema único**: valores no `:root`, bloco `.dark` removido, sem toggle.

## Paleta

| Papel               | Valor     | Uso                                          |
| ------------------- | --------- | -------------------------------------------- |
| Fundo               | `#0d1117` | background                                   |
| Superfície          | `#161c26` | card, popover (popover um passo mais claro)  |
| Acento primário     | `#7fb4d9` | primary: botões, links, foco, item ativo     |
| Secundário          | `#9aa7b8` | muted-foreground, prata fosca                |
| Ouro (token novo)   | `#c9a86a` | `--gold`: EXCLUSIVO para XP/nível/recompensa |
| Perigo              | `#b34a4a` | destructive, vermelho seco                   |

Regras da paleta:

- Ouro só aparece quando há recompensa envolvida — é o que o mantém especial.
- Profundidade por sombra preta suave e contraste de borda. Nenhuma sombra colorida.
- `--radius`: 0.625rem → 0.25rem (cantos angulares, menos "bolha SaaS").
- Contraste texto/fundo validado em WCAG AA.

## Utilitários temáticos (CSS puro, sem assets externos — compatível com CSP)

- `texture-iron` — ruído sutil (SVG inline data-URI) + gradiente vertical.
- `frame-carved` — moldura com cantos reforçados via pseudo-elementos.
- `divider-rune` — divisor ornamental com losango central.

## Passe tela a tela

- **Auth**: card central com `frame-carved`, título "Guilda" em Cinzel.
- **Shell/nav**: ferro escuro; item ativo com borda azul-gelo à esquerda.
- **Dashboard/Tarefas**: só paleta. Badges de status: pendente=prata, em
  andamento=azul-gelo, aguardando=âmbar discreto, concluída=ouro, rejeitada=vermelho
  seco, cancelada=cinza. Prioridade/dificuldade como pips (▮▮▯).
- **Perfil**: nível grande em Cinzel, XP em mono ouro, barra de progresso estilo
  forja (trilho metálico, preenchimento ouro), card principal com `frame-carved` +
  `texture-iron`. Preparado para receber a skill tree.
- **Leaderboard**: pódio top 3 em ouro/prata/bronze, resto tabela limpa.
- **Members/erro/vazios**: herdam o tema.

## Arquivos afetados

- `src/app/globals.css` — tokens, utilitários (o grosso do trabalho)
- `src/app/layout.tsx` — Cinzel via next/font
- Páginas em `src/app/(app)/` e `src/app/(auth)/` — passe de classes
- `src/components/app-shell.tsx` — navegação
- `CLAUDE.md` — atualizar seção Design e UX (neon → viking sem brilho)

## Verificação

- `npm run build` (atenção: exit 134 transitório em OneDrive — rodar de novo)
- `node scripts/screenshots.mjs` com a org demo do seed para conferência visual
- Nenhuma lógica muda — E2E existentes continuam valendo
