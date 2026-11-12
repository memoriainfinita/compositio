---
created: 2026-11-11
status: aprobado
plan: docs/design/fase-2-diseno-2026-11-11.md (paso 2)
---

# compositio, fase 2, diseño del paso 2: modelo de vídeo y traductor a ffmpeg

Sin interfaz (paso 4), sin WebCodecs (paso 3), sin mezcla (paso 5), sin HAP (paso 6). Al acabar, un archivo de vídeo se procesa de punta a punta con ffmpeg.wasm desde el modelo y el motor, con las órdenes probadas.

## Qué cambia

Hoy `plan()` elige una pista de audio, exige que exista (`no-audio-track`) y escribe `-af`. Un vídeo solo sirve para extraer su audio. Después del paso: un trabajo tiene una salida de **audio** o de **vídeo**, y las operaciones de imagen son pasos del mismo plan, con las mismas medidas, avisos, deshacer, presets y montajes.

## Ajustes

Pasos en orden fijo: `extract`, `trim`, `picture` (nuevo), `normalize`, `convert`, `output`.

- `extract.kind`: `'audio' | 'video'`, por defecto `'audio'`. Un archivo de vídeo sigue dando su audio mientras no se elija vídeo; los presets, montajes y ajustes viejos no cambian de comportamiento.
- `extract.audio` (solo con `kind: 'video'`): `'keep' | 'none' | 'silence' | 'replace'`, por defecto `'keep'`. `'silence'` deja una pista de audio muda (`anullsrc`); `'none'` quita el audio.
- `extract.replaceWith`: `null | { fileId, track }`. Solo tiene sentido en los ajustes propios de un archivo; la unidad de «sustituir» es otro archivo de la sesión.
- `extract.track` y `extract.mode` (`encode | copy`) se quedan. Con `copy` y `kind: 'video'` se copian los flujos sin recodificar: el corte cae en un fotograma clave y el plan avisa (`keyframe-cut`). Contenedor por códec: H.264, H.265 y AAC a mp4; ProRes a mov; lo demás a mkv.
- `picture` (solo cuenta con `kind: 'video'`):
  - `rotate`: `0 | 90 | 180 | 270`, a derechas, sobre la imagen ya orientada por la etiqueta de rotación del archivo.
  - `crop`: `null | { x, y, width, height }` en píxeles de la imagen ya rotada. El plan lo rechaza si sale del cuadro (`crop-outside-frame`).
  - `scale`: `{ mode: 'source' | 'fit' | 'fill' | 'letterbox' | 'stretch', width, height }`. `fit` cabe dentro; `fill` cubre y recorta al centro; `letterbox` cabe y rellena con negro; `stretch` deforma. Todo se redondea a par, y a múltiplo de 4 con HAP.
  - `fps`: `'source' | '24000/1001' | '24' | '25' | '30000/1001' | '30' | '50' | '60000/1001' | '60'`. Salida siempre a fps constante: con `source` se fija el del archivo.
  - `speed`: de 0,25 a 4, por defecto 1. Imagen y audio juntos; el audio conserva el tono (`atempo` encadenado, que admite 0,5 a 2 por etapa).
  - `fadeToBlack`: booleano, por defecto `true`. Los fundidos del archivo (entrada y salida) se aplican también a la imagen, lineales; la curva es solo de audio (el filtro `fade` de ffmpeg 5.1 no tiene curvas).
- Campos planos en `convert` (la mezcla de ajustes propios baja un solo nivel): `videoFormat: 'mp4' | 'prores'` (mp4), `h264Crf` 0 a 51 (18), `h264Preset` `veryfast | fast | medium | slow` (veryfast), `proresProfile` `proxy | lt | standard | hq | 4444` (hq). `convert.format` y el resto de `convert` siguen siendo el audio: con vídeo, `mp4` lleva AAC (`aacBitrate`) y `prores` PCM (`bitDepth`), y la frecuencia, los canales y la normalización siguen valiendo.
- Formatos guardados: `MONTAGE` y `PRESETS` suben a versión 2 con una migración de 1 a 2 que no toca el cuerpo (los campos nuevos tienen valor por defecto), para que una versión vieja de la app rechace un archivo nuevo en vez de ignorar sus ajustes. La versión sube una vez para toda la fase 2; los pasos siguientes añaden campos bajo ella.
- `STEPS` añade `picture`. Una función del modelo, `stepsFor(hasPicture)`, dice qué pasos aplican a un archivo; el inspector solo enseña `picture` con vídeo y, hasta el paso 4, con un cuerpo vacío.

## Sonda

`VideoTrack` gana `pixelFormat`, `bitDepth` y `bitrate`, y la sonda lee también `color_transfer`. Con eso:
- `hasAlpha(track)` por el formato de píxel (`yuva`, `rgba`, `argb`, `gbrap`...): decide `yuva444p10le` frente a `yuv444p10le` en ProRes 4444.
- Aviso `hdr-not-mapped`: fuentes PQ o HLG no se convierten a SDR; salen tal cual, etiquetadas o no según el códec.

## Plan

