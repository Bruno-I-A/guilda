# Padrão de UI da Guilda

Documento normativo. Quem escreve tela nova — pessoa ou agente — segue isto.

Existe porque a dívida de design deste projeto não veio de decisões ruins: veio
de cada feature nova **replicar o padrão da anterior** sem que houvesse um lugar
dizendo qual é o padrão. Em 57 commits a paleta crua saiu de 8 para 24 arquivos,
o cabeçalho de página foi redigitado 14 vezes e a mesma pílula de aba foi copiada
6 vezes. Nenhuma dessas foi uma escolha; todas foram o caminho de menor esforço
na ausência desta página.

Regra geral: **se você está prestes a copiar classes de outra tela, pare.** Ou já
existe o componente, ou é hora de criar um.

---

## 1. Tipografia

A escala mora no `@layer base` do `globals.css`. **O nível semântico já traz o
tamanho.** Heading não leva classe de tamanho no call site.

| Nível | Tamanho | Fonte | Papel |
| ----- | ------- | ----- | ----- |
| `h1` | 24px | Cinzel | Título da página. Um por tela. |
| `h2` | 18px | Cinzel | Título de seção. |
| `h3` | 15px | Geist | Subtítulo dentro de uma seção. |
| `h4`–`h6` | 11px | Geist Mono, maiúsculo | Micro-rótulo. |

```tsx
<h2>Suas missões</h2>              // certo
<h2 className="text-lg">…</h2>     // errado: o tamanho já vem do h2
<h2 className="hud-label">…</h2>   // errado: ver regra 1.1
```

`h3` é sans de propósito — Cinzel em 15px fica apertado e ilegível.

### 1.1 `.hud-label` é RÓTULO, nunca heading

Esta é a regra que mais foi violada, e o efeito era grave: `.hud-label` rebaixava
`<h2>` para 11px, deixando o **título de seção menor e com menos contraste que o
conteúdo de 14px que ele introduzia**. A hierarquia ficava invertida.

- Título de seção → `<h2>`.
- Etiqueta de um dado (`span`, `legend`, `p`) → `.hud-label`.

```tsx
<p className="hud-label">Organização</p>   // certo: etiqueta um dado
<p className="text-sm font-medium">{orgName}</p>
```

### 1.2 Tamanhos permitidos

`text-xs` (12px) e acima, mais o degrau HUD de 11px via `.hud-label` ou o token
`--text-hud`. **Nada abaixo disso.** `text-[8px]`, `text-[9px]`, `text-[10px]` e
`text-[11px]` avulsos estão proibidos — a diferença entre eles é imperceptível e
só existia porque não havia token.

### 1.3 Números

Numeral que o usuário compara ou soma vai em `font-mono`. Se ele vive numa
coluna (ranking, valores empilhados), acrescente `tabular-nums` — sem isso a
coluna treme entre linhas.

### 1.4 Medida de leitura

Texto corrido leva `max-w-prose`. A coluna de conteúdo é `max-w-5xl` (1024px), e
14px atravessando isso dá ~150 caracteres por linha, o dobro do legível.

---

## 2. Cor

Só tokens. **Nenhuma cor crua do Tailwind em `.tsx`.**

| Token | Papel | Nunca use para |
| ----- | ----- | -------------- |
| `--primary` | Ação, link, foco, item ativo | — |
| `--gold` | **Exclusivo de recompensa**: XP, nível, prêmio | Decoração, destaque, alerta |
| `--silver` | Prata fosca, dado neutro | — |
| `--success` | "Deu certo", concluído, em dia | — |
| `--warning` | "Atenção", pendente, vence hoje | Qualquer coisa que sugira prêmio |
| `--destructive` | Erro, atraso, ação irreversível | — |
| `--telegram` | Cor de marca do Telegram | Qualquer outra coisa |

`--warning` é cobre **saturado** (chroma 0.14) enquanto `--gold` é fosco (0.08).
A saturação é deliberada: é ela que impede o usuário de confundir "atenção" com
"prêmio". Se você escolher um amarelo novo em vez do token, quebra isso.

Proibido: `bg-emerald-400/10`, `text-amber-300`, `rgba(...)`, `#hex` em `.tsx`.
Use `bg-success/10`, `text-warning`, `color-mix(in oklab, var(--success) 80%, transparent)`.

