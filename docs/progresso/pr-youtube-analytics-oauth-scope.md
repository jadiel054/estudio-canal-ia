# PR — escopo OAuth para YouTube Analytics

**Status:** PR sem merge; reconexão real não executada nesta branch.

## Alteração

O início OAuth agora solicita exatamente estes dois escopos:

- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/yt-analytics.readonly`

O callback valida que ambos estejam presentes e rejeita qualquer conjunto incompleto ou com escopo adicional. `youtube.upload` e qualquer outro escopo de escrita continuam proibidos.

A UI foi atualizada para informar: **somente leitura do canal + analytics somente leitura**.

## Testes

A cobertura offline valida:

- URL de início com os dois escopos;
- callback com os dois escopos aceito e persistência cifrada dos tokens;
- callback com apenas um escopo rejeitado com `youtube_scope_rejected`;
- ausência de escopo de escrita.

Nenhuma chamada real ao Google, reconexão de conta ou alteração de produção foi executada.

## Pós-merge autorizado

Depois do merge e deploy, o dono deve clicar em **Desconectar** e depois em **Preparar conexão**, autorizar as duas permissões na tela do Google e então repetir o diagnóstico Analytics.