- `Context` gana `video: VideoTrack | null` y la salida (`audio` o `video`). `Draft` gana `vfilters`, `inputs` (entradas extra) y mapas de vídeo.
- Errores nuevos: `no-video-track`, `crop-outside-frame`, `replace-missing`. `no-audio-track` solo vale con `kind: 'audio'`; con vídeo y audio `keep` en un archivo sin audio, sale sin audio y avisa (`audio-absent`).
- Avisos nuevos: `keyframe-cut`, `audio-absent`, `hdr-not-mapped`, `size-rounded`. Cada uno con su paso en el inspector y su texto en español e inglés.
- Orden dentro de la cadena de imagen: orientar (automático) → girar → recortar → escalar → fundidos → velocidad (`setpts`) → fps. El audio: fundidos → `atempo` → normalizar → convertir.
- H.264: `libx264 -preset <speed> -crf <crf> -profile:v high -pix_fmt yuv420p`, contenedor mp4 con `-movflags +faststart`. ProRes: `prores_ks -profile:v <n>`, `yuv422p10le` (y 444 en 4444), contenedor mov. Metadatos con la opción existente.
- Medida: se mide solo el audio, sin decodificar la imagen (la primera pasada lleva `-map 0:a`).
- Sustituir audio: segunda entrada, `-map 0:v -map 1:a`. Silenciar: `-f lavfi -i anullsrc=...`. El audio de sustitución se recorta a la duración del vídeo.
- El plan declara `outputDuration` (rango dividido por la velocidad): el progreso de ffmpeg cuenta tiempo de salida.
- Sacar un fotograma: función aparte, `frameArgs(...)`, a PNG o JPEG, en el instante dado, con la imagen orientada y, a elección, con el recorte y el tamaño de `picture`. Job `extractFrame` del motor.

## Motor

- `PlanInput` gana `replacement` (ruta e información del archivo que aporta el sonido) y `encoderThreads`; el plan añade él mismo la segunda entrada (sustitución o `anullsrc`). `processFile` monta los dos archivos cuando hay sustitución; la pasada de medida lee solo la sustituta. El inspector no enseña `picture` hasta el paso 4 (`INSPECTOR_STEPS`).
- ffmpeg.wasm: los trabajos de vídeo piden el núcleo multihilo (`RunRequest.core: 'mt'`), que da 2 veces con libx264. `WasmRunner` cambia de núcleo descartando la instancia actual (una a la vez, para no duplicar memoria); sin aislamiento de origen cae al de un hilo. Con núcleo multihilo, el plan lleva `-threads 2` (con hilos automáticos el worker aborta).
- El motor expone `multithread`, que ya existe; `createEngine` lo pasa al plan (`encoderThreads: 2`) y `processFile` pide entonces el núcleo multihilo. Sin aislamiento, el trabajo va por el de un hilo y sin `-threads`.

## Pruebas

1. Unitarias: argumentos exactos por operación y por combinación, esquemas y valores por defecto, migración 1 a 2, `stepsFor`, errores y avisos del plan, cadenas de `atempo`, tamaños pares y múltiplos de 4, recorte dentro del cuadro, sonda con fixtures de ffprobe (alfa, HDR, rotación, 10 bits).
2. Contra ffmpeg 8.1.1 nativo, script fuera del repo como en el paso 3: cada orden generada sobre clips con tonos y `testsrc2`, y comprobación con ffprobe de códec, tamaño, fps, duración y formato de píxel.
3. e2e en Firefox sobre ffmpeg.wasm 5.1.4: clips pequeños (320x180, 2 s) generados dentro de la página, un caso por operación, y salidas releídas con ffprobe de la propia ffmpeg.wasm. Sin axe: no hay interfaz nueva.

## Fuera de este paso

- Desentrelazado y mapeo de tonos HDR: no están en el spec. Se anotan en Aparcado.
- ProRes entra aquí, porque es un codificador más de ffmpeg; el paso 6 queda para HAP.

## Riesgos

- `[MEDIO]` fps constante con `-vsync cfr` o `-fps_mode cfr` según lo que admita ffmpeg.wasm 5.1.4: se comprueba en la prueba e2e antes de fijarlo.
- `[MEDIO]` mp4 con `+faststart` reescribe el archivo y necesita memoria el doble de la salida en MEMFS; el tope práctico de 2 GB de ffmpeg.wasm sigue valiendo. WebCodecs con OPFS (paso 3) lo resuelve donde exista.
- `[BAJO]` cambio de núcleo entre un trabajo de audio y uno de vídeo: 1 a 5 s de carga. Se agrupa en la cola si hace falta.
- `[BAJO]` el filtro `fade` es lineal en 5.1: una curva distinta de la de audio, dicho en el tooltip del paso 4.

## Resultado

Implementado y verificado: pruebas unitarias, 29 órdenes contra ffmpeg 8.1.1 nativo con comprobación de ffprobe, e2e en Firefox sobre ffmpeg.wasm 5.1.4 (núcleo multihilo, todas las operaciones) y núcleo multihilo bajo la CSP estricta y el service worker de la compilación de producción. Desviaciones respecto al diseño original, ya reflejadas arriba: campos planos de `convert`, `stepsFor(hasPicture)` y sin el aviso `speed-resamples-audio` (`atempo` conserva el tono; no hay nada que avisar). `frameArgs` y el job `extractFrame` (`engine.frame`) están hechos. Con vídeo y audio solo en archivos, un archivo sin imagen se rechaza con `no-video-track`.
