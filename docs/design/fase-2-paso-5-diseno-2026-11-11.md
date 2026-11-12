---
created: 2026-11-11
status: aprobado
plan: docs/design/fase-2-diseno-2026-11-11.md (paso 5)
---

# compositio, fase 2, diseño del paso 5: mezcla de vídeo

Sin HAP (paso 6) ni documentación (paso 7). Al acabar, una mezcla puede llevar clips con imagen y generar un vídeo: cruce de imagen con el mismo tiempo y la misma curva que el de audio, un lienzo común, fundido a negro de entrada y salida, y el audio de la mezcla de hoy (ganancias, igualar volumen, cruces) como pista de sonido.

## Qué hay hoy

- La mezcla es solo de audio: `mixPlan` (modelo) arma una orden de ffmpeg con `acrossfade` o `concat`, y `mixFiles` la ejecuta. Salida WAV o MP3.
- `Clip.kind` ya distingue `audio` y `video` y el diseño de fase 2 ya fija la regla: un clip solo de audio en una mezcla de vídeo lleva fotogramas negros.
- `layout` garantiza que un cruce no pasa de lo que miden los dos vecinos: como mucho dos clips suenan a la vez.
- El motor de WebCodecs (paso 3) hace vídeo de un solo archivo: decodifica, dibuja en un `OffscreenCanvas`, codifica H.264 y escribe a OPFS; el audio llega aparte como AAC desde ffmpeg y se une por paquetes.
- La reproducción de la mezcla usa un `<audio>` por clip cerca del cursor; la tira muestra la forma de onda de cada clip.

## Modelo

- `MixSettings.kind`: `audio` (por defecto: nada de lo guardado cambia) o `video`.
- `MixSettings.video`: formato (`mp4` H.264 o `prores`), calidad (CRF, velocidad del codificador, perfil de ProRes, como en `convert`), lienzo (`first` por defecto, que toma el tamaño y los fps del primer clip con imagen, o un tamaño fijo con los atajos de «Imagen»), modo de ajuste al lienzo (ajustar con bandas, rellenar, estirar) y fps.
- `Transition.style`: `dissolve`, único valor hoy. Es el punto de extensión para otros cruces (cortinillas, etc.); el audio no lo usa.
- Cada clip aporta de su archivo la imagen con su rotación y su encuadre, los fundidos a negro y el recorte; el tamaño, los fps y la velocidad de «Imagen» no cuentan en la mezcla: el lienzo manda. Un archivo con velocidad distinta de 1 sale con el aviso `mix-ignores-speed`.
- Clip con imagen y sin audio, en mezcla de vídeo: silencio durante su duración (hoy daría `no-audio-track`). En mezcla de audio sigue dando el error.
- Versión de `MONTAGE` a 3 con migración idéntica, como en el paso 2.

## Traductor a ffmpeg (también el camino de ProRes)

- Cadena de vídeo por clip: recorte, geometría de «Imagen» hasta el lienzo, fundidos a negro, fps. Los cruces con `xfade=fade` del mismo tiempo que `acrossfade`; los cortes secos con `concat`. Un clip solo de audio es una fuente negra (`color`) de su duración.
- `xfade` solo ofrece la mezcla lineal: con una curva de cruce distinta de `tri`, el aviso `video-curve-linear`. El audio conserva su curva.
- Se comprueban las órdenes contra ffmpeg nativo como en el paso 2, con casos de dos y tres clips, corte seco, clip negro y clip mudo.
- El `xfade` entre dos 1080p no terminó en el Xiaomi (31 s en escritorio): el aviso `slow-video` y la preferencia por WebCodecs lo cubren.

## Motor WebCodecs

