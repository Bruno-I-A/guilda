<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Padrão de UI

Antes de escrever ou alterar qualquer tela, leia `docs/design-system.md`. É
normativo e tem checklist de PR no fim: escala tipográfica (heading não leva
classe de tamanho), tokens de cor (nenhuma cor crua do Tailwind em `.tsx`), e os
componentes de chrome que já existem — `PageHeader`, `SegmentedNav`,
`MissionRow`. Se você está prestes a copiar classes de outra tela, pare: ou o
componente já existe, ou é hora de criar um.

# Ambientes

`main` é produção, `develop` é homologação, e **a homologação existe e está em
uso desde 02/09/2026**. Todo trabalho vai para a `develop`; produção só recebe
via Pull Request `develop` → `main` e deploy manual na action.

Antes de mexer em variável de ambiente, migration, Telegram ou qualquer coisa de
infraestrutura, **leia `docs/environments.md`**. Ele tem a seção "Armadilhas já
pagas", com cinco erros que já custaram tempo neste projeto e como detectar cada
um. Todos são silenciosos: o sistema continua funcionando na tela.

Duas que valem repetir aqui, porque são as mais caras:

- A aplicação **precisa** conectar como o role `guilda_app` (não-superuser). Com
  o usuário dono, o RLS deixa de conter as queries e o isolamento entre
  organizações desaparece sem nenhum sinal.
- Migration nova: confira onde sua branch está antes de `db:generate`, e
  verifique o efeito no catálogo do Postgres depois de `db:migrate`. Neste
  projeto o `drizzle-kit` já reportou "sem mudanças" havendo mudança, e o
  `migrate` já respondeu "applied successfully" sem aplicar nada.

# Memória compartilhada

Decisões, armadilhas e padrões que atravessam sessões ficam no vault Obsidian em
`C:\Users\bruno\OneDrive\Área de Trabalho\Claude\Cerebro`, escrito por Claude e
Codex. Comece por `🗺️ Índice.md` e leia `🧠 Protocolo dos Agentes.md` antes da
primeira escrita. O que não dá para reconstruir lendo o código mora lá — e o que
o código já conta sozinho não deve ser duplicado nele.
