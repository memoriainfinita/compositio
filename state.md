---
created: 2026-10-27
last_updated: 2026-11-12
---

# compositio — state

Qué es verdad ahora. Lo que ya pasó vive en `state-history.md`.

## Project

Web estática en GitHub Pages, en PC y móvil, para preparar audio y vídeo de espectáculos con ffmpeg.wasm en el navegador: mezclas continuas, recortes, unir y partir, normalizar, recodificar. Licencia GPL-3.0.

## Status

- Versión 0.2.0 publicada (2026-11-12, etiqueta `v0.2.0` y release en GitHub); en `2_finished`. Fase 1 (audio) y fase 2 (vídeo, siete pasos) cerradas; cómo se llegó, en `state-history.md` y en `docs/design/`
- Vídeo: tres motores (ffmpeg.wasm, WebCodecs por Mediabunny y HAP propio); el motor se elige por capacidad detectada del navegador y la salida de WebCodecs y de HAP va a OPFS. Mediabunny es MPL-2.0, acreditado en «Acerca de» y en el README
- Mezcla de vídeo por ffmpeg.wasm en el núcleo multihilo: `-filter_complex_threads 1`, porque con el valor por defecto se cuelga en Chrome
- CI: el runner no tiene códec H.264, así que las pruebas de WebCodecs y de HAP se saltan allí y el proyecto `webcodecs-chrome` solo corre en local; las pruebas contra ffmpeg nativo también se saltan
- Capturas de la guía y del README: `scripts/screenshots.mjs` (necesita `pnpm build`, `pnpm preview --host 127.0.0.1` y ffmpeg local); las dos del README viven en `docs/`, como pide el canon de `2_finished`
- Contenido del spec confirmado: `docs/design/spec-2026-10-27.md`
- Arquitectura: GitHub Pages + ffmpeg.wasm (2026-10-27). `@ffmpeg/core` y `core-mt` instalados; `@ffmpeg/ffmpeg` y `util` llegan con el motor (paso 4)
- Sin MVP: robusta y profesional desde el principio (2026-10-27). TypeScript 6.0.3 (typescript-eslint no admite el 7) + Vite 8 + pnpm; `vendor/` archivado en `.archive/`
- Lienzo de diseño: https://claude.ai/artifact/S5yZdu4UddtHnTEpRWMAPy. Página «Diseño» al día con el spec (2026-10-27), página «Archivo» con lo superado; sin revisar por el usuario; detalle en la sección «Interfaz» del spec
- Hoja de ruta y plan de la fase 1 escritos: `docs/design/plan-2026-10-27.md`
- Librería de zip: client-zip 2.5.1 (2026-10-27)
- Service worker propio (`src/sw/`, sin vite-plugin-pwa): cabeceras COOP/COEP, app precacheada, núcleos de ffmpeg en caché al primer uso, versión nueva solo al aceptarla; la app precacheada se busca con `ignoreVary`. Sin cubrir por e2e: la recarga tras Ctrl+Mayús+R
- Silencios detectados, información del medio y selección viven en la sesión: ni se guardan ni se deshacen
- Arranque: lee ajustes y sesión de IndexedDB, autoguardado del proyecto (nunca sobre una sesión que no sabe leer) y carga del motor en segundo plano en producción (`data-engine` en `<html>`)
- CSP estricta: `<meta>` en la build y cabecera con `frame-ancestors 'none'` desde el service worker (`build/csp.ts`); sin `data:` (`assetsInlineLimit: 0`). Comprobada sin violaciones con el motor cargado
- Service worker: el núcleo de ffmpeg se sirve mientras se guarda en caché (`waitUntil`), y una segunda petición espera a que acabe de guardarse
- Probe: un archivo sin duración en la cabecera se mide decodificando (WebM de MediaRecorder)


## Patterns

- [ffmpeg] Mezcla continua con `acrossfade` encadenado en un solo filtergraph, cada pista antes a `aresample=44100,aformat=fltp:stereo`. Confirmed 2026-10.
- [ffmpeg] Filtergraph largo a archivo con `-/filter_complex <file>` (ffmpeg 8.1.1 nativo) para no superar el límite de línea de comandos. Confirmed 2026-10.
- [ffmpeg.wasm] Es ffmpeg 5.1.4: sin `-/filter_complex`; el grafo va en línea (sin límite de argumentos) o con `-filter_complex_script`. Confirmed 2026-10.
- [ffmpeg.wasm] WORKERFS: `createDir` antes de `mount`. Confirmed 2026-10.
- [ffmpeg.wasm] core-mt con un grafo `filter_complex`: `-filter_complex_threads 1`; con el valor por defecto (un hilo por procesador) la mezcla de vídeo se cuelga en Chrome y no en Firefox. Confirmed 2026-11.
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

- [webaudio] Sin dispositivo de audio (runner de CI) `AudioContext.resume()` nunca se resuelve: reproducir sin esperarlo. Confirmed 2026-10.
- [ci] El tema claro solo corre las e2e con etiqueta `@a11y` (las que pasan axe); un push que solo toca `.md` o `docs/` no lanza la CI. Confirmed 2026-10.
- [e2e] La escucha de la mezcla se comprueba por `data-time`, `data-gains` y `data-voices` de `.mix-transport`, con la salida de Web Audio por una ganancia cero (`addInitScript`). Confirmed 2026-10.
- [e2e] Un lote se procesa en el orden de la lista (natural por nombre), no en el de entrada: lo que una prueba quiera encontrar en cola debe ir después de un archivo largo. Confirmed 2026-10.

## Preferences

- Firefox como navegador de pruebas
- Sin textos de ayuda visibles junto a controles; la explicación, en tooltip
- pnpm, nunca npm, si hay dependencias JS

## TODO

- [ ] Sin comprobar en un dispositivo real: arrastre del encuadre con el dedo en un móvil, Firefox de Android más allá de H.264 por ffmpeg.wasm, HAP en un reproductor con sonido y en Hap Q, y la velocidad de HAP en el móvil
- [ ] Aparcado: desentrelazado y mapeo de tonos HDR a SDR (el plan avisa con `hdr-not-mapped`); Hap Alpha (ninguna fuente de WebCodecs trae alfa)
