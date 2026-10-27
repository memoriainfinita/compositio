---
created: 2026-10-27
last_updated: 2026-10-27
---

# compositio — state

Qué es verdad ahora. Lo que ya pasó vive en `state-history.md`.

## Project

Web estática en GitHub Pages, en PC y móvil, para preparar audio y vídeo de espectáculos con ffmpeg.wasm en el navegador: mezclas continuas, recortes, unir y partir, normalizar, recodificar. Licencia GPL-3.0.

## Status

- Contenido del spec confirmado: `docs/spec-2026-10-27.md`
- Arquitectura: GitHub Pages + ffmpeg.wasm (2026-10-27). `@ffmpeg/core` y `core-mt` instalados; `@ffmpeg/ffmpeg` y `util` llegan con el motor (paso 4)
- Sin MVP: robusta y profesional desde el principio (2026-10-27). TypeScript 6.0.3 (typescript-eslint no admite el 7) + Vite 8 + pnpm; `vendor/` archivado en `.archive/`
- Lienzo de diseño: https://claude.ai/artifact/S5yZdu4UddtHnTEpRWMAPy. Página «Diseño» al día con el spec (2026-10-27), página «Archivo» con lo superado; sin revisar por el usuario; detalle en la sección «Interfaz» del spec
- Hoja de ruta y plan de la fase 1 escritos: `docs/plan-2026-10-27.md`
- Paso 1 (pruebas de riesgo) hecho en Firefox de escritorio; resultados en la sección «Pruebas de riesgo» del spec. Falta el Xiaomi (sin conectar por adb)
- `spikes/`: proyecto desechable de las pruebas (pnpm + Vite, `?run=all` las lanza todas); se archiva al cerrar el paso 1
- Librería de zip: client-zip 2.5.1 (2026-10-27)
- Paso 2 hecho: repo público https://github.com/memoriainfinita/compositio (rama `main`), lint, Vitest, Playwright en Firefox (3 e2e del service worker pasan), CI con despliegue a Pages, LICENSE GPL-3.0-only, README, CONTRIBUTING, CHANGELOG
- Publicada en https://memoriainfinita.github.io/compositio/ (Pages con fuente GitHub Actions). Primera CI verde con despliegue (2026-10-27). En Firefox: aislada tras una recarga, memoria WebAssembly compartida disponible, núcleo multihilo servido con COEP; ffmpeg multihilo sin ejecutar allí hasta que el motor entre en la app (paso 4)
- Service worker propio (`src/sw/`, sin vite-plugin-pwa): cabeceras COOP/COEP, app precacheada, núcleos de ffmpeg en caché al primer uso, versión nueva solo al aceptarla. Sin cubrir por e2e: la recarga tras Ctrl+Mayús+R
- Paso 3 hecho (2026-10-27): modelo en `src/model/` sin interfaz. Medio por pistas, ediciones del archivo, línea de tiempo con transición por clip, operaciones declarativas que construyen la orden de ffmpeg (medir y aplicar al normalizar), nombres de salida, formatos con versión y migraciones (valibot 1.5.0), proyecto inmutable con deshacer de 200 pasos y gestos agrupados, IndexedDB con autoguardado. 58 pruebas unitarias del modelo (63 en total). Las órdenes generadas pasan por ffmpeg 8.1.1 nativo con tonos (script fuera del repo); sin probar aún en ffmpeg.wasm 5.1.4
- Silencios detectados, información del medio y selección viven en la sesión: ni se guardan ni se deshacen
- Paso 4 hecho (2026-10-27): motor en `src/engine/`. Ejecutor sobre ffmpeg.wasm (@ffmpeg/ffmpeg 0.12.15, núcleo de un hilo) con entradas WORKERFS, progreso por `time=`, cancelación y errores clasificados; trabajos de probe (ffprobe JSON), silencios y proceso de un plan; cola de uno en uno con prioridad del usuario; Wake Lock mientras trabaja. 90 pruebas unitarias en total; 3 e2e del motor en Firefox sobre el servidor de desarrollo, con los 11 casos de formato pasando por ffmpeg.wasm 5.1.4
- Paso 5 hecho (2026-10-27): armazón de la interfaz con Preact 11.0.1 + @preact/signals 2.11.3 (JSX compilado por Vite, sin Babel). Tema oscuro y claro según el sistema con los colores del lienzo (contraste comprobado por prueba; bordes de campo más claros que en el lienzo para llegar a 3:1); español e inglés propios; disposiciones escritorio (≥1200), tableta (768–1199) y móvil; pestañas WAI-ARIA, `<dialog>` nativo, enlace para saltar, región `aria-live`, deshacer con Ctrl+Z; Inter y JetBrains Mono de @fontsource-variable 5.3.0; logo y favicon SVG. Inicio con proyecto vacío; botones de Inicio deshabilitados hasta el paso 6
- Arranque: lee ajustes y sesión de IndexedDB, autoguardado del proyecto (nunca sobre una sesión que no sabe leer) y carga del motor en segundo plano en producción (`data-engine` en `<html>`)
- CSP estricta: `<meta>` en la build y cabecera con `frame-ancestors 'none'` desde el service worker (`build/csp.ts`); sin `data:` (`assetsInlineLimit: 0`). Comprobada sin violaciones con el motor cargado
- Paso 6 hecho (2026-10-27): archivos. Lógica pura en `src/app/intake.ts` (filtro por MIME o extensión, orden natural por ruta, duplicados por nombre, tamaño y fecha y, dentro de una tanda, también ruta; límite 2 GiB; emparejamiento; recorrido de carpetas) y sesión en `src/app/files.ts` (File, info, silencios, selección, activo, avisos; nada se guarda ni se deshace). La tanda entra entera tras el probe, en un paso de deshacer; silencios después en la cola de fondo. Soltar en toda la ventana con resaltado, «Elegir archivos», lista con casillas, «N de M», todos/ninguno, «Quitar» deshacible, archivos que faltan atenuados y emparejados al soltarlos, línea técnica en el editor, avisos de 2 GB, no audio y un solo hilo. Inicio con carga del motor en MB
- Decidido al implementar el paso 6, sin revisar por el usuario: los archivos nuevos y los emparejados entran seleccionados; el primero de la primera tanda pasa a activo; el aviso «Modo de un solo hilo» se puede cerrar (en el lienzo no tiene botón); el pie de la columna es un botón que abre el selector; la fila muestra la duración del probe y, si falta el archivo, la guardada
- Service worker: el núcleo de ffmpeg se sirve mientras se guarda en caché (`waitUntil`), y una segunda petición espera a que acabe de guardarse
- Paso 7 hecho (2026-10-27): editor en `src/ui/editor/`, diseño en `docs/paso-7-diseno-2026-10-27.md`. Onda propia en canvas (wavesurfer descartado por la CSP), picos por tramos de 10 min con ffmpeg (trabajo `peaks`, prioridad `view` de la cola), reproducción desde el archivo con copia de escucha Opus/AAC si el navegador no lo reproduce, imagen del vídeo sobre la onda, tiradores como sliders accesibles, zoom y vista general de aures, atajos, campos de tiempo y fundidos, A/B con Web Audio (medición de loudnorm en cola al usar B con normalizar)
- Probe: un archivo sin duración en la cabecera se mide decodificando (WebM de MediaRecorder)
- Decidido al implementar el paso 7, sin revisar por el usuario: Espacio reproduce también con el foco en un botón del editor; los fundidos solo se desactivan con «Extraer audio» en copiar; B usa la última medición del archivo mientras llega la nueva
- Paso 8 hecho (2026-10-27): salida, diseño en `docs/paso-8-diseno-2026-10-27.md`. Inspector con Lote / Este archivo y vuelta al lote por campo (`src/ui/output/`), avisos del plan en su paso, «Procesar N» con descarga directa, sueltos o zip (client-zip 2.5.1), cola en el pie con `PopCola` (cancelar, reintentar, descargar, zip de todo, limpiar), presets en IndexedDB con tres de partida, importar y exportar, acciones rápidas en archivos, móvil e Inicio (también al soltar archivos sobre una). Lógica en `src/app/output.ts` y `src/app/presets.ts`
- Decidido al implementar el paso 8, sin revisar por el usuario: la marca de valor propio es el punto naranja de la lista de archivos (no acento); una acción rápida aplica el preset como lote y los ajustes propios del archivo encima; un lote va en zip si algún archivo lo pide; un trabajo reintentado no se descarga solo (botón en `PopCola`); el pie de «Salida» queda fijo abajo en escritorio; nombre del zip: el del montaje o `compositio.zip`
- Paso 9 hecho (2026-10-28): mezcla, diseño en `docs/paso-9-diseno-2026-10-28.md` (sin revisar por el usuario). Orden de ffmpeg en `src/model/mix.ts` (entradas con `-ss`/`-t`, fundidos del archivo, `acrossfade` o `concat`, fundidos de la mezcla), trabajos `mixFiles` y `previewTransition` en el motor, tira y lista móvil en `src/ui/mix/` con SortableJS 1.15.7 (`forceFallback`), `PopTransicion` con escucha, tiempos CSV, aviso de memoria. Igualar volumen: ganancia lineal hacia `matchLufs` (nuevo, -14 por defecto) limitada a -1 dBTP. 15 pruebas unitarias y 5 e2e por tema
- Decidido al implementar el paso 9, sin revisar por el usuario: WAV de 24 bits y MP3 CBR 320; nombre `mezcla` sin nombre de montaje; aviso de memoria por encima de 1 GiB; en móvil, un botón «Opciones de la mezcla» en vez de las fichas de resumen del lienzo; la curva de la transición en `PopTransicion` (el lienzo no la tiene); arrastrar el solape crea una transición propia de la pista
- Paso 10 hecho (2026-10-28): montajes, diseño en `docs/paso-10-diseno-2026-10-28.md` (sin revisar por el usuario). Biblioteca en `src/app/montages.ts` sobre el almacén `montages` de IndexedDB (base de datos versión 2); `id` opcional en el montaje para sustituir al guardar; abrir es un paso de deshacer y trae los archivos de la sesión que coinciden; `PopMontajes`, guardar con nombre y `PopReabrir` en `src/ui/Montages.tsx`. Un `Dialog` desmontado abierto se cierra antes, para devolver el foco
- Decidido al implementar el paso 10, sin revisar por el usuario: «Nuevo montaje» y «Borrar» en `PopMontajes` (el lienzo no los tiene); «Guardar como nuevo» en el popup de guardar; un archivo quitado del proyecto sigue en la sesión y cuenta como encontrado al abrir un montaje que lo usa
- Paso 11 hecho (2026-10-28): PWA y cierre, diseño en `docs/paso-11-diseno-2026-10-28.md` (sin revisar por el usuario). `public/manifest.webmanifest` con iconos SVG y PNG normales y `maskable` (`scripts/icons.mjs`, a mano cuando cambie el logo); compartir a la app: el service worker guarda el POST de `./share` en la caché `compositio-share` y abre `./?share` (`src/app/share.ts`); «Probar con un ejemplo» con tres acordes de 20 s en WAV que entran también en la mezcla; «Instalar» en Inicio solo con `beforeinstallprompt`; «Acerca de» con licencias, enlaces al código de compositio, ffmpeg.wasm y FFmpeg, y «Informar de un error» (copia los detalles y enlaza a una incidencia nueva); el aviso de versión nueva en móvil queda sobre la barra inferior
- e2e: 95 en Firefox (service worker 4, interfaz 9 + archivos 7 + editor 6 + salida 8 + mezcla 5 + montajes 4 + PWA 5 en cada tema, motor 3); axe sin infracciones WCAG 2.2 AA en las tres disposiciones y los dos temas. 248 pruebas unitarias (contando cada par de contraste del tema)
- Paso 12 (2026-10-28): batería completa 93 de 95; los dos fallos repetidos solos pasan tras arreglar el contraste de `PopReabrir` en tema claro. El otro, «a file Firefox cannot play gets a copy to listen to» (editor, tema claro), falló por tiempo: es otra intermitente. Documentación en `docs/usage.md` y `docs/browsers.md` (con `[PENDING]` en lo no probado fuera de Firefox), README al día. Sin publicar: `main` va por delante de `origin` y `package.json` sigue en 0.0.0
- e2e intermitentes (2026-10-27): «a restored session…» (archivos) y las de actualización del service worker fallaron por tiempo en la batería completa; solas pasan. En la primera, el motor tardó 35-80 s en quedar listo cuando axe analizaba la página justo tras recargar, con el núcleo ya en la caché del service worker: el guardado del service worker queda descartado. Sin axe, recargar a mitad de descarga da 2-5 s. Horas después, el mismo código pasó 3 de 3, el diagnóstico 5 de 5 sin atascos y la batería completa 51 de 51. Causa sin confirmar

