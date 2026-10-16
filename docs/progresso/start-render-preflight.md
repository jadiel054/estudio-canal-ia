# Pré-checagem e telemetria de `studio.startRender`

**Escopo da PR #15:** acrescentar breadcrumbs estruturados à mutation `studio.startRender` e documentar as consultas de diagnóstico abaixo. Não executar render, não alterar banco, não aplicar migrations e não implementar uma mitigação de armazenamento nesta PR.

## O que a telemetria registra

Cada registro JSON usa `event=studio_start_render_timing`, UUID técnico de tentativa, estágio allowlisted, timestamp ISO-8601 e tempo decorrido desde a entrada. Quando aplicável, registra duração do estágio, resultado allowlisted e status HTTP numérico. Os estágios distinguem:

- entrada da mutation;
- espera pela conexão Neon e conexão adquirida;
- início/fim de `BEGIN`;
- início/fim da espera por `SELECT ... FOR UPDATE` em `app_settings`;
- início/fim da persistência do job e do estado;
- início/fim de `COMMIT`;
- início do dispatch e resposta do GitHub Actions;
- falha com `failureStage` e `failureKind` allowlisted.

Não registra `ideaId`, `scriptId`, título, roteiro, estado JSONB, SQL, payloads, headers, tokens, mensagens livres, corpo da resposta GitHub ou detalhes de exceção. Uma falha de rede no dispatch é diferenciada de uma resposta HTTP, sem ler seu corpo. Os logs não iniciam nem repetem um job; apenas acompanham a execução normal da mutation.

## Consultas antes de qualquer novo clique

**Somente o proprietário executará estas consultas depois do merge da PR #15 e antes de qualquer clique.** Elas são SELECT-only, não leem o conteúdo editorial nem texto SQL das sessões. Registrar horário UTC e os resultados numéricos/allowlisted; não compartilhar valores de conteúdo.

### 1. Tamanho e versão do estado serializado

`octet_length(value::text)` mede os bytes da representação JSONB serializada em texto. `pg_column_size(value)` informa o tamanho da representação da coluna segundo PostgreSQL; não é necessariamente o tamanho externo/toast total.

```sql
SELECT
  key,
  octet_length(value::text) AS studio_state_octet_length,
  pg_column_size(value) AS studio_state_pg_column_size,
  value ->> 'version' AS studio_state_version,
  updated_at
FROM public.app_settings
WHERE key = 'studio_state';
```

### 2. Sessões ativas, espera e bloqueadores

Não selecionar a coluna `query`: o texto pode conter conteúdo ou parâmetros. `pg_blocking_pids` fornece os PIDs bloqueadores observáveis ao papel conectado.

```sql
WITH activity AS (
  SELECT
    pid,
    application_name,
    backend_type,
    state,
    wait_event_type,
    wait_event,
    xact_start,
    query_start,
    clock_timestamp() AS sampled_at,
    pg_blocking_pids(pid) AS blocking_pids
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
)
SELECT
  sampled_at,
  pid,
  application_name,
  backend_type,
  state,
  wait_event_type,
  wait_event,
  xact_start,
  query_start,
  CASE WHEN query_start IS NOT NULL THEN sampled_at - query_start END AS query_age,
  blocking_pids
FROM activity
WHERE state IS DISTINCT FROM 'idle'
   OR cardinality(blocking_pids) > 0
ORDER BY cardinality(blocking_pids) DESC, query_start NULLS LAST;
```

### 3. Locks visíveis relacionados a `app_settings` e locks aguardando

```sql
SELECT
  clock_timestamp() AS sampled_at,
  a.pid,
  a.application_name,
  a.state,
  a.wait_event_type,
  a.wait_event,
  l.locktype,
  n.nspname AS schema_name,
  c.relname AS relation_name,
  l.mode,
  l.granted,
  pg_blocking_pids(a.pid) AS blocking_pids
FROM pg_locks AS l
JOIN pg_stat_activity AS a ON a.pid = l.pid
LEFT JOIN pg_class AS c ON c.oid = l.relation
LEFT JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE a.datname = current_database()
  AND a.pid <> pg_backend_pid()
  AND ((n.nspname = 'public' AND c.relname = 'app_settings') OR NOT l.granted)
ORDER BY l.granted, a.pid, l.locktype;
```

Uma amostra sem espera não exclui contenção transitória. Para atribuir a espera especificamente ao `FOR UPDATE`, correlacionar a amostra temporal com `studio_state_lock_wait_started`/`studio_state_lock_acquired`, `failureStage=studio_state_lock`, `wait_event_type=Lock` e `blocking_pids`. `pg_stat_activity`/`pg_locks` podem omitir sessões de outros papéis conforme as permissões do papel Neon usado.

## Como interpretar e decidir

- `studio_state_octet_length` alto mostra um JSONB serializado grande, mas **sozinho não confirma lock**.
- A hipótese de contenção fica fortalecida se uma amostra imediata mostrar espera `Lock`/`blocking_pids` não vazio, com locks/sessões sobre `public.app_settings`, e a telemetria mostrar grande intervalo entre início e aquisição do lock (ou ausência de aquisição antes do timeout).
- Se a conexão foi adquirida rapidamente, o lock foi adquirido rapidamente e o tempo cresce depois disso, os breadcrumbs de persistência/COMMIT deslocam o diagnóstico para a serialização, update, outras queries da transação ou commit — não para a espera inicial por lock.
- Se não houver espera no instante da amostra, não concluir ausência histórica: repetir a consulta somente quando autorizado e correlacionar com os breadcrumbs do próximo intento; esse intento exige autorização explícita separada.

## Mitigação condicional — proposta, não implementada

Se os números e breadcrumbs confirmarem contenção associada ao estado grande, primeiro reduzir a linha quente `app_settings.studio_state` numa mudança separada e revisável:

1. Mapear quais arrays crescem mais (histórico de chat e trilha/audit são candidatos) por **contagem/tamanho agregado**, sem exportar conteúdo.
2. Projetar tabelas dedicadas para histórico de chat e/ou audit append-only; fazer backfill controlado e leituras compatíveis antes de remover esses dados do JSONB. Preservar o histórico e garantir que o espelho editorial não os regrave integralmente.
3. Depois, avaliar saves incrementais para campos realmente independentes, mantendo controle de versão/concorrência otimista e transações. Não substituir `UPDATE` do JSONB inteiro por patches sem definir conflito, consistência e compatibilidade de rollback.
4. Medir de novo tamanho do estado, duração do lock, duração do commit e comportamento de `saveState` antes de liberar qualquer render.

A PR #15 não executa nenhuma dessas alterações nem modifica a estrutura do Neon. O relatório operacional deverá receber os valores observados e a decisão do proprietário após as consultas.
