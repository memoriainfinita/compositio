---
created: 2026-11-11
status: aprobado
plan: docs/design/fase-2-diseno-2026-11-11.md (paso 6)
---

# compositio, fase 2, diseño del paso 6: HAP

Sin documentación (paso 7). Al acabar, un vídeo o una mezcla de vídeo pueden salir en HAP (`.mov`), con la imagen, el encuadre, los fundidos y el audio de siempre, listos para reproducir con HAP (Resolume es uno de los programas que lo usan, y el formato no depende de él). Se construye sobre el spike del 2026-11-11 (`.archive/spikes-hap/`, spec «Pruebas de riesgo de vídeo»): codificador propio en JS validado en Resolume, igual de bueno que el de ffmpeg.

## Qué hay hoy

- ffmpeg.wasm no tiene `hap` y Mediabunny no escribe ese códec: HAP no puede salir de ninguno de los dos motores actuales.
- El motor WebCodecs ya decodifica, dibuja en un `OffscreenCanvas` (recorte, rotación, ajuste, fundidos, cruces de la mezcla) y entrega fotogramas a un destino que hoy es un `CanvasSource` de Mediabunny hacia un mp4 en OPFS. El audio llega aparte, hecho por ffmpeg.
- Falta en el modelo: `VIDEO_FORMATS` es `mp4 | prores`; `VideoJob.codec` es `h264 | prores`; el tamaño se redondea a par, no a múltiplo de 4 (el diseño del paso 2 lo anunció para HAP).

## Arquitectura

HAP es un tercer motor de vídeo, `hap`, que comparte con WebCodecs todo lo anterior al codificador y cambia el destino:

1. **Decodificar y dibujar**: igual que hoy (`drawFrame`, `layersAt`, `FrameCursor`). Se extrae el destino de fotogramas a una interfaz (`add(canvas, tiempo)`, `finish()`), con dos implementaciones: Mediabunny (H.264) y HAP.
2. **Leer el lienzo** a RGBA (`getImageData`) y repartir los fotogramas en un grupo de workers de codificación (`hap/pool.ts`). Cada worker comprime la textura y el snappy de un fotograma y lo devuelve; el orden se conserva. Hay un máximo de fotogramas en vuelo (el doble de workers) para acotar la memoria. Número de workers: `hardwareConcurrency - 1`, entre 1 y 6.
3. **Escribir el `.mov`** (`hap/mov.ts`), propio, a OPFS con un `FileSystemSyncAccessHandle`: cabecera `mdat` de 64 bits que se corrige al final, tablas de muestras en memoria (son pequeñas) y `moov` al terminar, con `co64` siempre para no tener tope de 4 GB. Pista de vídeo `Hap1` o `HapY` y, si hay sonido, pista de PCM intercalada por segundos.
4. **Audio**: ffmpeg lo hace como PCM crudo (`-f s16le` o `s24be`) con su cadena de siempre (ganancias, igualar volumen, cruces, velocidad) y el escritor lo mete en el `.mov` tal cual (`sowt` o `in24`). Es el mismo canal «audio aparte» del motor WebCodecs, con otro formato.
5. **Variantes**: el código de textura es una función por variante (`DXT1`, `scaled YCoCg DXT5`; `DXT5` con alfa queda como punto de extensión): la cabecera del fotograma, el contenedor y el reparto no cambian.

Módulos nuevos en `src/engine/hap/`: `dxt1.ts`, `ycocg.ts`, `snappy.ts`, `frame.ts`, `mov.ts`, `pool.ts`, `worker.ts`. Se portan del spike a TypeScript, con sus pruebas.

## Modelo

- `VIDEO_FORMATS` añade `hap`. Ajuste nuevo en `convert` y en `MixVideo`: `hapVariant: 'hap' | 'hapq'`, por defecto `hap`. Los ajustes de H.264 y ProRes no cuentan con HAP.
- `VideoJob.codec` añade `hap`; `Backend` añade `hap`.
- `MONTAGE` pasa a versión 4 con migración idéntica, como en los pasos 2 y 5.
- Tamaño de salida a múltiplo de 4 con HAP (en `fitSize`/`canvasOf`, con el aviso `size-rounded` ya existente, cuyo texto dice «par» y pasa a decir «múltiplo de 4» cuando corresponde).
- Sin aviso de memoria (`output-may-not-fit`): la salida va a disco (OPFS), no a la memoria de wasm. Si el disco se llena, el trabajo falla con «Sin memoria suficiente».
- Estimación de lentitud: coste por fotograma (Hap 0,2 s, Hap Q 0,3 s a 1080p, un núcleo) entre los workers disponibles, calibrada con el codificador ya portado.

## Selección de motor

- Un trabajo con HAP va siempre por el motor `hap`, aunque el ajuste «Motor de vídeo» diga «solo ffmpeg.wasm»: no existe alternativa. Con «solo WebCodecs» no cambia nada.
- Necesita que el navegador decodifique el códec de entrada (`VideoDecoder`); no necesita el codificador. Si no puede, el trabajo no se puede planificar: bloqueo `hap-needs-decoder` con su explicación, igual que `no-picture`. Un archivo que WebCodecs no decodifica no cae a ffmpeg (ver decisión 2).
- Una mezcla en HAP exige lo mismo para todos sus clips con imagen.
- Si el motor `hap` falla a mitad, el trabajo falla con el error; no hay motor de repuesto.

## Interfaz

- «Formato de vídeo» gana la opción HAP, en el Inspector y en las opciones de la mezcla de vídeo; con HAP aparece el selector de variante (Hap, Hap Q) y se ocultan CRF, velocidad del codificador y perfil. La explicación va en `title`.
- Con HAP, el audio de «Sonido» (profundidad y frecuencia de muestreo) se ofrece como en ProRes: PCM de 16 o 24 bits.
- Aviso de lentitud y de tamaño con los mecanismos existentes.
- Presets: ver decisión 4.