Cor **categórica** (distinguir tipos, não estados) é a única exceção viva hoje —
`company-flow-board.tsx` usa `sky` e `violet` para tipos de fluxo. Se precisar de
mais categorias, crie tokens `--category-*` em vez de espalhar paleta crua.

Sem glow, sem neon, sem sombra colorida. Profundidade vem de elevação escura e
borda.

---

## 3. Componentes de chrome

Não redigite nenhum destes. Se o que você precisa não cabe, **estenda o
componente** — não copie as classes.

### `<PageHeader>`

Todo cabeçalho de página. Cobre os seis formatos que existiam soltos: título só,
título + descrição, título + ação, título com ícone, título com badge, e título
com link de volta.

```tsx
<PageHeader
  title="Missões"
  description="Tudo que é seu e o que aguarda a sua aprovação."
  action={<Button asChild><Link href="/tasks/new">Nova missão</Link></Button>}
/>
```

### `<SegmentedNav>`

Toda navegação segmentada por URL: abas, período, filtro de regime. É Server
Component porque navegar ali é trocar URL, não estado de cliente.

O estado ativo é **trilho sublinhado em `--primary`** — mesmo vocabulário do item
ativo da sidebar. A pílula `bg-background shadow-sm` está proibida: era o
artefato mais genérico do app, numa interface cuja tese é placa de ferro
chanfrada.

Passe `busy` quando a navegação for round-trip de servidor.

### `<MissionRow>`

Toda linha de missão, em qualquer rota. Traz o trilho de status e o `chip-loot`
de XP — os dois melhores sinais de triagem do app. Já houve uma versão paralela
sem eles na aba do clã, e o resultado foi que **a única tela cuja finalidade é
triagem era a que não mostrava os sinais de triagem**.

Dentro de um painel maior (o pacote de um Informativo em `/tasks`), passe
`frame="flat"`: a linha perde o chanfro próprio e fica só com trilho e hover —
chanfro dentro de chanfro vira ruído. `href` aceita o destino com `returnTo`,
para a pessoa voltar ao mesmo recorte de onde saiu.

### `<ClanTabNav>` e `<ClanSectionHeading>`

A navegação do clã vem em **dois grupos de placas**: o *Espaço da área*
(Fluxo no Societário, Carteira/MEI/Parcelamentos/Honorários no Fiscal,
Fechamentos/Distribuição na Contabilidade) e a *Mesa do clã* (Missões,
Integrantes, Campanhas, iguais em todo clã). Cada placa tem o mesmo ícone
do atalho correspondente no dashboard. O grupo da área vem primeiro e com
moldura em `--primary`: é onde vive o trabalho específico do clã, e antes
ele ficava perdido no fim de uma fileira de sete rótulos.

`ClanSectionHeading` é um `<h2>` de verdade com `count` opcional — a versão
antiga rebaixava o título a `.hud-label`, e a seção ficava menor que as
linhas que introduzia (a violação mais comum da regra 1.1, e o motivo
concreto de "visibilidade ruim" dentro do clã).

### Esteira do Fluxo Societário

