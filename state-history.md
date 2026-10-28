# compositio — history

Lo que salió de `state.md`. Se escribe solo si explica por qué las cosas son como son.

Más reciente arriba.

### 2026-10-28 — CI en rojo por el orden del lote

**Qué cambió:** «the queue cancels and retries» cancela ahora el archivo corto que espera detrás del largo.
**Por qué:** el lote se procesa en el orden de la lista (natural por nombre). La prueba cancelaba `dos.wav` (2 s), que iba primero y terminaba antes del clic; el botón desaparecía y el clic agotaba 120 s. Visto en la traza de la ejecución 40608620023: `dos.wav` descargado 30 ms después de empezar el clic.

### 2026-10-27 — La región pasa a ser del archivo

**Qué cambió:** se retira la regla «la región del editor solo se aplica con un archivo seleccionado» y la casilla «Usar la región del editor» del inspector.
**Por qué:** al revisar los flujos frente a otras herramientas, lo editado (entrada, salida, fundidos) pasa a pertenecer a cada archivo y el inspector queda solo para ajustes de salida; la ambigüedad con varios archivos desaparece.

### 2026-10-27 — Sin MVP: de HTML + JS simples a TypeScript, de vendor/ a pnpm

**Qué cambió:** la "primera versión" deja de ser una versión reducida y pasa a ser la fase 1 por dependencias. La interfaz en HTML + JS simples pasa a TypeScript + Vite + pnpm. Las librerías copiadas a `vendor/` se sustituyen por dependencias pnpm fijadas.
**Por qué:** el usuario quiere una app robusta y profesional desde el principio, para cualquiera, sin MVP ni criterios de marketing.

### 2026-10-27 — Arquitectura: de servidor local a GitHub Pages + ffmpeg.wasm

**Qué cambió:** se descarta la página local con servidor Python que llamaba al ffmpeg instalado. La web pasa a ser estática en GitHub Pages y procesa en el navegador con ffmpeg.wasm.
**Por qué:** el usuario quiere usarla en el móvil y publicarla en GitHub Pages, que no ejecuta servidor. Se aceptan los límites de ffmpeg.wasm (2 GB por archivo, memoria del navegador, más lento). Queda como opción futura un motor local opcional para trabajos grandes.
