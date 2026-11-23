# Áudio no Atendimento

Data: 23/11/2026 · pedido do Bruno ("reconhecer e mandar áudio") · decisões
tomadas na conversa antes deste texto.

## Decisões do Bruno

- **Transcrição pela OpenAI, como no Scharff** (`gpt-4o-mini-transcribe`, com o
  vocabulário contábil no prompt). A Guilda passa a precisar de
  `OPENAI_API_KEY` no serviço de atendimento; sem ela, o áudio só se ouve.
- **Todos os áudios recebidos são transcritos**, não só os do teste do agente.
  Consequência aceita: a voz de todo cliente vai à OpenAI antes de existir o aviso
  de privacidade, que passa a precisar citar isso.
- **Mandar áudio gravando na conversa**: o navegador grava, o servidor converte
  para OGG/Opus (o formato de nota de voz do WhatsApp) com ffmpeg e envia.

## Entrega 1: receber

- **Ouvir**: o áudio recebido aparece com um player na conversa, pela rota de
  mídia da foto e do documento (mesma régua de quem vê a conversa). Só tipos
  `audio/*`, até 16 MB (o limite do WhatsApp), servidos como áudio.
- **Transcrever**: `support_message_transcriptions` (uma linha por mensagem de
  áudio; estados pendente, processando, pronto, falhou, indisponível). O
  `support-worker` ganha um passo que baixa o áudio da Meta e manda à OpenAI. A
  linha é a trava contra transcrever duas vezes; falha tenta de novo até 3 vezes;
  formato que a OpenAI não lê (AMR) vira indisponível.
- **O texto na conversa**: embaixo do player, com "Transcrevendo…" ou "Não foi
  possível transcrever" enquanto não há texto.
- **A IA lê o texto**: o turno leva "Áudio (transcrição): …", mascarado como o
  resto. A leitura (sombra e teste do agente) espera a transcrição dos áudios do
  turno terminar, no máximo 10 minutos; depois disso segue com o rótulo.

## Entrega 2: mandar

Botão de microfone ao lado do Enviar, gravação no navegador, upload para a
Guilda, conversão para OGG/Opus com ffmpeg, upload da mídia à Meta e envio como
nota de voz, pela mesma fila de saída das mensagens (só dentro das 24 horas).

Feito assim (23/11/2026):

- **Ordem da rota** (`/api/atendimento/conversations/[id]/audio`): confere a
  régua da resposta (quem assumiu, canal ativo, 24 horas) antes de converter;
  converte; sobe à Meta; só então grava mensagem, evento e saída na mesma
  transação, revalidando a régua. Se a Meta recusar o upload, nada é gravado e o
  áudio continua no navegador para tentar de novo.
- **Sem envio em dobro**: a chave da gravação é a mesma em toda tentativa; a
  conferência inicial responde "já enviado" e a rota nem converte de novo.
- **Formato**: o navegador grava WebM/Opus (Chrome, Edge), OGG/Opus (Firefox) ou
  MP4 (Safari); o ffmpeg converte para OGG/Opus mono 48 kHz a 32 kbps. A
  entrada vai por arquivo temporário (o MP4 precisa de leitura com saltos) e é
  apagada no fim. Até 10 MB de entrada; 30 s de conversão.
- **Limite de 5 minutos**: a gravação para sozinha e espera "Enviar áudio".
- **Erro do ffmpeg** vai para o log; a tela recebe só uma frase.
- **Microfone**: `Permissions-Policy: microphone=(self)`.