O Fluxo é uma esteira de quatro etapas (Recebido → Em processamento →
Informativo → Encerrados). O topo da aba mostra as quatro com a contagem de
pedidos em cada uma — é mapa e filtro ao mesmo tempo — e cada linha traz o
`FlowStageTracker` (quatro segmentos, o atual aceso) e um botão com o
**próximo passo** ("Assumir processamento", "Confirmar conclusão", "Preparar
Informativo") em vez de um "Abrir" genérico. As ações continuam dentro do
painel do Fluxo; só o rótulo diz o que vai acontecer. Situação é estado,
não categoria: usa `--silver`/`--primary`/`--warning`/`--success`, nunca
sky/violet.

### Seções da lista de missões

`MissionSection`, `MissionEmpty` e `ClosedMissions` (em
`src/app/(app)/tasks/mission-sections.tsx`) são o título de seção com
contagem, o vazio explicado e o bloco dobrado das encerradas. Título é `<h2>`
de verdade; a contagem em mono ao lado é o dado. Encerradas ficam dobradas
porque são histórico, não trabalho.

---

## 4. Superfície e forma

`--radius` é `0.25rem`. Todo `rounded-*` do shadcn colapsa em canto quase reto a
partir desse token — é assim que os primitivos ficam angulares sem fork.

### `.panel-cut`

Painel chanfrado a 45°. É a forma-assinatura do tema.

Sobre `<Card>`, a receita completa é `panel-cut rounded-none border-0 ring-0`. O
`ring-0` importa: o `Card` traz `ring-1 ring-foreground/10`, e um anel
**retangular** sobrevive ao chanfro, deixando tocos de fio exatamente nos cantos
que o chanfro existia para remover.

Prefira `<section className="panel-cut">` a `<Card className="panel-cut …">` — o
Card ainda traz `overflow-hidden`, que clipa uma segunda vez à toa.

### `.divider-rune`

Divisor com losango central. O entalhe precisa ser da cor da superfície **atrás**
dele: sobre um card, passe `[--rune-notch:var(--card)]`.

### Ornamento

`texture-iron` e ornamento pesado vivem no dashboard, no perfil, no leaderboard,
na auth e no formulário de missão. Isto **inverte** a regra original do spec de
2026-07-06, e a inversão é deliberada: o dashboard virou a vitrine na prática.

---

## 5. Estados e feedback

### Carregamento

Toda rota que roda query antes do primeiro paint precisa de `loading.tsx` com
`Skeleton` **na forma do conteúdo real** — não um spinner genérico.

O alvo é celular em rede móvel. Tocar e não ver reação é o modo de falha
canônico: o usuário toca de novo. Navegação segmentada que faz round-trip passa
`busy` para o `SegmentedNav`.

### Vazio

Estado vazio diz **por que** está vazio e oferece a saída certa. Se o vazio veio
de filtro, a ação é *limpar o filtro* — não "criar novo". Oferecer criação a quem
filtrou demais é mandar a pessoa para o lugar errado.

### Erro e rejeição

Momento de perda precisa da mesma atenção que momento de sucesso. O diálogo de
exclusão permanente é o modelo: enumera o dano concreto antes de agir, e
tranquiliza sobre o que **não** se perde ("XP já creditado é preservado").
Devolver uma missão é o evento mais desmoralizante de um sistema gamificado —
merece próximo passo explícito, não uma caixa de alerta padrão.

---

## 6. Toque e acessibilidade

- Alvo tocável mínimo de 44px. O tema é denso, então use `.touch-target`: dá a
  área sem inchar o visual. **Obrigatório** em ação destrutiva e em qualquer
  botão de ícone dentro de linha de lista.
- Heading é estrutura, não decoração. Não pule nível para conseguir um tamanho —
  o tamanho vem do nível.
- Toda tela tem `<h1>`. Isso inclui auth e onboarding.
- Foco visível sempre. Dentro de `.panel-cut` o anel é desenhado **por dentro**,
  porque o `clip-path` cisalha qualquer outline externo.
- Ação que muda região sem recarregar precisa de `aria-live` ou `aria-busy`.

---

## 7. Antes de abrir PR

- [ ] Nenhuma cor crua do Tailwind nova em `.tsx`
- [ ] Nenhum heading com classe de tamanho
- [ ] Nenhum `.hud-label` em heading
- [ ] Nenhum tamanho de texto abaixo de `text-xs`
- [ ] Cabeçalho via `<PageHeader>`, abas via `<SegmentedNav>`, missão via `<MissionRow>`
- [ ] Rota nova com query tem `loading.tsx`
- [ ] Alvo destrutivo com `.touch-target`
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`

Varreduras rápidas:

```bash
grep -rnE "(text|bg|border|ring)-(red|amber|emerald|green|yellow|sky|violet)-[0-9]" src --include=*.tsx
```

```bash
grep -rnE "<h[1-6][^>]*className=\"[^\"]*text-(xs|sm|base|lg|xl|2xl)" src --include=*.tsx
```

---

## Histórico

O tema "Gelo e Ferro" e suas decisões fechadas estão em
`docs/superpowers/specs/2026-07-06-viking-theme-design.md`, com adendos datados.
Este documento é a forma operacional daquelas decisões: o spec diz *o que foi
decidido e por quê*, esta página diz *como aplicar*.
