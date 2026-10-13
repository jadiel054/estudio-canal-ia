# Correção do Gemini TTS

**Atualizado:** 13/10/2026  
**Estado:** implementação concluída em branch de correção; validação local aprovada.

## Diagnóstico

O código anterior chamava `POST /v1beta/interactions` com o contrato de entrada documentado, mas procurava o áudio em `output_audio.data`. Esse campo é uma propriedade de conveniência dos SDKs. No JSON REST bruto, o áudio fica no último bloco `audio` de `steps[].content[]`, em `steps[].content[].data`.

A documentação oficial também confirma que os modelos `gemini-3.8-flash-tts` e `gemini-3.8-flash-lite-tts` usam `response_format.type = "audio"`, `generation_config.speech_config` como uma lista de vozes e, em requisições unary, retornam WAV RIFF mono PCM de 16 bits a 24 kHz.

O sandbox não possui `STUDIO_LLM_GEMINI_KEY`; a chave permanece somente no cofre da Vercel. Por isso, nenhuma credencial foi copiada, decifrada ou exposta localmente. A forma e a extração do contrato foram reproduzidas com resposta REST simulada nos testes, e a chamada autenticada real ficará para o ambiente que possui a chave.

## Implementação

- Parser do REST bruto: busca o áudio em `steps[].content[].data`, mantendo compatibilidade defensiva com `output_audio.data`.
- Request unary explicitamente configurado como WAV a 24 kHz e `store: false`, evitando armazenamento desnecessário da interação.
- Validação do arquivo recebido: RIFF/WAVE, bloco `fmt`, bloco `data`, mono, 16-bit e 24 kHz.
- Observabilidade: em resposta sem áudio ou HTTP não-2xx, registra somente status HTTP e resumo estrutural sanitizado; não registra prompt, base64 ou corpo integral.
- `tts.testConnection`: testa principal e fallback e diferencia `not_configured`, `invalid_key`, `tts_unavailable` e `ok`.
- UI: o selo deixa de tratar apenas a presença da variável como TTS operacional. Há estados de teste pendente, TTS operacional, chave recusada e chave configurada com TTS indisponível, além de botão separado para testar conexão.
- Portões humanos e pipeline de render não foram alterados.

## Referências oficiais

- [Gemini TTS / Interactions API](https://ai.google.dev/gemini-api/docs/speech-generation)
- [Gemini TTS / generateContent](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation)
- [Interactions API — visão geral](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Interactions API — referência REST](https://ai.google.dev/api/interactions-api)
- [Gemini 3.8 Flash TTS](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts)
- [Gemini 3.8 Flash-Lite TTS](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts)

## Reprodução HTTP no sandbox

O POST sem credencial real alcançou `https://generativelanguage.googleapis.com/v1beta/interactions` e retornou HTTP 403 com `PERMISSION_DENIED` porque o sandbox não possui identidade de API. Isso confirma que a chamada externa está acessível, mas não reproduz o HTTP 200 da produção sem a chave que permanece no cofre da Vercel. A reprodução autenticada foi substituída por fixtures do corpo REST documentado, sem copiar ou imprimir o segredo.

## Validação

`pnpm check` passou. `pnpm test` passou com 16 arquivos e 82 testes. `pnpm build` passou para o frontend Vite e o bundle server esbuild. Permanecem somente os avisos não bloqueantes já conhecidos sobre o script de configuração da plataforma sem `type="module"` e o chunk principal acima de 500 kB.
