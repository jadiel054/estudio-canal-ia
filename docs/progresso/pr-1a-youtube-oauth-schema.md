# PR-1A — schema OAuth YouTube somente leitura

A migration aditiva cria `oauth_connection_states` para state hash one-shot com TTL e `youtube_oauth_credentials` para tokens cifrados no servidor. Também evolui `channels` com owner/workspace, timestamps de conexão/sincronização, revogação e erro sanitizado, além da unicidade por owner/workspace/plataforma/canal externo.

A migration **não foi aplicada** ao Neon. Ela não contém client secret, token, chave AEAD, escopo de escrita ou chamada externa. O escopo inicial do fluxo será somente `https://www.googleapis.com/auth/youtube.readonly`.

Validação local: teste estático da migration passa; nenhuma consulta ao banco foi executada.
