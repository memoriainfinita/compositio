---
created: 2026-11-11
status: aprobado
plan: docs/design/fase-2-diseno-2026-11-11.md (paso 3)
---

# compositio, fase 2, diseño del paso 3: motor WebCodecs

Sin interfaz (paso 4), sin mezcla (paso 5), sin HAP (paso 6). Al acabar, un trabajo de vídeo con H.264 como salida puede ir por WebCodecs o por ffmpeg.wasm, el motor elige según lo que el navegador sepa hacer, y las dos salidas son equivalentes. ProRes y HAP siguen siendo de ffmpeg y del paso 6.

## Punto de partida y una corrección

El paso 2 tradujo el plan directamente a argumentos de ffmpeg (`pictureFilters`): no existe aún la descripción declarativa que pedía el diseño de la fase. Sin ella, un segundo traductor repetiría las reglas de recorte, ajuste de tamaño y paridad. Este paso la extrae primero.

- `describe(input)` (modelo, puro) devuelve `VideoDescription`: pista, rango y velocidad; tamaño de salida ya resuelto (orientación del archivo, anamorfismo, rotación del usuario, recorte, modo de escala, paridad); fps de salida; fundidos a negro; códec y calidad; qué audio lleva (conservar, quitar, silencio, sustituir). Los avisos de tamaño y los errores de recorte salen de aquí.
- `pictureFilters` pasa a ser el traductor a ffmpeg de esa descripción. Las órdenes que genera no cambian: lo garantizan las pruebas unitarias del paso 2, y las 29 órdenes contra ffmpeg nativo se vuelven a pasar.
- El traductor a WebCodecs consume la misma descripción.

## Dependencia y licencia

- Mediabunny 1.65.2 (MPL-2.0), añadido con pnpm y cargado con `import()` dinámico: no pesa en la primera carga de audio. Entra en el precache del service worker como los demás trozos de la app.
- Se verifica la compatibilidad MPL-2.0 con GPL-3.0 (cláusula de licencia secundaria, sección 3.3 de la MPL) leyendo el texto, y se anota en el spec.
- Se comprueba que la CSP estricta (`script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`) no bloquea ni la biblioteca ni el worker.

## Capacidades

`capabilities` (motor, async, con caché): `VideoEncoder` y `VideoDecoder` presentes y, para cada trabajo concreto, `isConfigSupported` con su códec (H.264 high), tamaño, fps y bitrate. Para decodificar, la configuración sale de la propia pista de entrada (`getDecoderConfig()` de Mediabunny), así que HEVC o AV1 sin soporte no se prometen. Sin API (Firefox de Android 159) la respuesta es «no».

## Elección de motor

`chooseBackend(description, capabilities, setting)`, función pura con su motivo:

- ProRes y HAP, o un códec de entrada que no se decodifica: ffmpeg.
- H.264 con codificador y decodificador disponibles: WebCodecs.
- Ajuste «Motor de vídeo» en los ajustes de la aplicación: `auto`, `ffmpeg`, `webcodecs`. Con `webcodecs` y sin posibilidad, el trabajo falla con un error que lo explica (sirve para diagnosticar, no cae a ffmpeg).
- En `auto`, si WebCodecs falla a mitad (decodificador o codificador que aborta), el trabajo se repite una vez por ffmpeg y el resultado lleva un aviso.
- `APP_SETTINGS` sube a versión 2 con migración identidad (la fase sube los formatos una sola vez; los de montaje y presets ya subieron en el paso 2).

## El trabajo por WebCodecs

Un solo camino de fotogramas, sin la API `Conversion` de Mediabunny: ni la velocidad, ni el fundido a negro, ni las bandas (`letterbox`) están en ella, y mantener dos caminos duplicaría las pruebas.

1. Entrada: `Input` de Mediabunny sobre el `File` (lectura por trozos, sin cargarlo entero).
2. Lectura de fotogramas decodificados del rango, en orden.
3. Cada fotograma se dibuja en un `OffscreenCanvas` del tamaño de salida: recorte y escala por los argumentos de `drawImage`, rotación y orientación por la matriz del contexto, fondo negro para las bandas, fundido con `globalAlpha` sobre negro.
4. Marca de tiempo: `(t - inicio) / velocidad`. Con fps constante el reloj de salida es una rejilla: cada fotograma de salida toma el de entrada más reciente (repite o salta, como el filtro `fps` de ffmpeg).
5. Codificación H.264 con el bitrate equivalente al CRF pedido (tabla por resolución y fps, calibrada contra ffmpeg en las pruebas de comparación) y `latencyMode: 'quality'`. Un `VideoEncoder` con cola acotada: se espera a que baje antes de leer más (memoria plana).

Todo en un `Worker` dedicado del propio sitio: la interfaz sigue viva, cancelar es `terminate()`, y la limpieza es la misma que la del lector de ffmpeg. El progreso es fotogramas de salida sobre el total.

## Audio y unión

El audio sigue en ffmpeg (normalización, fundidos, velocidad, formato). El trabajo con WebCodecs lanza antes una orden de solo audio a AAC en `.m4a` (o PCM en `.mov` si algún día la salida lo pide) con los mismos filtros del plan, y Mediabunny copia sus paquetes ya codificados a la salida junto al vídeo, sin recodificar. Duración: la del vídeo; el audio ya viene acotado (`-t`) por el plan.

