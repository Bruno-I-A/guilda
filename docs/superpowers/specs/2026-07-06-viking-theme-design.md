# Tema visual "Gelo e Ferro" — design aprovado

Data: 2026-07-06. Aprovado em conversa. Escopo: tema viking dark aplicado às telas
existentes. A skill tree do perfil fica para uma rodada dedicada, em cima deste tema.

> **Adendo (mesma data, após review do usuário):** a primeira entrega foi rejeitada
> por parecer "SaaS recolorido". O passe épico/funcional substituiu `frame-carved`
> por **`panel-cut`** (cantos chanfrados via clip-path), adicionou os componentes
> `LevelEmblem`, `XpBar` (segmentada, valor interno) e `Pips`, os utilitários
> `hud-label` e `chip-loot`, vinheta + tramado nórdico no body, primary mais
> profundo (0.66) e a hierarquia Cinzel-display vs mono-HUD. O dashboard virou
> "mesa de guerra" (aprovações pendentes + tarefas por prazo). A regra segue:
> Cinzel só em display, ouro só em recompensa, sem glow.

> **Adendo 2 (2026-08-26) — a regra de intensidade envelheceu; o código está certo.**
> A seção "Decisões" abaixo manda ornamento e textura só nas telas de vitrine
> (perfil, leaderboard, auth) e telas de uso diário "limpas". Na prática o
> **dashboard virou a vitrine** — é onde vivem o `LevelEmblem`, a `XpBar` e o
> banner `panel-cut texture-iron` — e isso foi deliberado, não deriva. A auditoria
> de 2026-08-26 sinalizou a divergência como decaimento do spec; a decisão do
> usuário foi **manter o código e corrigir o spec**. `texture-iron` FICA no
> dashboard e no formulário de missão. Sem este registro, a próxima auditoria
> reabre a discussão.
>
> **Adendo 3 (2026-08-26) — o corpo do app nunca renderizou na fonte pretendida.**
> `globals.css` declarava `--font-sans: var(--font-sans)` (auto-referência) desde
> o commit da Fase 1. Por spec CSS a propriedade circular vira guaranteed-invalid,
> então `html { font-sans }` caía no fallback do navegador: o app inteiro rodou em
> **Times New Roman**, enquanto os arquivos da Geist eram baixados e ignorados.
> Corrigido para `var(--font-geist-sans)`. Consequência: todo julgamento de
> tamanho abaixo de heading tinha sido calibrado contra a métrica de um serif que
> ninguém pretendia usar — daí a re-derivação da escala no adendo seguinte.
>
> **Adendo 4 (2026-08-26) — escala display de quatro passos.**
> A linha "títulos em Cinzel" era ampla demais e produziu hierarquia invertida:
> `.hud-label` (11px mono) era aplicado a `<h2>` em seis seções, deixando o título
> MENOR e com menos contraste que o corpo de 14px abaixo dele; e `<h3>`–`<h6>`
> não tinham tema nenhum. A escala agora vive no `@layer base` do `globals.css`:
>
> | Nível | Face | Tamanho | Papel |
> | ----- | ---- | ------- | ----- |
> | `h1`  | Cinzel | 24px | título de página |
> | `h2`  | Cinzel | 18px | título de seção |
> | `h3`  | Geist  | 15px | subtítulo dentro da seção |
> | `h4`+ | mono   | 11px | micro-rótulo |
>
> `h3` é **sans de propósito**: Cinzel neste tamanho fica apertado e ilegível —
> "títulos em Cinzel" vale para os dois passos de display, não para todo heading.
> Regra que fecha o buraco: **`.hud-label` é RÓTULO, não heading.** Título de
> seção é `<h2>`; etiqueta de dado (span/legend/p) é `.hud-label`. O degrau de
> 11px virou token de escala (`--text-hud` + `--tracking-hud`) para acabar com os
> `text-[8px]`/`text-[9px]`/`text-[10px]`/`text-[11px]` escritos na mão.
>
> **Adendo 5 (2026-08-26) — sucesso e alerta ganharam token.**
> A paleta nunca definiu papel para "deu certo" e "atenção", e o código preencheu
> a lacuna com `amber`/`emerald`/`red` crus do Tailwind em 22 lugares. Agora há
> `--success` (verde-gelo, fica na família fria) e `--warning` (cobre **saturado**
> de propósito: o ouro é fosco e exclusivo de recompensa, e a saturação alta é o
> que impede confundir "atenção" com "prêmio"). `--telegram` nomeia a cor de marca
> externa que estava solta como `#2AABEE`.

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
- ~~`frame-carved`~~ — **NÃO EXISTE MAIS.** Substituído por `panel-cut` no
  Adendo 1. Ficaram dois call sites órfãos citando a classe morta (o card de
  alterar senha e uma caixa em `member-actions`), corrigidos em 2026-08-26.
  Toda menção a `frame-carved` abaixo deve ser lida como `panel-cut`.
- `panel-cut` — painel de cantos chanfrados em 45° via `clip-path`. Sobre um
  `<Card>` a receita é `panel-cut rounded-none border-0 ring-0` (o `ring-0` é
  obrigatório: o Card traz `ring-1` e o anel retangular sobrevivia ao chanfro).
- `divider-rune` — divisor ornamental com losango central. Sobre superfície de
  card, passe `[--rune-notch:var(--card)]` — o entalhe precisa ser da cor de
  trás, e antes ele era sempre `--background` e funcionava por sorte.
- `hud-label` — micro-rótulo mono maiúsculo. **Rótulo, nunca heading.**
- `chip-loot` — a recompensa de XP como item de inventário chanfrado.
- `touch-target` — área tocável de 44px sem alterar o tamanho visual do
  controle. Para ação destrutiva e botão de ícone dentro de linha de lista.

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
