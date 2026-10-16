# Separação de direção visual e narração

## Contrato

Os roteiros anotados aceitam blocos `Visual:` e `Áudio (Narração):`, com ou sem negrito nos rótulos. A nota Visual é registrada como metadata `{ sectionIndex, section, text }` em `visualDirections`; ela não entra em `cues`, `ttsChunks`, captions nem texto de slide. Somente o conteúdo de Áudio (Narração) se transforma em cue e fala. O `sectionIndex` da direção visual é usado como referência ao associar a seção a capturas do manifesto/worker.

Se o roteiro não contém nenhum marcador, o parser mantém o comportamento legado: texto fora de headings e blocos de código continua virando narração. No worker, `visualDirections` é opcional para que manifests antigos continuem válidos. Quando disponível, a seção da direção orienta a captura; sem ela, a seleção antiga por índice/nome de seção continua.

O gerador pede os dois blocos separados em cada seção; o QA recebe a instrução explícita de não contar Visual como fala ou duração. O worker valida os metadados e usa apenas `cue.text` para o slide, mantendo a direção fora da imagem final.

## Testes

- Parser: roteiro legado sem marcadores, roteiro anotado com marcadores em negrito e texto normal, notas visuais excluídas das cues/TTS, preservação do mapeamento por seção.
- Geração: prompt requer rótulos separados e impede que Visual vire fala/legenda/texto de slide.
- Worker: valida direção e índice, seleciona captura associada à seção visual e verifica que a imagem do slide é idêntica com ou sem metadata Visual.
- Não houve render real, chamadas a produção, merge, publicação nem deploy manual.