**Primer trabajo del paso, antes de lo demás:** un spike pequeño que compruebe esa unión (vídeo de Mediabunny + paquetes AAC de ffmpeg a un mp4 en OPFS, reproducible y con las duraciones iguales, en Chrome y Firefox de escritorio). Si no encaja, todo trabajo de vídeo con audio va por ffmpeg y se revisa este diseño antes de seguir; la fase no se recorta, se cambia el reparto.

## Salida a OPFS

- Carpeta `compositio-out/` en OPFS; la salida se escribe con `createWritable` a un archivo, y la cola guarda el `File` respaldado en disco. Un `File` es un `Blob`: `Processed.blob` no cambia de tipo y las descargas y el zip siguen igual.
- mp4 con el `moov` al final (sin `faststart`): el modo en memoria de Mediabunny retiene la salida entera y anularía el motivo de usar OPFS, y el modo fragmentado lo leen peor los programas de directo. Son archivos para reproducir en local, no para emitir por red. Si el usuario quiere `faststart`, es una pasada de copia con ffmpeg que no se hace aquí (a decidir al diseñar la interfaz).
- «Limpiar» de «Exportaciones» borra también el archivo de OPFS; al arrancar se barren los huérfanos de sesiones anteriores. Sin cuota suficiente: error `out-of-memory`, ya traducido.

## Aviso de lentitud

Nueva advertencia `slow-video`. `estimate(description, backend)` devuelve cuántas veces la duración tardará el trabajo, con las cifras medidas (spec, «Pruebas de riesgo de vídeo») reducidas a rangos prudentes por resolución y motor. Se avisa a partir de 2 veces la duración, antes de procesar, con el mecanismo de avisos del plan y sus textos en español e inglés. Va en el paso Imagen del inspector.

## Pruebas

1. Unitarias, sin navegador: `describe` (cada modo de escala, paridad, rotación, velocidad, fundidos), traductor a ffmpeg idéntico al actual, `chooseBackend` con capacidades simuladas, tabla de bitrate, rejilla de fotogramas por fps y velocidad, `estimate`, migración de `APP_SETTINGS`.
2. Órdenes de ffmpeg contra el nativo 8.1.1: las 29 existentes.
3. Comparación de motores, en Firefox de escritorio (H.264 por software) y en Chrome (por hardware): el mismo clip y los mismos ajustes por ffmpeg.wasm y por WebCodecs; códec, tamaño, fps, duración y formato de píxel iguales; PSNR de fotogramas muestreados leídos con ffmpeg, con un umbral en el que ambos motores quedan cerca.
4. Cancelación a mitad, error forzado del codificador (con y sin `auto`), salida sin cuota, limpieza de OPFS.
5. El móvil (Xiaomi, Chrome) se mide a mano con el equipo de pruebas del spike, paso a paso y con la pantalla encendida; Firefox de Android debe elegir ffmpeg y avisar de lentitud.

## Fuera de este paso

- Cruce de clips (paso 5), interfaz (paso 4), HAP (paso 6).
- Códecs de salida distintos de H.264 por WebCodecs (HEVC, AV1, VP9): el punto de extensión es el campo de códec de la descripción; no se construyen las variantes.
- `faststart` para salidas de WebCodecs.

## Riesgos

- La unión de audio y vídeo, sin probar: de ahí que sea lo primero.
- Bitrate por CRF: WebCodecs no tiene CRF; la tabla es una aproximación y la calidad variará por contenido. La comparación contra ffmpeg dice cuánto.
- Hardware y software dan fotogramas algo distintos; «equivalentes» significa dentro del umbral, no idénticos.
- `OffscreenCanvas` 2D en worker de Firefox de escritorio: presente, pero sin medir con este uso.
- Cifras de velocidad de un solo equipo y un solo móvil.

## Resultado

Implementado y verificado: 305 pruebas unitarias, 29 órdenes contra ffmpeg 8.1.1 nativo, e2e en Firefox y Chrome (unión de audio y vídeo, ocho casos comparados con ffmpeg.wasm, cancelación sin restos en OPFS, motor automático sin WebCodecs y motor forzado que lo explica), y el worker con Mediabunny en la compilación de producción bajo la CSP estricta sin violaciones. Detalle y cifras en el spec.

Desviaciones respecto al diseño:
- No hay una función `describe`: `describePicture` (modelo, `video.ts`) resuelve la imagen y `plan` expone `JobPlan.video` (`VideoJob`) con el códec, el rango y si el trabajo es apto para WebCodecs. `pictureFilters` quedó como `ffmpegPictureFilters(describePicture(...))`.
- `JobPlan.renderAudio` genera la orden de solo audio (AAC en m4a) con los mismos filtros del plan; es lo que consume la unión.
- La estimación de lentitud es `engine.assess(file, input)`, asíncrona porque necesita las capacidades. El aviso `slow-video` y su texto existen; mostrarlo antes de procesar es del paso 4.
- Bitrate: 0,25 bits por píxel y fotograma a CRF 18 (la primera cifra, 0,15, dejaba a WebCodecs en 26 dB frente a la fuente; con 0,25 queda en ocho casos entre 0,8 y 2,2 veces el tamaño de ffmpeg).
- `removeOutput` reintenta durante dos segundos: Chrome no deja borrar el archivo hasta que el worker terminado lo suelta; lo que quede lo barre `sweepOutputs` al arrancar.
- `playwright.config.ts`: el proyecto `webcodecs-chrome` necesita Chrome instalado y se ejecuta también en la pasada completa.

Medición en el móvil hecha el 2026-11-11 con el Chrome del Xiaomi: cifras en el spec. Queda sin medir el Firefox del móvil, que por diseño usa ffmpeg.
