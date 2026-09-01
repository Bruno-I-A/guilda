# Política de segurança

## Relatando uma vulnerabilidade

Não abra uma issue pública com detalhes exploráveis, dados, credenciais ou
capturas da produção. Use o recurso **Report a vulnerability** na aba Security
do repositório GitHub.

Inclua, quando possível:

- área afetada e impacto esperado;
- passos mínimos para reprodução com dados fictícios;
- versão ou commit analisado;
- sugestão de mitigação, se houver.

## Escopo prioritário

- quebra de isolamento entre organizações;
- falhas de autorização ou autenticação;
- exposição de credenciais, tokens ou dados de clientes;
- injeção em banco, conteúdo ou comandos;
- alteração indevida de missões, XP ou trilhas de auditoria;
- acesso ao ambiente ou banco de produção.

## Tratamento de dados

O repositório público contém somente código, exemplos e dados fictícios. Não
envie dados reais de clientes em issues, Pull Requests, logs ou casos de teste.

