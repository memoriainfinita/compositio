---
created: 2026-10-27
status: aprobado
plan: docs/plan-2026-10-27.md (fase 1, paso 7)
---

# compositio — diseño del paso 7 (editor)

Tableros de referencia del lienzo: «Definitivo», «Claro», «Tableta», «MovilEditor».

## Sin wavesurfer.js

- wavesurfer 8.0.3 inyecta un `<style>` en su shadow DOM: la CSP (`style-src 'self'`) lo bloquea salvo nonce, inútil en una web estática
- Sus regiones no tienen `role` ni `tabindex`
- Onda propia en canvas; tiradores encima como elementos con `role="slider"`. Sale de la tabla de librerías del spec

## Onda por partes

- Trabajo `peaks` del motor: ffmpeg decodifica a mono de 16 kHz en tramos de 10 min (`-ss`/`-t`); en JS cada tramo se reduce a mínimo y máximo, 200 por segundo
- La onda aparece tramo a tramo; prioridad `view` de la cola: detrás del trabajo del usuario, delante del análisis de fondo
- Archivo sin duración en la cabecera (WebM de MediaRecorder): el probe la mide decodificando
- Picos en la sesión, como los silencios (1 h ≈ 6 MB)
- Dibujo tomado de aures: vista como intervalo de tiempo `{s, e}`; cada columna de píxel agrega mínimo y máximo de sus picos; canvas absoluto medido con `ResizeObserver`; cambio de `devicePixelRatio` vigilado

## Reproducción

- `<audio>` o `<video>` con URL blob del `File`, sin decodificar el archivo entero
- Si el navegador no lo reproduce: copia de escucha Opus con ffmpeg en segundo plano
- Archivo activo con vídeo: la imagen sobre la onda, del mismo `<video>`

## Región, fundidos y silencios

- Tiradores de entrada y salida; tiradores de fundido en las esquinas superiores de la región, rampa dibujada con su curva
- Silencios de los extremos sombreados
- Campos numéricos de entrada y salida (`m:ss.mmm`); duración y curva de cada fundido (las seis de `afade`)
- Cada arrastre, un paso de deshacer
- Con «Extraer audio» en copiar, los fundidos se muestran desactivados (el plan los ignora). Con recorte sin recodificar no: un fundido hace que el plan recodifique y avise («lossless-unavailable»)

## Zoom y vista

- Clic: mueve el cabezal
- Ctrl+rueda: zoom en el cursor; Mayús+rueda: desplaza; pellizco en móvil; botones +/−
- Franja de vista general debajo: arrastrar mueve la vista (de aures)

## Atajos

Con el foco en el editor, nunca dentro de un campo de texto:
- Espacio: reproducir y parar
- I / O: entrada y salida en el cabezal
- Flechas sobre la onda: cabezal 1 s (Mayús 10 s); ↑/↓ zoom; `0` ajustar todo
- Flechas sobre un tirador: 10 ms (Mayús 100 ms)
- Flechas sobre la región: mueven la región entera

## A/B en tiempo real

- B con Web Audio: el elemento pasa por una ganancia que hace los fundidos, salta entrada y salida (o silencios si el recorte está activo) y aplica la ganancia de normalizar
- Normalizar necesita la medición de loudnorm: en cola de fondo cuando normalizar está activo; hasta entonces B marca «sin medir»
- La conversión (frecuencia, bits, pérdida MP3) no se simula
- Conmutador A/B; cambiar mientras suena no corta la reproducción

## Móvil

- Onda a todo el ancho; tiradores con área de toque de 44 px
- Onda, A/B, entrada y salida como en `MovilEditor`; fundidos en una fila plegable

## Archivo que falta

- Sin onda ni reproducción; ediciones solo por los campos numéricos

## Pruebas

- Unitarias: reducción a picos, tiempo↔píxel con zoom, atajos, ganancia de B
- e2e en Firefox con WAV generados: onda visible, arrastre de tiradores y deshacer, I/O y flechas, campos numéricos, A/B (ganancia en el grafo), vídeo con imagen, axe en las tres disposiciones y los dos temas
