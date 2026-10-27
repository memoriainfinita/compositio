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
- El motor aún no está en el bundle de producción (la interfaz llega en el paso 5): el Worker de @ffmpeg/ffmpeg construido por Vite solo se ha probado en `spikes/`
- Interfaz: solo un marcador de posición y el aviso de versión nueva, hasta el paso 5

## Patterns

- [ffmpeg] Mezcla continua con `acrossfade` encadenado en un solo filtergraph, cada pista antes a `aresample=44100,aformat=fltp:stereo`. Confirmed 2026-10.
- [ffmpeg] Filtergraph largo a archivo con `-/filter_complex <file>` (ffmpeg 8.1.1 nativo) para no superar el límite de línea de comandos. Confirmed 2026-10.
- [ffmpeg.wasm] Es ffmpeg 5.1.4: sin `-/filter_complex`; el grafo va en línea (sin límite de argumentos) o con `-filter_complex_script`. Confirmed 2026-10.
- [ffmpeg.wasm] WORKERFS: `createDir` antes de `mount`. Confirmed 2026-10.
- [ffmpeg.wasm] core-mt con libx264: hilos explícitos (`-threads 2`); con hilos automáticos el worker aborta. Confirmed 2026-10.
- [sw] Firefox dispara `controllerchange` también en una página ya aislada por el mismo worker: recargar solo si no está aislada o si el usuario aceptó la versión. Confirmed 2026-10.
- [e2e] Playwright no intercepta `sw.js` en Firefox: las pruebas de actualización sirven `dist` con su propio servidor. Esperar el aislamiento con `waitForFunction`, que sobrevive a la recarga. Confirmed 2026-10.
- [sw] Cachés con prefijo `compositio-`: en github.io comparten CacheStorage con otras apps del mismo origen. Confirmed 2026-10.
- [ffmpeg.wasm] ffprobe sale con -1 aunque funcione: se juzga por su salida JSON. Confirmed 2026-10.
- [ffmpeg.wasm] El nivel de registro es global a la instancia (un `-v error` previo oculta loudnorm, silencedetect y progreso): cada orden fija `-loglevel`. Confirmed 2026-10.
- [ffmpeg.wasm] Tras un `exec` fallido la instancia queda rota (`Aborted()`): se desecha y se carga otra. Confirmed 2026-10.
- [ffmpeg.wasm] loudnorm seguido de aresample no negocia la distribución de canales en 5.1.4: añadir `aformat=channel_layouts=...`. Confirmed 2026-10.

## Preferences

- Firefox como navegador de pruebas
- Sin textos de ayuda visibles junto a controles; la explicación, en tooltip
- pnpm, nunca npm, si hay dependencias JS

## TODO

- [ ] Paso 1 en el Xiaomi (`spikes/` con `?run=all` por `adb reverse tcp:4173`)
- [ ] Fase 1 según `docs/plan-2026-10-27.md`; siguiente: paso 5 (armazón de la interfaz). La CSP debe permitir `'wasm-unsafe-eval'`
