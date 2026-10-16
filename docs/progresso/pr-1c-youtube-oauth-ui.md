# PR-1C — UI OAuth YouTube

A tela de Integrações deixou de tratar o botão do YouTube como stub. `Preparar conexão` agora navega para o início OAuth server-side, a tela consulta apenas o status sanitizado do servidor e oferece desconexão/revogação idempotente.

A copy de escopos foi corrigida para `https://www.googleapis.com/auth/youtube.readonly`; a menção a `youtube.upload` foi removida. O nome do canal e o estado conectado/não conectado/erro são os únicos dados exibidos. Tokens não entram no StudioStore, localStorage ou bundle do cliente.

O retorno do callback usa query efêmera, mostra toast sanitizado e limpa a URL. Não houve teste real, upload, publicação ou chamada a credenciais Google.
