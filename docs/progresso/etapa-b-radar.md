# Etapa B — Radar e roteiro com fontes reais

**Estado:** implementado no código e pronto para publicar após validação; a primeira coleta serve como linha de base. A pontuação não representa popularidade do YouTube nem garante demanda brasileira.

## Coleta do Radar

O backend usa APIs públicas, sem chave obrigatória para as três fontes:

- **Hacker News:** lista oficial de histórias em alta e os metadados dos itens. A API publica `score`, comentários e horário, e declara não ter limite fixo de requisições.
- **GitHub:** Search REST API, cinco consultas recentes por termos ligados a MCP, agentes e LLMs, com `stars:>=3` e repositórios criados nos últimos 14 dias. Uma execução autenticada como usuário não é necessária; a API de busca pública continua sujeita à sua cota anônima.
- **dev.to:** API Forem, artigos populares recentes nas tags `ai`, `python`, `javascript`, `typescript` e `webdev`.

Os registros recebem identificador estável por fonte, título, URL de origem, horário e metadados públicos. A aplicação mantém a última versão do sinal e salva observações sucessivas em `radar_observations`; o estado e as execuções ficam em `radar_signals` e `radar_runs`. Isso não toca no JSON do estado editorial existente.

**Score explicável (0–100):** volume 20%, crescimento 25%, lacuna estimada de conteúdo em PT-BR 25% e aderência ao canal 30%. Volume usa uma escala logarítmica da métrica pública. Crescimento compara a métrica atual com a observação anterior. Na primeira coleta, não há crescimento histórico para comparar; o cartão explicita “Novo sinal · ritmo inicial estimado”. Depois, informa a variação desde a coleta anterior. Números em fontes diferentes não são comparáveis em termos absolutos.

A tarefa `leve` dos provedores configurados no próprio Estúdio classifica aderência, lacuna, ângulo e tags. Se os provedores estiverem indisponíveis, uma regra local marcada como tal preserva a coleta e deixa visível que a lacuna é uma hipótese. A heurística não substitui a classificação por LLM. As entradas externas são tratadas como dados, não como instruções para o modelo.

## Atualização e segurança

- O botão **Atualizar agora** chama a rota tRPC autenticada do proprietário, com limite de uma atualização manual por minuto.
- O Vercel Cron está configurado para **todos os dias às 08:00 UTC (05:00 no horário de Brasília)**. O plano Hobby permite uma execução diária, mas pode iniciá-la em qualquer momento dentro da hora agendada.
- O endpoint `/api/cron/radar` exige o `CRON_SECRET` sensível que foi cadastrado somente no ambiente de produção. O token não está no repositório. A rotina não publica conteúdo nem altera a política de aprovação.
- Falhas por fonte são registradas e as outras fontes continuam. Sem qualquer fonte bem-sucedida, a execução registra a falha e responde com erro, sem apagar coletas anteriores.

## Pautas, roteiro e Portão 1

Pautas podem receber notas e até dez URLs de referências/capturas do projeto. O roteiro usa esses dados como contexto, inclui as seções gancho, problema, demonstração, resultado e CTA, e marca comandos ou detalhes que exigem validação. A geração e a tarefa `qa` são executadas no servidor; o cliente não envia o texto de roteiro para ser gravado como se tivesse sido gerado pelo backend.

O QA fica junto à versão do roteiro no estado persistido do Estúdio e aparece no editor do **Portão 1**. Apresenta duração estimada, trechos técnicos para conferir, repetições, termos que merecem revisão e sinais de originalidade/conteúdo genérico. Se o provedor QA falhar, regras locais limitadas são exibidas como `heuristic`. Um QA não executa código, não autentica capturas nem prova originalidade: a revisão humana continua obrigatória. A aprovação do Portão 1 é recusada sem QA; qualquer edição que mude o texto invalida o QA anterior.

## Validação realizada e fontes oficiais

As APIs responderam HTTP 200 em consulta de teste sem autenticação. Testes automatizados cobrem leitura, deduplicação, score, linha de base, gravação do lote e obrigatoriedade do QA. A referência final de build/teste fica registrada no commit da Etapa B.

- [Documentação oficial da API do Hacker News](https://github.com/HackerNews/API)
- [Documentação oficial da busca REST do GitHub](https://docs.github.com/en/rest/search/search)
- [Documentação oficial da API Forem](https://developers.forem.com/api/v0)
- [Limites e preço dos Vercel Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## Limites conhecidos

A busca GitHub usa uma cota pública anônima e pode ser temporariamente limitada. “Lacuna em PT-BR” é uma inferência do classificador sobre sinais encontrados em HN/GitHub/dev.to; não é uma busca completa no YouTube. As métricas só ficam mais confiáveis após pelo menos duas coletas. Capturas são fornecidas como URLs e notas nesta versão; não há upload binário de imagem nem leitura visual de anexos.