- Petición nueva al worker: lista de segmentos (archivo, inicio y duración en el archivo, colocación y solape en la mezcla, geometría resuelta, fundidos) y el lienzo. El audio es el de `mixPlan` en AAC dentro de un m4a, que se une por paquetes como en el paso 3; un hueco de silencio es parte de ese audio.
- Para cada fotograma de la rejilla de salida: se toma el fotograma de cada clip activo con la lógica de `resample` ya existente, se dibuja el clip entrante con transparencia según la curva del cruce sobre el saliente, y los fundidos de la mezcla actúan sobre el conjunto. Como mucho dos decodificadores a la vez.
- La curva del cruce de imagen es la misma función que usa el audio, en el modelo (`curveGain`), por lo que ambos motores y los dos sentidos del cruce coinciden. Un clip solo de audio dibuja negro.
- Elección de motor como en un archivo (`chooseBackend`): WebCodecs si codifica H.264 y decodifica todos los archivos; ffmpeg en ProRes y en lo que WebCodecs no exprese, con `webcodecs-fallback` si falla a medias. Cancelar y limpiar OPFS igual que hoy.
- Salida en OPFS, sin tope de memoria; la de ffmpeg avisa con `output-may-not-fit`.

## Interfaz

- **Opciones de la mezcla:** «Resultado: Audio o Vídeo». Con vídeo: formato, calidad, lienzo, modo y fps; desaparecen WAV y MP3 y el aviso de memoria de WAV. El audio del vídeo usa la frecuencia de la mezcla.
- **Tira de la mezcla:** los clips con imagen muestran un fotograma de su primer instante dentro del recorte, junto a la forma de onda. Se sacan con Mediabunny (`CanvasSink`) y, si el navegador no decodifica el archivo, con `engine.frame` en segundo plano. Un clip solo de audio en mezcla de vídeo lleva una marca de «negro».
- **Monitor de la mezcla:** sobre la tira, la imagen en la posición del cursor con la proporción del lienzo; durante un cruce se ven los dos clips con la opacidad de la curva. Cada clip de imagen reproduce desde un `<video>` que además da su audio por Web Audio, como el `<audio>` de hoy. Respeta el modo de ajuste y la rotación; no previsualiza el encuadre, los fundidos a negro ni la velocidad. La vista previa de un cruce (`TransitionDialog`) sigue siendo de audio: el monitor con el cursor sobre el cruce hace de vista previa de imagen.
- «Generar» da `mezcla.mp4` o `mezcla.mov`; la lista de tiempos en CSV no cambia. Español e inglés, axe sin infracciones, móvil con el monitor encima de la lista.
- Bloqueos nuevos en «Generar»: `no-picture` (mezcla de vídeo sin ningún clip con imagen).

## Qué se toca

`model/timeline.ts` (ajustes, `Transition.style`, `curveGain`), `model/mix.ts` (plan de vídeo y sonido de los clips mudos), `model/formats.ts` (versión), `engine/jobs.ts`, `engine/webcodecs/*` (petición de mezcla y worker), `app/mix.ts`, `ui/mix/*` (opciones, tira, monitor, reproductor), `i18n`, pruebas.

## Pruebas

1. Unitarias: curva compartida (audio y vídeo), selección de clips activos y opacidad por fotograma, plan de ffmpeg de vídeo (dos y tres clips, corte, negro, mudo), bloqueos y avisos, migración de montajes.
2. Órdenes contra ffmpeg nativo, con comprobación de duración y tamaño.
3. e2e en Firefox con los clips pequeños de `e2e/fixtures` y un tono: generar una mezcla de vídeo por WebCodecs y otra por ffmpeg forzado, leer el resultado (duración, lienzo, audio); miniaturas en la tira; monitor con cursor sobre un cruce; axe en ambos temas; móvil. Comparación de ambos motores por PSNR en un fotograma de cruce.
4. Medida en el Xiaomi con Chrome, paso a paso y con tu confirmación: mezcla de tres clips de 1080p.

## Fuera de este paso

HAP (paso 6); cruces distintos del fundido; velocidad por clip; previsualizar encuadre, fundidos o velocidad en el monitor; desentrelazado y HDR.

## Decisiones, con recomendación

1. **Curvas del cruce de imagen en ffmpeg.** Recomiendo `xfade` lineal con aviso: es sencillo y probado; la alternativa, `blend` con la curva exacta, es una cadena más larga y más lenta en wasm. WebCodecs sí respeta la curva.
2. **Monitor en este paso.** Recomiendo incluirlo: sin él no se puede juzgar una mezcla de vídeo antes de esperar a generarla. La alternativa es solo miniaturas, que deja ciego el cruce.
3. **Lienzo por defecto.** Recomiendo `first` (tamaño y fps del primer clip con imagen): casi siempre es lo que se espera y no impone 1080p a quien trabaja a otra resolución.
4. **Velocidad por clip.** Se ignora en la mezcla con aviso: cambiaría las duraciones del montaje y los cruces.

