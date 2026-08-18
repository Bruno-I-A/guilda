# Consulta de CNPJ no fluxo "Novo cliente" dos Informativos: design aprovado

Data: 2026-08-18. Decisões tomadas em diálogo com o usuário (registradas
abaixo com a razão de cada escolha).

## Problema

O painel de Informativos (`/informativos`) hoje tem uma única caixa de texto:
a pessoa cola o informativo inteiro, a IA extrai empresa + missões, tudo num
passo só. Isso funciona bem para "Novo Cliente" quando o texto já traz razão
social, CNPJ e regime — mas exige que quem cola o texto tenha esses dados à
mão e digite certo. A ideia: para o caso específico de cadastrar empresa nova,
perguntar o CNPJ primeiro e buscar razão social, atividades (CNAE) e data de
abertura na Receita, eliminando a digitação manual desses campos.

Telegram não faz parte deste escopo (decisão do usuário: "não é mais muito
importante") — o bot mantém o pipeline atual sem mudanças.

## Decisões

- **Fluxo em 2 passos, só para "Novo Cliente"**, atrás de um botão dedicado
  "Novo cliente" ao lado da caixa de texto atual (que continua exatamente como
  hoje para alteração/baixa/missão geral — a IA continua decidindo o `kind`
  nesses casos). Passo 1: CNPJ → busca → confere/edita razão social, atividade
  principal, atividades secundárias, data de abertura e regime tributário.
  Passo 2: textarea livre só para "o que precisa ser feito" (sem repetir dados
  da empresa) → mesma tela de prévia/confirmação que já existe hoje.
- **Fonte de dados: BrasilAPI** (`GET brasilapi.com.br/api/cnpj/v1/{cnpj}`) —
  gratuita, sem chave, dados já agregados da Receita incluindo opção pelo
  Simples Nacional. Sem trade-off relevante frente a alternativas (Minha
  Receita só compensaria para consulta em lote; aqui é uma empresa por vez).
- **A busca roda em Server Action**, nunca direto do navegador — mantém a
  validação/normalização de CNPJ (`domain/cnpj.ts`) e a autorização
  (`canHandleInformatives`) no servidor, e não expõe a integração no bundle.
- **Atividades: principal + secundárias**, persistidas (não é só contexto
  efêmero de tela). Justifica campo `jsonb` em vez de texto único.
- **Regime tributário**: pré-preenchido só quando a Receita confirma opção
  pelo Simples (`opcao_pelo_simples: true` → sugere `simples`, editável). Fora
  disso o campo fica em branco — a Receita não distingue Presumido de Real
  quando a empresa não é optante, então a escolha continua humana, como hoje.
- **Nada bloqueia a pessoa**: CNPJ não encontrado, erro de rede/timeout da
  BrasilAPI, ou empresa BAIXADA/INATIVA/SUSPENSA na Receita — em todos os
  casos a tela mostra o problema mas deixa preencher os campos manualmente e
  seguir. A consulta é sempre atalho, nunca porta trancada.
- **Cliente só é criado na confirmação final do informativo** — igual ao
  fluxo atual (nada é criado antes de confirmar). O passo 1 só preenche
  estado local da tela; se a pessoa abandonar no meio, nada fica órfão no
  banco.
- **A extração de missões por IA não muda.** Em vez de ensinar o prompt a
  ignorar dados de empresa quando eles já são conhecidos, o código
  (`buildInformativeDraft`) passa a aceitar uma empresa já resolvida e
  **substitui** os campos de empresa que a IA tentaria adivinhar pelos dados
  reais — a extração de tarefas continua rodando do jeito que já roda hoje.
  Minimiza a superfície de mudança no pipeline de IA.
- **Fora de escopo**: formulário manual de `/clients` (o "+ novo cliente" de
  lá continua sem CNAE/data de abertura — só o caminho via informativo ganha
  os campos novos); qualquer mudança no bot do Telegram; busca em lote.

## Componentes

1. **Schema** (`src/db/schema/domain.ts` + migration): 4 colunas novas em
   `clients`, todas nullable (não quebram cadastro manual nem import CSV
   existente):
   - `cnae_code` varchar(10), `cnae_description` varchar(200) — atividade
     principal.
   - `secondary_cnaes` jsonb (`{ code, description }[]`) — atividades
     secundárias.
   - `opened_at` date (`{ mode: "string" }`, mesmo padrão de `due_date`) —
     data de abertura.
   Sem mudança de RLS/privilégios: `clients` já tem policy `org_isolation` e
   grants completos para `guilda_app`.

2. **Integração externa** (`src/lib/cnpj-lookup.ts`): função pura de mapeamento
   `mapBrasilApiResponse` (JSON bruto → `{ legalName, cnaeCode,
   cnaeDescription, secondaryCnaes, openedAt, isSimplesOptant,
   cadastralSituation }`, testável sem rede) + função de I/O `lookupCnpj(cnpj)`
   que faz o fetch com timeout (`AbortController`, 8s) e distingue 404 (não
   encontrado) de erro de rede/servidor de um 200 válido.

3. **Server Action** `lookupClientCnpj` (`src/app/(app)/informativos/actions.ts`):
   mesma porta (`requireInformativeActor`) das demais actions do módulo;
   normaliza/valida o CNPJ com `domain/cnpj.ts` antes de chamar
   `lookupCnpj`; nunca deixa vazar erro técnico — sempre `ActionResult` com
   mensagem em português.

4. **`buildInformativeDraft`** (`src/lib/informatives/draft.ts`) ganha um
   parâmetro opcional `resolvedCompany`. Quando presente:
   - `kind` fixado em `"new_client"`, `sourceFormat` fixado em `"informative"`
     (pula a heurística `isDetailedInformativeMessage`, que não faz sentido
     quando o texto do passo 2 não contém dados de empresa).
   - `"company"` nunca entra em `missingFields` (nem o que a IA reportar, nem
     a checagem manual) — a IA não tem como encontrar uma empresa que não foi
     mencionada no texto, e tudo bem, ela já é conhecida.
   - `legalName`/`normalizedCnpj`/`taxRegime` vêm de `resolvedCompany`, não da
     extração; `cnaeCode`/`cnaeDescription`/`secondaryCnaes`/`openedAt` idem.
   - Continua checando `clients` pelo CNPJ normalizado para não duplicar
     cadastro (mesma lógica de hoje, só que com CNPJ garantido em vez de
     opcional).

5. **`informativeDraftPayloadSchema`** (`src/lib/ai/informative-schema.ts`):
   `company` ganha `cnaeCode`, `cnaeDescription`, `secondaryCnaes`,
   `openedAt` — nullable, `null` no caminho de texto livre (compatível com
   prévias antigas já persistidas).

6. **`confirmInformative`** (`src/lib/informatives/confirm.ts`): o `INSERT` em
   `clients` passa a incluir os 4 campos novos quando presentes no payload.

7. **UI**: novo componente `new-client-wizard.tsx` ao lado de
   `informative-panel.tsx` (mantém o arquivo atual sem inchar). Botão "Novo
   cliente" abre o passo 1 (campo CNPJ + "Buscar", depois campos
   confirmáveis); "Próximo" exige nome + regime preenchidos; passo 2 é a
   textarea livre + "Analisar", que chama uma variante de `analyzeInformative`
   levando `resolvedCompany`. Dali em diante reusa a tela de prévia/confirmação
   que já existe, sem mudanças.

## Verificação

Vitest: `mapBrasilApiResponse` (campos completos, sem atividades secundárias,
`opcao_pelo_simples` nulo/false/true, situação baixada) e o novo ramo de
`buildInformativeDraft` com `resolvedCompany` (kind forçado, company nunca
some em missingFields, dedup por CNPJ existente). `tsc`/lint limpos. Teste
manual no navegador contra o BrasilAPI de verdade: CNPJ ativo real,
CNPJ inexistente, e o fallback manual quando a busca falha.
