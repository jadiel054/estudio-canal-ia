# Etapa A — correções de segurança e veracidade

Base: commit `3177d58`. Toda a Etapa A foi validada com `pnpm check` e `pnpm test`
(49 testes) e com smoke test do build empacotado antes do push.

## 1. Modelos Gemini e parâmetro de pensamento

Os padrões no código passaram a usar a série 3, que é a indicada pela própria
documentação oficial para projetos novos — os modelos 2.5 tiveram o acesso
restrito ("limitamos o acesso aos modelos 2.5 a quem já os usava") e respondem
404 em chaves novas, exatamente o erro observado.

| Tarefa | Modelo padrão |
| --- | --- |
| roteiro, qa, agente | `gemini-3.8-flash` |
| leve | `gemini-3.5-flash-lite` |

Fonte: <https://ai.google.dev/gemini-api/docs/models> (atualizado em 2026-10-09).

**Sobre `thinkingBudget` x `thinkingLevel`.** A documentação oficial de
pensamento (`/gemini-api/docs/generate-content/thinking`) é explícita:

> Use o parâmetro `thinkingLevel` com os modelos Gemini 3. Embora
> `thinkingBudget` seja aceito por compatibilidade, usá-lo com o Gemini 3 Pro
> pode resultar em desempenho inesperado.

Portanto `thinkingBudget` foi substituído por `thinkingLevel`
(`minimal · low · medium · high`), agora configurável por tarefa na tela de
Configurações. Duas regras verificadas em teste:

- `gemini-3.8-flash` **não aceita** `minimal` (retorna erro): o valor é enviado
  como `low` e a interface avisa qual valor foi realmente enviado.
- Modelos da série 2.5, se alguém digitar um manualmente, continuam recebendo
  `thinkingBudget` equivalente — a série 2.5 não conhece `thinkingLevel`.

Erros de modelo passaram a ter mensagem própria: **404 → "modelo indisponível
para esta chave"**; 400/401/403 também ganharam rótulos claros. Nenhum corpo de
resposta do provedor é registrado, para não vazar detalhes.

## 2. Render simulado não é mais apresentado como real

`startRender` não cria mais um vídeo "aprovado" com duração fixa:

- o vídeo recebe `simulated: true` e a duração é marcada como **estimada**;
- o job de render passa a ter `status: "simulado"` e `simulated: true`;
- o QA é gravado como **não verificado** (`passed: false`, `verified: false`,
  nota "Não verificado — render simulado") em vez de aprovado fictício;
- a auditoria registra "Render simulado concluído".

Na interface, vídeo e job aparecem com o selo **SIMULADO** e a fila mostra
"QA NÃO VERIFICADO (render simulado)".

`approveVideo` e `scheduleVideo` são bloqueados no servidor para vídeo simulado,
exceto em **modo demonstração** explícito (`settings.demoMode`), ligado pelo dono
nas Configurações com diálogo de confirmação e registrado na auditoria.

## 3. Brecha do Portão 1 fechada

`updateScript` num roteiro já `Aprovado` com conteúdo diferente agora:

- incrementa a versão do roteiro;
- devolve o roteiro para `Aguardando aprovação`;
- devolve a pauta para `aguarda_aprov_roteiro`;
- registra "Portão 1 reaberto por edição" na auditoria.

Consequência verificada em teste: o Portão 2 fica inalcançável, porque
`startRender` exige roteiro aprovado. Salvar sem alterar o conteúdo continua
sendo uma operação neutra.

## 4. Concorrência otimista

O estado carrega uma `version`. `saveStudioState` só grava quando a versão no
Neon ainda é a que foi lida:

```sql
UPDATE app_settings SET value = $1::jsonb, updated_at = NOW()
WHERE key = 'studio_state' AND COALESCE((value->>'version')::int, 0) = $2
```

Zero linhas afetadas = conflito. Sem `ON CONFLICT DO NOTHING` silencioso: a
inserção também confere `rowCount`. O conflito chega ao cliente como erro
`CONFLICT` com mensagem clara, e a tela recarrega o estado mais recente em vez de
sobrescrever. As gravações não editoriais (configurações, adaptadores, conexões,
chat) releem e tentam de novo até 3 vezes, porque não disputam as fatias que os
comandos editoriais alteram.

