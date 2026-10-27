---
created: 2026-10-28
status: sin revisar (el usuario revisa al final de la fase)
plan: docs/plan-2026-10-27.md (fase 1, paso 9)
---

# compositio — diseño del paso 9 (mezcla)

Tableros de referencia del lienzo: «Definitivo», «Tableta», «MovilMezcla», «MovilOpcionesMezcla», `PopTransicion`, `Avisos`.

## Pistas de la mezcla

- «Añadir selección»: los archivos seleccionados al final de la mezcla, en el orden de la lista
- Cada pista usa lo editado en su archivo: entrada, salida, fundidos y, si su recorte lo pide, los silencios de los extremos
- Pista de vídeo: entra su pista de audio (la de «Extraer audio» del archivo)
- Reordenar arrastrando con SortableJS 1.15.7 (tabla de librerías del spec); con teclado, Alt+←/→ sobre la pista; Supr la quita. Cada gesto, un paso de deshacer
- Pulsar una pista la abre en el editor; la pista del archivo activo lleva borde de acento
- Archivo que falta: pista atenuada; «Generar» deshabilitado con el motivo en tooltip

## Tira

- Ancho de cada pista proporcional a su duración, ajustado al ancho del panel y con scroll horizontal
- Onda en miniatura si el archivo ya tiene picos en la sesión; si no, barra lisa
- Solape: tirador sobre el inicio de la pista con la duración; `role="slider"`, arrastrar en pasos de 0,1 s, flechas 0,5 s (Mayús 5 s); pulsar o Intro abre `PopTransicion`
- Corte seco: marca naranja entre pistas
- Solape que no cabe: se acorta al máximo y la tira lo marca (`overlap-too-long` de `layout`)
- Cabecera: «N pistas · duración»

## PopTransicion

- Pista que sale y pista que entra
- Duración (deslizador y campo), curva (las seis de los fundidos), corte seco
- «Usar el de la mezcla» vuelve al valor global
- Borrador dentro del popup; «Aplicar» lo guarda en un paso de deshacer
- «Escuchar»: 10 s antes y después del cruce con el borrador, en WAV, prioridad `view`; suena al llegar. Una escucha nueva cancela la anterior

## Opciones de la mezcla

- Fundido cruzado global, fundido de inicio y final, igualar volumen con objetivo en LUFS (nuevo `matchLufs`, -14 por defecto; campo opcional, el formato del montaje sigue en la versión 1), WAV o MP3, 44,1 o 48 kHz
- Escritorio y tableta: fila bajo la tira, como en «Definitivo»
- Móvil: lista vertical con asa de arrastre y hora de inicio; entre pistas, botón con la transición que abre `PopTransicion`; fichas de resumen que abren la hoja de opciones

## Generar

- Una orden de ffmpeg con todas las pistas: cada entrada con `-ss`/`-t` de su parte guardada; por pista sus fundidos, la ganancia de igualar, `aresample` y `aformat=sample_fmts=fltp:channel_layouts=stereo`; `acrossfade` encadenado con la curva de cada transición, `concat` en los cortes secos; fundidos de inicio y final sobre el total
- Grafo en línea (ffmpeg.wasm no tiene límite de argumentos)
- Igualar volumen: primera pasada por pista con loudnorm para medir sonoridad y pico verdadero; ganancia lineal hacia el objetivo, limitada para que el pico verdadero quede en -1 dBTP o menos. Las mediciones viven en la sesión y se reutilizan si la pista no cambia
- WAV de 24 bits; MP3 CBR 320 kbps
- Trabajo de usuario en la cola; al terminar, descarga directa con el nombre del montaje (o «mezcla»)
- Aviso de memoria: WAV estimado por encima de 1 GiB, con «Usar MP3»

## Tiempos CSV

- `n,start,title` de `timesCsv`; título = nombre del archivo sin extensión; mismo nombre que la mezcla con `.csv`

## Pruebas

- Unitarias: orden de la mezcla (entradas, fundidos, ganancia, cruces y cortes, fundidos globales), escucha de una transición, ganancia de igualar con su límite, estimación de tamaño, mover y quitar pistas
- e2e en Firefox con WAV generados: añadir selección, duración total, solape por teclado y deshacer, `PopTransicion` con escucha, generar WAV y medir su duración con el motor, CSV, móvil, axe en las tres disposiciones y los dos temas
