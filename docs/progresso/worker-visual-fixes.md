# Correções visuais do worker de render

## Escopo

- O worker agora transforma o SRT em um ASS intermediário (`captions.ass`) com `PlayResX` e `PlayResY` explícitos, estilo de legenda independente de `force_style` e fonte proporcional à largura do vídeo (3,8%: 41 px em 1080 px e 48 px em 1280 px).
- Cues longas são quebradas em linhas de até sete palavras, agrupadas em no máximo duas linhas por evento ASS. Se houver mais texto, são criados eventos consecutivos dentro do tempo original do cue, distribuídos proporcionalmente ao tamanho do texto. O SRT original continua preservado para QA e edição.
- Uma captura sem atribuição aparece apenas no primeiro slide. Capturas associadas a uma seção são selecionadas pelo índice zero-based da seção e destacadas na abertura daquela seção; capturas múltiplas da mesma seção são compostas em um mosaico. Slides sem captura passam a destacar a seção e o trecho corrente.
- O manifesto inclui `sectionIndex` em cada cue e em cada captura. Atribuições ficam no metadado opcional do asset no estado do estúdio; uploads existentes continuam como `null`. Não foi criada nem aplicada migration SQL.

## Validação local

- `pnpm check`: aprovado.
- `pnpm test`: 139 testes aprovados.
- `python3 -m unittest discover -s scripts -v`: 20 testes aprovados, incluindo geração local de MP4/ASS com FFmpeg e fixture TTS local; nenhuma API externa foi chamada.
- `pnpm build`: aprovado. O Vite preservou avisos preexistentes sobre `config.js` sem `type="module"` e sobre o tamanho do bundle.
- Um ASS de validação com três cues longas foi gerado e inspecionado visualmente sobre um slide vertical 1080×1920: cada evento tem no máximo duas linhas, `Fontsize=41` (3,8% da largura) e o conteúdo do slide permanece visível.

Nenhum render de produção, deploy ou merge foi executado nesta frente.