## Patterns

- [ffmpeg] Mezcla continua con `acrossfade` encadenado en un solo filtergraph, cada pista antes a `aresample=44100,aformat=fltp:stereo`. Confirmed 2026-10.
- [ffmpeg] Filtergraph largo a archivo con `-/filter_complex <file>` (ffmpeg 8.1.1 nativo) para no superar el límite de línea de comandos. Confirmed 2026-10.
- [ffmpeg.wasm] Es ffmpeg 5.1.4: sin `-/filter_complex`; el grafo va en línea (sin límite de argumentos) o con `-filter_complex_script`. Confirmed 2026-10.
- [ffmpeg.wasm] WORKERFS: `createDir` antes de `mount`. Confirmed 2026-10.
- [ffmpeg.wasm] core-mt con libx264: hilos explícitos (`-threads 2`); con hilos automáticos el worker aborta. Confirmed 2026-10.
- [sw] Firefox dispara `controllerchange` también en una página ya aislada por el mismo worker: recargar solo si no está aislada o si el usuario aceptó la versión. Confirmed 2026-10.
- [e2e] Playwright no intercepta `sw.js` en Firefox: las pruebas de actualización sirven `dist` con su propio servidor. Esperar el aislamiento con `waitForFunction`, que sobrevive a la recarga. Confirmed 2026-10.
- [sw] Cachés con prefijo `compositio-`: en github.io comparten CacheStorage con otras apps del mismo origen. Confirmed 2026-10.
- [ci] Playwright en CI: `playwright install firefox` sin `--with-deps`; con apt, el mirror de Azure tardó más de 12 min en Ubuntu 26 y la imagen ya trae las librerías de Firefox. Trabajos con `timeout-minutes`. Confirmed 2026-10.
- [e2e] La emulación `colorScheme` de Playwright no llega a Firefox 155: forzar el tema con la preferencia `layout.css.prefers-color-scheme.content-override` (0 oscuro, 1 claro) en `launchOptions`. Confirmed 2026-10.
- [ffmpeg.wasm] ffprobe sale con -1 aunque funcione: se juzga por su salida JSON. Confirmed 2026-10.
- [ffmpeg.wasm] El nivel de registro es global a la instancia (un `-v error` previo oculta loudnorm, silencedetect y progreso): cada orden fija `-loglevel`. Confirmed 2026-10.
- [ffmpeg.wasm] Tras un `exec` fallido la instancia queda rota (`Aborted()`): se desecha y se carga otra. Confirmed 2026-10.
- [ffmpeg.wasm] loudnorm seguido de aresample no negocia la distribución de canales en 5.1.4: añadir `aformat=channel_layouts=...`. Confirmed 2026-10.
- [e2e] `media.volume_scale` no silencia lo que sale por Web Audio: la prueba del editor pasa toda conexión a `AudioDestinationNode` por una ganancia cero (`addInitScript`). Confirmed 2026-10.
- [webaudio] `createMediaElementSource` solo una vez por elemento: un elemento de medio nuevo por cada fuente (`key={src}`). Confirmed 2026-10.
- [csp] wavesurfer.js 8 necesita nonce para su `<style>`: con `style-src 'self'` no sirve. Posiciones desde JS (`element.style`) sí están permitidas. Confirmed 2026-10.
- [css] Un `select` en una rejilla `1fr` o en un flex ensancha su contenedor hasta su opción más larga: `grid-template-columns: minmax(0, 1fr)` y `flex: 1 1 0; min-width: 0`. Confirmed 2026-10.
- [e2e] Una carpeta soltada no se puede construir desde la página: entradas con la forma de `webkitGetAsEntry` sobre un `DragEvent` con `dataTransfer` redefinido. Los File de prueba llevan `lastModified` fijo, o nunca son duplicados. Confirmed 2026-10.

## Preferences

- Firefox como navegador de pruebas
- Sin textos de ayuda visibles junto a controles; la explicación, en tooltip
- pnpm, nunca npm, si hay dependencias JS

## TODO

- [ ] Paso 1 en el Xiaomi (`spikes/` con `?run=all` por `adb reverse tcp:4173`)
- [ ] Revisión de los pasos 6 a 11 por el usuario
- [ ] e2e intermitentes por tiempo en la batería completa (ver Status): repetir cuando vuelva a fallar y medir la carga del motor tras axe
- [ ] Fase 1 según `docs/plan-2026-10-27.md`; queda del paso 12 publicar la primera versión (tras la revisión del usuario)