## Riesgos

- Dos decodificadores y un codificador a la vez en el móvil: se mide en el Xiaomi.
- Encaje de la duración del audio AAC con la rejilla de fotogramas de salida: la unión del paso 3 lo resolvió para un archivo; aquí hay que comprobar cruces y huecos.
- El monitor depende de que el navegador reproduzca los archivos; los que no (como un AIFF) usan la copia de escucha de audio y, sin imagen reproducible, muestran negro.
- Las cifras de velocidad vienen de pocos equipos: el aviso dice «unas N veces».

## Resultado

Hecho y verificado: pruebas unitarias, órdenes contra ffmpeg nativo (`src/model/mix.native.test.ts`, se salta sin ffmpeg), e2e en Firefox de escritorio y móvil con axe limpio, y comparación de los dos motores. Sin medir todavía en el Xiaomi.

Cambios respecto al diseño:

- **Ajuste al lienzo:** `letterbox` (bandas), `fill` y `stretch`; sin `fit`, que deja clips de tamaños distintos y `xfade` los exige iguales. Por defecto, bandas.
- **Opciones de vídeo:** una fila propia dentro de las opciones de la mezcla (formato, calidad CRF y velocidad del codificador o perfil de ProRes, lienzo, tamaños habituales, ajuste, fps). Las explicaciones van en `title`, no en texto visible. El audio del vídeo es AAC a 256 kbps (H.264) o PCM de 24 bits (ProRes); la frecuencia es la de la mezcla.
- **Fundidos de la mezcla:** también llevan la imagen a negro, en línea recta (la curva es la del sonido). Los del archivo (`fadeToBlack`) siguen valiendo por clip.
- **Cruces en WebCodecs:** cada clip se dibuja sobre negro con sus fundidos y el entrante se mezcla encima con la opacidad de `curveGain`, igual que ffmpeg encadena fundido y cruce; así el resultado coincide con `xfade` en `tri`. Una capa auxiliar solo existe mientras hay dos clips en pantalla, y cada decodificador se libera al terminar su clip.
- **Avisos:** `mix-ignores-speed` y `video-curve-linear` son avisos del modelo (`Warning`), salen con el resultado como los demás. `video-curve-linear` solo se da con ffmpeg: con WebCodecs el cruce sigue la curva. La lentitud se avisa antes de generar (`mix-slow`) con el motor que se usaría y las veces estimadas.
- **Clips sin sonido en mezcla de vídeo:** `anullsrc` dentro del filtro, sin entrada extra; no se miden para igualar volumen.
- **Monitor:** dos `<video>` apilados que además dan el sonido por Web Audio; los clips solo de audio no pintan. En móvil queda sobre la lista; las miniaturas de la tira solo existen en escritorio, que es donde hay tira.
- **Miniaturas:** `CanvasSink` de Mediabunny; si el navegador no decodifica el archivo, `engine.frame`. Se guardan como URLs de objeto durante la sesión.
- **Motor y capacidades:** `chooseBackend` solo mira `portable`; la mezcla en mp4 usa WebCodecs si codifica el lienzo y decodifica todos los clips con imagen, y ffmpeg en ProRes o si falla (`webcodecs-fallback`).

Medidas (Firefox, ambos motores sobre las mismas entradas, PSNR de ffmpeg contra WebCodecs): cruce lineal 29,1 dB; corte seco con un clip negro 29,1 dB; lienzo fijo 256×256 relleno, curva `qsin` y fundidos 26,4 dB. Duraciones a menos de 0,05 s.

Xiaomi (Chrome, tres clips de 1080p a 30 fps de 10 s, mezcla de 26 s con cruces de 2 s): WebCodecs 27,8 s (unas 1,07 veces la duración, mp4 de 37 MB); ffmpeg.wasm no terminó en 480 s (más de 18 veces). La estimación de ffmpeg para mezclas (3 veces) se queda corta con `xfade` a 1080p; pendiente decidir si se sube el factor o se avisa más fuerte.
