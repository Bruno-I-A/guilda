# Clãs e missões — plano de implantação

## Decisões confirmadas

- A Guilda possui inicialmente os clãs Fiscal, Contabilidade, RH, Societário e Financeiro.
- Uma pessoa pode participar de mais de um clã, com no máximo um vínculo principal por Guilda.
- Todo clã ativo deve conservar pelo menos um líder. Na migração, owners são líderes iniciais dos cinco clãs; a administração pode redistribuir a liderança depois.
- Uma missão individual recebe somente a pessoa na interface. O servidor infere o clã principal dela; se houver apenas um vínculo, ele é aceito como fallback. A criação falha com orientação clara quando não há um clã determinável.
- Uma missão coletiva recebe um clã e fica sem responsável até ser assumida ou atribuída.
- A pessoa responsável conclui sua missão diretamente, sem aprovação. Estados antigos de aprovação continuam legíveis e operáveis para compatibilidade.
- O motivo de uma transferência é opcional, mas toda transferência é auditada com ator, origem, destino e data.

## Autorização operacional

| Operação | Membro | Líder do clã | Admin/owner |
| --- | --- | --- | --- |
| Ver missões da Guilda | sim | sim | sim |
| Assumir missão sem responsável do seu clã | sim | sim | sim |
| Concluir missão pela qual é responsável | sim | sim | sim |
| Transferir a própria missão dentro do clã | sim | sim | sim |
| Transferir qualquer missão do clã dentro dele | não | sim | sim |
| Transferir entre clãs | não | não | sim |
| Gerenciar membros/líderes de clã | não | não | sim |

Transferências são permitidas apenas em `pending`, `in_progress` e `rejected`. Missões concluídas, canceladas ou no estado legado de aprovação não mudam de responsável. O novo responsável precisa ser membro ativo do clã de destino.

## Dados e migração

1. Criar `clans`, `clan_memberships` e `task_transfers`, sempre com `org_id`, RLS e filtros explícitos por tenant.
2. Tornar `tasks.assignee_id` anulável e adicionar `tasks.clan_id`. Uma tarefa conserva pelo menos um destino: pessoa legada ou clã.
3. Criar os cinco clãs para cada organização e vincular owners como líderes iniciais. Não classificar silenciosamente os demais membros.
4. Preencher `tasks.clan_id` a partir de vínculos principais existentes quando possível. Missões antigas sem inferência continuam visíveis como legado; toda missão nova usa um clã validado.
5. Preservar `xp_ledger`: o crédito continua idempotente e é concedido ao responsável no instante da conclusão. Missão sem responsável não pode iniciar ou concluir.

## Fluxos verticais

### Missão individual

`selecionar pessoa → inferir clã no servidor → pending → iniciar → concluir + XP`

### Missão do clã

`selecionar clã → pending sem pessoa → membro assume/líder atribui → iniciar → concluir + XP`

### Transferência

`lock da missão → validar estado/permissão/membership → atualizar destino → gravar task_transfers → notificar novo responsável`

## Superfícies afetadas

- Gestão e visão de clãs, membros, líderes e carga aberta.
- Criação de missão com destino pessoa ou clã.
- Lista com escopos minhas, meus clãs, clã específico, pessoa, criadas por mim e toda a Guilda.
- Detalhe com assumir, transferir, concluir e histórico de transferências.
- Dashboard, fechamentos, Telegram/IA, resumos e notificações.
- Seed, testes de domínio, multi-tenant/RLS, lint e build.

## Critérios de aceite

- Toda mutação autentica o ator, valida a organização e executa sob `withOrgTx`.
- Um UUID de outro tenant não pode ser usado para vincular clã, pessoa, missão ou transferência.
- Duas pessoas tentando assumir a mesma missão são serializadas por lock; apenas uma vence.
- Não é possível remover o último líder de clã ativo.
- Conclusão direta credita XP uma única vez e sincroniza fechamentos na mesma transação.
- Filtros e telas tratam `assignee_id` nulo sem erro.
- Testes, lint e build passam após a migração.
