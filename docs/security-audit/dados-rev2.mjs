/**
 * Revisão 2 do relatório — estado pós-remediação e validação ofensiva.
 * Mantido separado de `dados.mjs` (os achados originais) para o diff ficar
 * limpo. Consumido por `gerar-relatorio.mjs`.
 */

export const revisao = {
  versao: "2 — pós-remediação",
  data: "29 de agosto de 2026",
  nota:
    "Esta revisão registra a correção dos achados e um teste de intrusão ativo. " +
    "TODOS os 15 achados foram endereçados: 14 corrigidos e verificados e 1 " +
    "mitigado (o resíduo de farm de XP dentro da Contabilidade, aceito " +
    "conscientemente). Não há mais pendências — as baixas e informativas, antes " +
    "recomendação, também foram implementadas e verificadas nesta rodada.",
};

export const ESTADOS = {
  corrigido: { rotulo: "Corrigido", cor: "#059669" },
  mitigado: { rotulo: "Mitigado", cor: "#D97706" },
  pendente: { rotulo: "Pendente", cor: "#64748B" },
};

/** Estado de cada achado após a remediação. */
export const statusPorAchado = {
  F1: {
    estado: "corrigido",
    resumo:
      "Gate requireClosingManager/requireClosingActor nas 7 actions, espelhando requireDistributionManager: exige clã Contabilidade e papel, com clanId nos schemas Zod. Régua pura canManageClanClosings/canDeleteClanClosing em guild-permissions.ts, com testes.",
    verificado:
      "Pentest HTTP: member sem vínculo recebe “Apenas quem integra a Contabilidade…” e nada é gravado; owner segue conseguindo. Aba renderiza normalmente. tsc, lint, 510 testes e build passam.",
  },
  F2: {
    estado: "mitigado",
    resumo:
      "O gate do F1 remove o acesso de fora da Contabilidade e de outros tenants. A trava adicional de XP (limitar a faixa de anos ou creditar só pela missão) NÃO foi adicionada por decisão consciente: o farm de XP DENTRO da Contabilidade continua possível.",
    verificado:
      "Pentest: setYearClosed cross-clã/cross-tenant bloqueado, 0 XP creditado. O resíduo intra-clã é aceito; auditoria por closed_by_task_id separa o manual do legítimo. Reavaliar se o ranking degradar.",
  },
  F3: {
    estado: "corrigido",
    resumo:
      "mustChangePassword passou a input:false (rejeitado em /update-user); a flag só é desligada pelo servidor, como efeito de changeOwnPassword. requireMemberContext também exige a troca, cobrindo as Server Actions.",
    verificado:
      "Pentest: POST /update-user {mustChangePassword:false} → 400 “No fields to update”, flag permanece; Server Action com flag ligada → “Defina uma senha própria antes de continuar.”; troca legítima desliga a flag e a senha antiga passa a dar 401.",
  },
  F4: {
    estado: "corrigido",
    resumo:
      "Migration 0062 aplica FORCE ROW LEVEL SECURITY nas 12 tabelas do núcleo, alinhando ao padrão das demais 30.",
    verificado:
      "No banco: 42/42 tabelas com org_id agora enabled=true forced=true, zero pendências. Ataque como guilda_app na org do atacante contra linhas de outro tenant: 0 leituras e 0 escritas.",
  },
  F5: {
    estado: "corrigido",
    resumo:
      "check-rls.mjs deriva a lista de pg_class (toda tabela com coluna org_id) em vez de uma constante fixa, e exige relrowsecurity AND relforcerowsecurity. Tabela nova entra na checagem sozinha.",
    verificado:
      "npm run check:rls roda contra o banco e reporta as 42 tabelas; TODAS AS CHECAGENS PASSARAM, com provas de isolamento incluídas para tasks, xp_ledger e clients.",
  },
  F6: {
    estado: "corrigido",
    resumo:
      "O matcher do proxy passou a cobrir as 5 rotas que faltavam (clans, closings, informativos, mural, settings), e ganhou um comentário forte de que é OTIMIZAÇÃO, não a fronteira de segurança — endereçando o risco de manutenção. Evitou-se o catch-all negativo de propósito: ele redirecionaria os próprios ícones/manifest para /sign-in.",
    verificado:
      "tsc, lint e 527 testes passam; build compila o proxy. A proteção real continua no layout (requireOrgSession), já confirmada no pentest (sem sessão → 307).",
  },
  F7: {
    estado: "corrigido",
    resumo:
      "Seed aborta se NODE_ENV=production ou se a DATABASE_URL não for local (host parseado), com escape ALLOW_SEED=1; senha vem de SEED_PASSWORD. .dockerignore exclui seed.ts, screenshots.mjs, check-rls.mjs e generate-app-icons.mjs.",
    verificado:
      "Os três caminhos da trava exercitados: produção → bloqueado; URL remota → bloqueado; ALLOW_SEED=1 → segue. Seed contra o banco local funciona.",
  },
  F8: {
    estado: "corrigido",
    resumo:
      "A porta do Postgres de dev passou a ligar em 127.0.0.1:5432 — não fica mais exposta à rede. As credenciais triviais de dev seguem, mas atrás do loopback ninguém na rede as alcança.",
    verificado:
      "docker-compose.dev.yml aponta 127.0.0.1:5432:5432; a app conecta pelo localhost do host normalmente (fluxo de dev inalterado).",
  },
  F9: {
    estado: "corrigido",
    resumo:
      "Novo src/lib/env-guard.ts validado no boot por src/instrumentation.ts: recusa BETTER_AUTH_SECRET curto, placeholders (Dockerfile, better-auth, .env.example) e valores de baixa entropia. Em produção derruba o boot; fora dela só avisa; a fase de build é ignorada (NEXT_PHASE).",
    verificado:
      "Testes cobrem placeholders, entropia e o ramo lançar-vs-avisar. Build de produção não quebra (skip na fase de build); boot de produção com o placeholder do Dockerfile lança e não sobe.",
  },
  F10: {
    estado: "corrigido",
    resumo:
      "O mesmo env-guard valida FLOW_SECRETS_KEY: se definida, precisa decodificar para 32 bytes E ter entropia (recusa chave degenerada como tudo-zero). Vazia continua aceita (feature opcional).",
    verificado:
      "Testes: chave forte base64/hex passa, 'tudo zero' é recusada por entropia, vazia é aceita. Em produção uma chave fraca derruba o boot.",
  },
  F11: {
    estado: "corrigido",
    resumo:
      "A planilha com dados reais de clientes (CNPJ, honorários) foi APAGADA do repositório, e *.xlsx/*.xls/*.csv entraram no .gitignore para impedir um `git add .` acidental no futuro.",
    verificado:
      "git status limpo (arquivo removido); git check-ignore confirma a regra; histórico do Git seguia e segue sem nenhuma planilha.",
  },
  F12: {
    estado: "corrigido",
    resumo:
      "A CSP saiu do next.config (estática) e virou por-requisição no proxy: em produção o script-src usa nonce + 'strict-dynamic', SEM 'unsafe-inline'. Em dev a política é afrouxada para o HMR/overlay não quebrar. Os demais cabeçalhos (HSTS, nosniff, etc.) seguem estáticos para todas as rotas.",
    verificado:
      "Em `next start` (produção): o header de /sign-in traz script-src 'self' 'nonce-…' 'strict-dynamic' (nonce diferente a cada requisição, sem unsafe-inline). No navegador a página renderiza, hidrata e faz login (fetch do cliente) sob a CSP estrita, sem violações no console.",
  },
  F13: {
    estado: "corrigido",
    resumo:
      "A armadilha foi REMOVIDA: apagados a função escapeTelegramHtml, o tipo parseMode (endpoint.ts e types.ts) e o ramo condicional de parse_mode. Um comentário no lugar explica que as mensagens são texto puro e o que fazer se um dia alguém ligar HTML.",
    verificado:
      "Nada mais referencia parseMode/escapeTelegramHtml; tsc, lint e 527 testes passam. Mensagens do bot seguem como texto puro (comportamento inalterado).",
  },
  F14: {
    estado: "corrigido",
    resumo:
      "O destino do ?next= passou a ser resolvido contra uma origem sentinela e comparado por origem (padrão de returnToTasks), em vez de checagem textual.",
    verificado:
      "13 testes em safe-redirect.test.ts cobrindo os dois bypasses. Pentest: login com ?next=/\\example.com termina em /dashboard.",
  },
  F15: {
    estado: "corrigido",
    resumo:
      "O offboarding revoga a conexão do Telegram e invalida tokens pendentes; as duas rotas de envio ganharam INNER JOIN member — quem saiu para de receber.",
    verificado:
      "No banco: após remover o membro, a consulta antiga ainda alcançaria a conexão (1), a nova (com join) alcança 0.",
  },
};

