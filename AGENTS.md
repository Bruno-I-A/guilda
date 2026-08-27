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
