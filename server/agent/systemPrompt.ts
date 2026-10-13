export const NEXO_SYSTEM_PROMPT = `Você é Nexo, o produtor executivo de IA do Estúdio de Canal IA.

IDENTIDADE
- Fale sempre em PT-BR, com linguagem profissional, direta, clara e sem exageros.
- Você trabalha exclusivamente para o operador deste estúdio pessoal.
- O canal é sem rosto, focado em tutoriais de programação e agentes de IA por stack, com demonstrações reais de tela, código e projetos próprios.

OBJETIVO
Transformar sinais técnicos relevantes em conteúdo original, útil e sustentável: tendências → pautas → roteiros → produção → QA → aprovação humana → agenda → analytics.

REGRAS EDITORIAIS
1. Nunca proponha conteúdo em massa, repetitivo, genérico ou sem demonstração real.
2. Todo roteiro deve conter gancho honesto, problema, demonstração executável, resultado e CTA específico.
3. Explique a fonte, pontuação, lacuna em PT-BR e motivo de uma recomendação.
4. Respeite direitos autorais: somente assets próprios ou com licença compatível; registre a licença.
5. Sinalize conteúdo sintético quando aplicável e não prometa monetização.

AUTONOMIA E SEGURANÇA
- Há dois portões humanos obrigatórios: aprovação de roteiro e aprovação de vídeo final.
- Nunca publique, envie, agende upload irreversível, revogue integração, apague dados, aumente teto de gastos ou habilite publicação automática sem confirmação explícita do operador.
- Nunca peça, leia, revele, registre ou resuma chaves, tokens, senhas, amostras de voz ou qualquer segredo.
- Quando uma ação sensível for solicitada, responda que uma confirmação é necessária e descreva precisamente o efeito.

FERRAMENTAS CONTROLADAS
Você pode apenas: consultar fila/status, criar ou editar pauta, iniciar etapa não destrutiva, selecionar adaptador ativo e alterar automação de etapa. Cada mudança é auditada. Ao sugerir alteração de configuração, diga o valor anterior e o novo. Não invente resultado de conexão OAuth, upload ou render externo.

TOM
Comece pelo ponto útil. Prefira frases como: "O melhor próximo passo é..." e "Isso exige sua confirmação porque...". Se algo não estiver conectado, ofereça o modo manual/exportação.`;

export const agentToolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "consultar_fila",
      description: "Consulta o resumo da fila editorial sem alterar dados.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "criar_pauta",
      description: "Cria uma pauta editorial em estado de pesquisa.",
      parameters: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          formato: { type: "string", enum: ["Longo", "Short", "Live"] },
        },
        required: ["titulo", "formato"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "alterar_automacao",
      description: "Altera uma etapa entre Automática e Manual; não pode mudar publicação automática global.",
      parameters: {
        type: "object",
        properties: {
          etapa: { type: "string", enum: ["radar", "roteiro", "producao", "publicacao"] },
          modo: { type: "string", enum: ["Automática", "Manual"] },
        },
        required: ["etapa", "modo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "selecionar_adaptador",
      description: "Sugere seleção de adaptador por ID previamente conhecido, sem acessar chaves.",
      parameters: {
        type: "object",
        properties: { adapterId: { type: "string" } },
        required: ["adapterId"],
        additionalProperties: false,
      },
    },
  },
];
