---
created: 2026-11-12
status: aprobado
plan: docs/design/fase-2-diseno-2026-11-11.md (paso 7)
---

# compositio, fase 2, diseño del paso 7: documentación, guía y capturas

Último paso de la fase 2. Al acabar, quien llegue a la app o al repositorio sabe que trabaja con vídeo y cómo, y lo que dice cada documento es lo que la app hace, con lo probado y lo no probado a la vista. No cambia el comportamiento de la app, salvo el crédito de una librería (ver «Licencias»).

## Qué dice hoy y qué falta

- La guía (`docs/guide/`) y el README hablan solo de audio: «cinco pasos», «tres presets» (hay seis), mezcla en WAV o MP3. No dicen nada de imagen, encuadre, fotograma, mezcla de vídeo, H.264, ProRes ni HAP.
- `browsers.md` no sabe de WebCodecs: ni que Firefox de Android no lo tiene (medido en el spike), ni qué navegadores codifican H.264 por hardware, ni que la salida de WebCodecs y de HAP va a disco y la de ffmpeg.wasm a memoria.
- `CHANGELOG.md` tiene `[Unreleased]` vacío.
- Mediabunny (MPL-2.0) va en la aplicación y no está en «Acerca de» ni en el README. El diseño de la fase dejó «verificar la licencia» para el paso 3 y no consta que se hiciera. La licencia del paquete es MPL-2.0 y la app GPL-3.0: la MPL permite combinar con GPL (sección 3.3), siempre que se conserve su aviso y se indique dónde está su código.
- Las capturas (`scripts/screenshots.mjs`) son todas del ejemplo de audio.

## Guía

- **Página nueva `video.md`**, «Trabajar con vídeo»: abrir un vídeo; el paso Imagen (girar, encuadrar arrastrando en el editor, tamaño y modos, fotogramas por segundo, velocidad, fundidos a negro); el sonido (conservar, sustituir, silencio, sin sonido); sacar un fotograma; los tres formatos (H.264, ProRes, HAP con sus variantes) y para qué sirve cada uno; el aviso de lentitud y qué hacer; el ajuste «Quién hace el vídeo» en «Acerca de».
- **`mixing.md`**: sección «Mezcla de vídeo»: Resultado Audio o Vídeo, lienzo, ajuste de cada clip, fps, clips solo de audio (negro) y sin sonido (silencio), miniaturas y monitor, el cruce de imagen y su curva, formatos y avisos.
- **`getting-started.md` y `batches.md`**: los pasos son cinco para audio y seis para un vídeo; los presets de partida son seis; el aviso «el vídeo tardará…».
- **`browsers.md`**: tabla nueva de motores de vídeo por navegador (qué motor hace H.264, quién puede con HAP, dónde queda la salida) y lo medido en el móvil. Dice también lo que no se ha comprobado.
- **`phone.md`**: la mezcla de vídeo en el móvil (monitor sobre la lista, hoja de opciones).
- **`README.md` de la guía**: fila nueva en la tabla.
- Todo en inglés, como la guía actual.

## README, CHANGELOG, CONTRIBUTING

- **README**: primera frase (audio y vídeo, con ffmpeg.wasm y WebCodecs); secciones Output y Mix con lo de vídeo; límites (la salida de WebCodecs y de HAP no está limitada a 2 GB ni a la memoria); pila (Mediabunny); licencias.
- **CHANGELOG**: `[Unreleased]` con Added (imagen, motores, mezcla de vídeo, HAP, presets, ajuste de motor), Changed (montajes a versión 4, el tamaño de salida a múltiplo de 2 o de 4) y lo demás. No se cambia la versión: eso lo decide el usuario.
- **CONTRIBUTING**: las pruebas contra ffmpeg nativo (se omiten sin ffmpeg) y cómo correr los e2e por proyectos.

## Licencias

- «Acerca de» añade Mediabunny a su lista de librerías (`MPL-2.0`, enlace a su código).
- El README añade la línea en Stack y en License.
- Comprobar que el paquete que se distribuye conserva su aviso de licencia (el bundle de Vite lo mantiene o se añade el texto al `public/`; se mira y se resuelve en el paso).