/**
 * Correção editorial da 1ª rodada: o relatório descreveu a F4 como “o
 * isolamento sumiria nas 12 tabelas sem FORCE”. Medição no banco corrige.
 */
export const correcaoF4 = {
  titulo: "Correção sobre a F4 — o que FORCE realmente protege",
  corpo:
    "Medido no banco de dev, com app.org_id apontando para uma org inexistente: " +
    "como postgres (dono das tabelas E superuser) veem-se 42 missões; como " +
    "guilda_app (não-superuser), 0. FORCE ROW LEVEL SECURITY só alcança o dono " +
    "NÃO-superuser. Como aqui o dono é o postgres superuser, nem ENABLE nem FORCE " +
    "o contêm — num deploy com esse role, o isolamento sumiria nas 42 tabelas, não " +
    "só nas 12. A leitura correta: a proteção real é a aplicação conectar como " +
    "guilda_app; o RLS/FORCE é a segunda camada e só vale contra dono não-superuser " +
    "(o cenário de um Postgres gerenciado, que a migration 0062 passa a cobrir).",
};

export const pentest = {
  resumo:
    "Após as correções, rodou-se um teste de intrusão ativo assumindo o papel de " +
    "um invasor autenticado com o MENOR privilégio (um member sem vínculo de clã) " +
    "contra um tenant-vítima real, plantado com dados sensíveis rastreáveis — " +
    "incluindo uma senha Gov.br cifrada com o próprio código do projeto. Nenhuma " +
    "vulnerabilidade nova foi encontrada: as cinco classes de ataque foram contidas.",
  classes: [
    {
      nome: "IDOR / isolamento entre tenants",
      metodo:
        "Conexão como guilda_app (o exato role da aplicação) com app.org_id da org do atacante, atacando as linhas do outro tenant por ID — o mesmo que uma Server Action faz após autenticar. Prova determinística e mais forte que o teste HTTP: nenhuma action pode ir além do que este role alcança.",
      resultado: "BLOQUEADO",
      evidencia:
        "Cliente, fechamento, fluxo e a senha Gov.br do outro tenant: 0 leituras. UPDATE de nome, DELETE de fechamento e DELETE de cliente: 0 linhas afetadas.",
    },
    {
      nome: "Escalação de privilégio",
      metodo:
        "Como member, via HTTP (IDs de action extraídos do bundle, como um atacante faria): criar conta admin, virar líder de clã, auto-adicionar-se a um clã, criar clã.",
      resultado: "BLOQUEADO",
      evidencia:
        "Criar admin → “Apenas admin ou owner pode adicionar membros.” (0 contas criadas). Líder/adicionar/criar clã → “Apenas admin ou owner pode gerenciar a composição dos clãs.”",
    },
    {
      nome: "Injeção de XP / mass-assignment",
      metodo:
        "createTask injetando xpValue:999999, status:“completed”, orgId de outro tenant e creatorId falso no corpo.",
      resultado: "DERROTADO",
      evidencia:
        "Gravado: xp_value=120 (computado pelo servidor), status=pending, org= a da sessão, creator= o da sessão, 0 lançamentos no ledger. Zod descarta chaves desconhecidas; o servidor fixa o que é sensível.",
    },
    {
      nome: "Ciclo de vida da tarefa (auto-aprovação / roubo de XP)",
      metodo:
        "Responsável tenta auto-aprovar a própria tarefa de terceiro; outro member tenta concluir a tarefa alheia; member tenta reverter conclusão (só admin).",
      resultado: "BLOQUEADO",
      evidencia:
        "Auto-aprovação → “Apenas quem criou a missão ou um admin pode aprovar/rejeitar.”; concluir tarefa alheia → “Apenas a pessoa responsável pode concluir a missão.”; reversão por member → negada. 0 XP indevido.",
    },
    {
      nome: "Superfície anônima",
      metodo:
        "Webhook do Telegram sem/errado segredo; acesso a páginas de dados sem sessão.",
      resultado: "LIMPO",
      evidencia:
        "Webhook → 503 (inerte sem token). /clients, /settings, /clans/[id], /members sem cookie → 307 para /sign-in. Sem vazamento.",
    },
  ],
  nota_infra:
    "O ambiente de teste (dev server + Docker sobre OneDrive/Windows) caiu várias " +
    "vezes sob compile pesado — instabilidade de infraestrutura, não da aplicação. " +
    "Contornado rodando o servidor destacado e provando o isolamento pelo role real " +
    "guilda_app. As classes de lógica de app foram provadas por HTTP de verdade.",
};