## Pruebas

- Unitarias: bloques DXT1 y YCoCg-DXT5 de casos conocidos, ida y vuelta de snappy, cabecera de fotograma (3 y 8 bytes), escritor de `.mov` (tablas, `co64`, intercalado), reparto del grupo con orden y contrapresión.
- Con ffmpeg nativo (como `mix.native.test.ts`, se omiten si no está): el `.mov` propio se decodifica y su PSNR contra el original supera el del codificador `hap` de ffmpeg menos una tolerancia; vídeo y audio con duraciones coherentes.
- e2e en Firefox: procesar un clip a HAP y a Hap Q, y una mezcla en HAP con cruce; se comprueba en el archivo descargado el fourcc, las dimensiones, el número de fotogramas y la pista de audio. Los dos motores de H.264 siguen como están.
- Calibración de la estimación de lentitud midiendo en este equipo. El móvil no se mide salvo que se pida.
- La validación contra un reproductor real queda a cargo de ffmpeg nativo, que decodifica los dos formatos; el spike ya se validó en Resolume con Hap.

## Fuera de este paso

- Hap Alpha (DXT5): ninguna fuente de WebCodecs trae alfa, así que no es alcanzable hoy; el punto de extensión queda en el modelo y en el código de textura.
- Entrada HAP: la app no lee HAP (solo lo escribe).
- 10 bits y varios fragmentos por fotograma (ver riesgos).

## Decisiones, con recomendación

1. **Hap Q en este paso.** Recomiendo incluirlo: es alcanzable (la entrada es siempre RGB), cuesta una función de textura más y es la variante de calidad que se usa en directo. Alternativa: solo Hap, y Q después; se pierde calidad en degradados y en rojos saturados, y el selector de variante se estrena en otro paso.
2. **Entrada que WebCodecs no decodifica: bloqueo con explicación, sin ffmpeg de repuesto.** Un camino por ffmpeg exigiría sacar fotogramas crudos en trozos a la memoria de wasm (8 MB por fotograma a 1080p), seekeando entre trozos: complejidad alta para un caso raro (los navegadores actuales decodifican H.264, HEVC y VP9 casi siempre). Alternativa: hacerlo, con aviso de lentitud fuerte.
3. **Audio en PCM de 16 o 24 bits dentro del `.mov`**, no AAC: es lo que Resolume y QuickTime esperan en un `.mov` de reproducción, no hace falta empaquetar nada y el 24 bits ya existe en los ajustes. Alternativa: AAC, más pequeño y con más trabajo de contenedor.
4. **Presets: dejar «Resolume» como está (ProRes HQ) y añadir uno «HAP».** Cambiar el existente sorprendería a quien ya lo usa. Alternativa: sustituirlo.

## Riesgos

- Un fotograma de 1080p tarda hasta 307 ms con un hilo en el peor caso (imágenes con mucho detalle): con N workers la mezcla de vídeo con cruces puede salir lenta en móvil. La estimación se calibra midiendo; si no basta, el codificador admite optimizar sin cambiar el formato.
- Un único fragmento por fotograma: Resolume lo reproduce bien a 1080p, pero a 4K el decodificador no puede paralelizar el snappy. Se anota como mejora posible (el formato lo admite).
- El escritor de `.mov` es propio: lo validó ffmpeg nativo y Resolume en el spike, pero solo con vídeo; el audio PCM y el intercalado se validan en este paso con ffmpeg nativo.
- Memoria en el móvil con los fotogramas en vuelo (8 MB cada uno a 1080p): el tope de dos veces el número de workers lo acota; se acota por diseño, sin medir en móvil.

## Resultado

Implementado y verificado: `tsc`, `eslint`, 363 pruebas unitarias, pruebas contra ffmpeg nativo y e2e en Firefox (clip, mezcla, sin decodificador, interfaz).

- `src/engine/hap/`: `texture.ts` (DXT1 y YCoCg-DXT5 escalado, con su inverso para pruebas), `snappy.ts`, `frame.ts`, `mov.ts` (escritor `.mov` en flujo con `co64`, PCM `sowt`, `in24` y `fl32`, lector de la cabecera WAV), `pool.ts` y `worker.ts` (grupo de workers), `sink.ts` (orden, contrapresión e intercalado del sonido por segundos).
- ffmpeg nativo (el oráculo) reconoce los dos formatos como `hap`, cuenta todos los fotogramas, lee el sonido PCM y decodifica al nivel del codificador `hap` de ffmpeg, para Hap y para Hap Q.
- Coste medido de un fotograma de 1080p con un hilo: Hap 35 a 276 ms y Hap Q 55 a 339 ms según lo cargada que esté la imagen (de plana a muy cargada). Hap Q gana de 3 a 5 dB en las imágenes con degradados y pierde de 1 a 2 dB con barras de color plano.
- El motor `hap` ignora el ajuste «Motor de vídeo»: no hay otra vía. Sin decodificador, la estimación da «sin motor», la mezcla avisa y el trabajo falla con «HAP necesita que este navegador decodifique el vídeo».
- Sonido por ffmpeg a WAV (16, 24 o 32 bits en un archivo, 24 bits en una mezcla) y de ahí al `.mov`, con los bytes girados cuando el formato del `.mov` es big-endian.
- Preset de partida «HAP» (Hap, PCM de 24 bits a 48 kHz). Quien ya tiene presets no lo recibe: solo se crea en un primer arranque.

No medido, a petición: velocidad en el móvil. No verificado: reproducción en un reproductor real (el spike se validó en Resolume, solo con Hap y sin sonido).