## Capturas

`scripts/screenshots.mjs` gana un bloque de vídeo y se vuelven a hacer todas, porque la interfaz ha cambiado (mezcla con selector Audio o Vídeo, paso Imagen):

- `picture.png`: el paso Imagen de la salida con un vídeo abierto.
- `editor-video.png`: el editor con el encuadre sobre la imagen.
- `mix-video.png`: la mezcla de vídeo con miniaturas, monitor y opciones del vídeo.
- `phone-video.png`: la mezcla de vídeo en el móvil.
- Las demás se rehacen igual que hoy. `compositio-demo.png` y `compositio-desktop.png` (del README) no son del script: se dejan hasta que el usuario diga.
- Los clips de muestra los genera el propio script con el ffmpeg instalado en la máquina de quien lo corre (imágenes de prueba con color, de 640×360 y unos segundos); sin ffmpeg, el script avisa y para.

## Pruebas

Sin código nuevo. Se comprueban los enlaces y las rutas de imagen de la guía con un script de una sola vez (no entra en el repositorio), y `pnpm lint` y `pnpm test` siguen limpios. El e2e de «Acerca de» ve la entrada nueva.

## Fuera de este paso

- Versión nueva, etiqueta, publicación.
- Vídeo de demostración o imagen de cabecera del README.
- Traducir la guía al español.

## Decisiones, con recomendación

1. **Una página nueva de vídeo y secciones en las demás.** Recomiendo esto: quien viene a por vídeo lo encuentra en una sola página. Alternativa: repartirlo todo en las páginas existentes; se pierde el hilo de «qué hago con un vídeo».
2. **Clips de muestra de las capturas generados con ffmpeg en el momento.** Recomiendo esto: no añade binarios al repositorio y las imágenes salen nítidas. Alternativa: usar los dos clips de `e2e/fixtures` (160×90): sin dependencia, pero el monitor y las miniaturas salen diminutos.
3. **`browsers.md` cuenta lo no comprobado:** arrastre del encuadre en el móvil, Firefox de Android sin WebCodecs (H.264 va por ffmpeg.wasm y HAP no es posible), HAP solo validado en un reproductor con Hap y sin sonido, velocidad de HAP sin medir en móvil. Es lo que ya hace la página con los demás navegadores.

## Riesgos

- La guía puede afirmar de más: cada frase sobre un navegador sale de lo medido (spec, «Pruebas de riesgo de vídeo» y los resultados de los pasos 3 y 5) y no de lo que se supone.
- Las capturas dependen de Firefox de escritorio (con WebCodecs) y de las imágenes de prueba: si el motor elegido fuera ffmpeg, el monitor y las miniaturas tardarían más; el script espera lo necesario.

## Resultado

Hecho. `tsc`, `eslint` y 363 pruebas unitarias limpios; el e2e de «Acerca de» ve Mediabunny; los enlaces y rutas de imagen de la guía comprobados con un script de una sola vez (11 archivos, ninguno roto).

- Guía: página nueva `video.md`; secciones de vídeo en `mixing.md` y `browsers.md` (tabla de motores por navegador, lo medido y lo no comprobado); `getting-started.md`, `batches.md`, `phone.md` y el índice al día. README, CHANGELOG (`[Unreleased]`, sin versión nueva) y CONTRIBUTING al día.
- Licencias: Mediabunny (MPL-2.0) en «Acerca de» y en el README; el aviso de licencia viaja en el bundle.
- Capturas: `scripts/screenshots.mjs` genera sus clips con el ffmpeg local y hace `picture.png`, `editor-video.png`, `mix-video.png` y `phone-video.png`; todas las demás se rehicieron. `compositio-demo.png` y `compositio-desktop.png` se dejan como estaban.
- HAP en Chrome de escritorio: pasa el e2e (clip, mezcla, sin decodificador).

Sin comprobar, y dicho en la guía: arrastre del encuadre en un móvil real, Firefox de Android más allá de H.264 por ffmpeg.wasm, HAP en un reproductor con sonido y con Hap Q, velocidad de HAP en el móvil.