Teste: dois comandos simultâneos — exatamente um grava, o outro recebe conflito,
e a versão avança uma única vez (nenhuma gravação perdida em silêncio).

## 5. `saveState` e `importState` validados

Ambos aceitavam `z.unknown()`. Agora passam por `parseStudioState`
(`server/studioStateSchema.ts`):

- schema Zod completo do estado (estágios, formatos, status, faixas de metas);
- limite de **512 KB** por payload (`StateTooLargeError` → erro
  `PAYLOAD_TOO_LARGE`);
- `version` é controlada pelo servidor, não pelo cliente.

Um teste garante que o próprio conjunto de demonstração passa nessa validação —
sem isso, o primeiro salvamento do aparelho falharia.

## 6. Regra de publicação documentada e única

`canPublishVideo` em `@shared/workflowPolicy` é a única fonte da regra, sempre
verificada no servidor lendo o Neon:

1. vídeo aprovado no Portão 2 (`aprovado_para_agenda` ou `agendado`);
2. roteiro aprovado no Portão 1;
3. vídeo simulado só passa em modo demonstração;
4. com `publicacao` em **Automática**, exige confirmação explícita do dono já
   registrada em `agent_confirmations` (status `approved`) — sem ela, o estúdio
   libera apenas a publicação manual.

O comportamento antigo (liberar só em "Manual" e bloquear em "Automática" sem
explicação) foi substituído por essa regra, que retorna o motivo exato do
bloqueio. A tela de Publicações ganhou o botão **Autorizar publicação**, que
consulta essa regra no servidor.

## 7. Ator real na auditoria

O `actor` deixou de ser inferido por heurística sobre o texto da ação. Agora vem
do contexto: **"Você"** (dono autenticado, nas rotas `adminProcedure`),
**"Nexo"** (ferramentas do agente) e **"Sistema"** (rotinas do servidor). Teste
dedicado confirma os três caminhos.

## 8. Dados de exemplo separados do real

- Todo item do conjunto de demonstração (sinais do Radar, pautas, roteiros,
  assets, vídeos, jobs, adaptadores, auditoria e chat) recebe `example: true` e
  aparece com o selo **EXEMPLO**.
- Botão **Limpar dados de exemplo** (Configurações) remove apenas itens marcados
  como exemplo, com confirmação e auditoria; dados reais não são afetados.
- Números que eram fictícios apresentados como reais foram corrigidos:
  - **Analytics**: faixa "Dados de exemplo — nenhuma métrica real está
    conectada"; gráfico e insights rotulados como exemplo;
  - **Início**: "Meta da semana 2/2" passou a mostrar publicados reais sobre a
    meta; a quota do YouTube mostrava "800/10.000 unidades" sem conexão e agora
    informa que o YouTube não está conectado;
  - **Radar**: o botão "Atualizar" mostrava sucesso falso e agora informa que a
    coleta real entra na Etapa B;
  - **Configurações**: os cartões de segurança diziam "Neon Pendente" mesmo com o
    banco conectado — corrigido para o estado real.

## 9. Segredos

Nenhum valor de segredo foi adicionado ao código, a logs ou a respostas. As
mensagens de erro usam apenas códigos HTTP e rótulos; o corpo das respostas dos
provedores não é registrado.

## O que ainda depende do operador

**O estado editorial nunca foi importado para o Neon** — a tabela `app_settings`
não tem a chave `studio_state`. Sem isso, todos os comandos editoriais (criar
pauta, gerar roteiro, aprovar, renderizar) respondem "O estado do estúdio ainda
não foi importado para o Neon". O primeiro passo no celular é:
**Configurações → Importar dados deste aparelho**.

Também não é possível a este agente autenticar em produção (a senha e o hash
vivem apenas no cofre da Vercel), por isso a verificação em produção se limita a
health, autorização das rotas e presença do código novo no bundle publicado.