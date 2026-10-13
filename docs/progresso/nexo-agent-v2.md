# Nexo v2 — LOP, prompt e histórico

**Data:** 13/10/2026  
**Branch:** `feat/nexo-agent-loop`  
**Base:** `main` em `1056d42` (inclui a correção Gemini TTS já mesclada em PR #4).

## Diagnóstico vs. Blueprint

- O Blueprint previa personalidade natural, prompt explícito e ações permitidas. Não era correto dizer que não havia system prompt: já existia um prompt inicial no servidor, mas era curto e pouco operacional.
- Havia um loop de ferramentas de até três passos, porém sem proteção contra repetição; e o texto alternava com respostas locais heurísticas.
- A interface guardava o chat e o Neon recebia o estado, mas a rota enviava ao modelo somente a mensagem atual — portanto não havia memória conversacional efetiva entre turnos.
- Os rótulos de ferramentas da interface prometiam edição de pautas e disparo de etapas que a allowlist atual não implementava. Foram alinhados à capacidade real, sem alegar funcionalidades ausentes.
- A Etapa C do render real está implementada e implantada; a prova ponta a ponta ainda não foi executada.

## Mudanças implementadas

- Prompt do Nexo versionado como `2.0.0`, com voz natural em PT-BR, missão editorial, LOP (observar → planejar → agir → conferir → encerrar), instruções contra conteúdo externo como instrução e limites dos Portões 1 e 2.
- Novo runtime isolado em `server/agent/runtime.ts`, com até 4 ciclos / 6 chamadas de ferramenta por turno, observações de ferramenta repassadas ao próximo ciclo, tratamento de falhas e bloqueio de repetição idêntica de ações de escrita.
- Contexto textual de até 10 mensagens recentes enviado pela interface e validado no servidor; mensagens de exemplo são excluídas.
- Redação de padrões comuns de credenciais antes de enviar o texto ao LLM e antes de devolver respostas/erros ao navegador.
- Removidas respostas locais que podiam parecer uma resposta real do agente; identificadores e lista de capacidades na interface foram ajustados.
- Testes unitários do runtime adicionados.

## Validação local

- `pnpm check` — aprovado.
- `pnpm test` — 17 arquivos, 88 testes aprovados.
- `pnpm build` — aprovado. Restaram os avisos existentes do bundle do Vite sobre `config.js` sem `type="module"` e chunk maior que 500 kB; não são erros deste runtime.

## Render real — estado ainda a conferir

- Vercel tem um deployment `READY` de produção para o commit `1056d42`.
- Os nomes `GITHUB_ACTIONS_TOKEN` e `STUDIO_RENDER_HMAC_SECRET` aparecem configurados como variáveis de produção no projeto Vercel, mas os valores não foram lidos.
- GitHub Actions lista os dois workflows (`Render privado de vídeo` e `Limpar render publicado`) ativos; não há execuções anteriores dos workflows de render/limpeza.
- O painel do Estúdio é privado. A sessão de desenvolvimento mostrou apenas o login; é preciso autenticação do dono para ler o status de Neon/token/HMAC no painel.
- Nenhum render real foi disparado nesta tarefa. A primeira prova permanece reservada à pauta segura, Portão 1 aprovado, amostra de voz validada se houver TTS e confirmação explícita antes do clique que consome Actions/cria Release draft.

## Próximos passos

1. Autenticar na sessão do painel e ler os estados de Neon, token Actions e HMAC sem revelar valores.
2. Se todos estiverem prontos, escolher pauta real e completar as etapas de aprovação/asset conforme o checklist da Etapa C.
3. Solicitar uma confirmação específica para a primeira execução de render real; conferir arquivo, QA e download. Publicação e limpeza continuam manuais.
4. Expandir a allowlist de ferramentas (editar pauta e iniciar etapas não destrutivas) em uma próxima mudança, com testes e validações de domínio próprias — não prometer isso na interface até estar implementado.
