---
created: 2026-11-11
status: aprobado
plan: docs/design/fase-2-diseno-2026-11-11.md (paso 4)
---

# compositio, fase 2, diseño del paso 4: interfaz de Imagen y Pistas

Sin mezcla de vídeo (paso 5) y sin HAP (paso 6). Al acabar, una persona puede abrir un vídeo, encuadrarlo, reescalarlo, rotarlo, cambiar fps y velocidad, ponerle fundidos a negro, quitarle o cambiarle el audio, sacar un fotograma y procesarlo a H.264 o ProRes, sabiendo antes cuánto va a tardar. Todo lo que el modelo y el motor ya hacen (pasos 2 y 3) se vuelve alcanzable; no se añade nada al modelo salvo lo indicado.

## Qué hay hoy

- El inspector muestra los pasos de `INSPECTOR_STEPS` (sin `picture`); `Extraer audio` solo elige pista y modo.
- El editor enseña un `<video>` si el archivo tiene imagen, pero solo existe para archivos con audio: un vídeo sin audio ve «no hay audio» y no se puede recortar.
- `Procesar` descarta los archivos que el plan rechaza y los nombra, sin decir por qué.
- Los ajustes de la aplicación (`videoEngine`) no tienen pantalla: no hay ninguna de ajustes.

## Pasos del inspector

Los pasos que se ven dependen de la salida elegida, no del archivo activo: con `extract.kind` en vídeo se ve `Imagen`; con audio, no (la imagen no pinta nada en una salida de sonido). Numeración y pestañas siguen los pasos visibles. `stepsFor(hasPicture)` ya existe para esto; el inspector lo llama con `kind === 'video'`.

**1 Pistas** (antes «Extraer audio»; la etiqueta pasa a ser «Pistas»/«Tracks»):
- `Salida`: Audio / Vídeo (`kind`). Audio es el valor por defecto: extraer el sonido de un vídeo sigue siendo lo que ocurre si no se toca nada.
- Con audio: pista de audio y modo, como hoy.
- Con vídeo: pista de audio (si hay varias), modo (recodificar / copiar sin recodificar) y `Audio del vídeo`: conservar, quitar, silencio, sustituir. Con `sustituir`, un selector de entre los otros archivos del proyecto que tienen audio (nombre y duración) y, si el elegido tiene varias pistas, su pista. Sin otros archivos, la opción sale desactivada con una nota. `replaceWith` solo se ofrece en «Solo este archivo» (un lote no puede apuntar a un archivo concreto): en el ámbito del lote, `sustituir` no se ofrece y la nota lo dice.

**2 Recortar**, **4 Volumen** y **6 Nombre** no cambian. El aviso `keyframe-cut` sale en Recortar y `audio-absent` en Pistas, como ya mapea `WARNING_STEP`.

**3 Imagen** (solo con salida de vídeo):
- Rotación: 0, 90, 180, 270 (grupo segmentado; se suma a la etiqueta de rotación del archivo).
- Encuadre: cuatro campos numéricos `x`, `y`, `ancho`, `alto` en píxeles de la imagen ya rotada, con el botón «Sin encuadre». Se activa con un interruptor; sin él `crop` es `null`. Los campos validan contra el tamaño de la imagen orientada (el modelo ya rechaza lo que se sale con `crop-outside-frame`; aquí se corrige antes de llegar a ese error). El encuadre también se dibuja sobre el fotograma del editor (ver más abajo).
- Tamaño: modo (como el original, ajustar, rellenar, bandas, estirar) y, salvo «como el original», ancho y alto con atajos 3840×2160, 1920×1080, 1280×720, 854×480. El tamaño de salida resuelto se escribe debajo («Salida: 1280×720»), con el aviso `size-rounded` si se ajusta a par.
- Velocidad de imagen: `fps` (como el original, 24, 25, 30, 50, 60 y las fraccionarias) y `speed` (0,25 a 4, con atajos 0,5 · 1 · 2).
- `Fundido a negro` (los fundidos del archivo se aplican también a la imagen; sus tiempos se editan en el editor, junto a los de audio).
- Una línea de estado, calculada con `engine.assess`: «Motor: WebCodecs» o «Motor: ffmpeg.wasm», y «Tardará unas N veces la duración». Con `slow-video`, el aviso del paso con una sugerencia («bájalo de tamaño o prueba con Chrome o Edge»); con `webcodecs-fallback` (después de procesar), su aviso.

**5 Convertir** con salida de vídeo: `Formato de vídeo` (H.264 / ProRes) arriba; con H.264, calidad (CRF 0 a 51 con una escala legible: «Alta (18)», «Media (23)», «Baja (28)» y campo libre) y velocidad del codificador (muy rápida, rápida, media, lenta); con ProRes, perfil (Proxy, LT, Estándar, HQ, 4444). Debajo, solo los campos de audio que valen para esa salida: con H.264 el audio es AAC (bitrate AAC, frecuencia, canales); con ProRes, PCM (bits, frecuencia, canales). El selector de formato de audio (`wav`, `flac`…) no se ofrece con salida de vídeo. El aviso `output-may-not-fit` sale aquí.

## El editor

- **Archivos sin audio.** El escenario se monta con imagen o con audio: un vídeo sin audio ya no se queda en «no hay audio». Sin pistas de audio no hay forma de onda; la tira del editor se dibuja con la regla de tiempo, la región (entrada y salida) y los fundidos, sin picos. Reproducir, entrada y salida (`I`, `O`), los campos de tiempo y el zoom funcionan igual. «Original» y «Resultado» se ocultan (sin audio no hay nada que comparar).
- **Imagen sobre la forma de onda.** Con un vídeo activo, la imagen se enseña girada con la rotación de `Imagen` (CSS) y con el encuadre dibujado encima: un rectángulo con cuatro esquinas y los lados que se arrastran con el puntero. El rectángulo es solo un apoyo visual para el puntero y no entra en el árbol de accesibilidad (`aria-hidden`): el camino accesible son los campos numéricos de `Imagen`, que son los mismos valores. Arrastrar y escribir se mantienen sincronizados; los pasos de arrastre respetan los pares del modelo.
- **Sacar fotograma.** Botón en el transporte con vídeo: formato (PNG / JPEG) y, opcional, «Con encuadre y tamaño de Imagen». Descarga en el momento un archivo `<nombre>-<m.ss.mmm>.png|jpg` con `engine.frame`; es una acción de la persona, no una descarga automática. Con la imagen en pausa o reproduciendo, usa el instante del cursor.
- La imagen del editor no previsualiza velocidad, fundido, escala ni bandas: el tamaño de salida resuelto, escrito en `Imagen`, dice qué saldrá. Previsualizarlo exigiría decodificar con el motor y se queda fuera.

## Procesar

- Los archivos que el plan rechaza se listan con el motivo traducido (`no-video-track`: «No tiene imagen»; `empty-range`; `crop-outside-frame`; `replace-missing`; `no-audio-track`; `silent-input`), no solo con su nombre.
- Antes de lanzar, una línea bajo el botón enumera los archivos que irán lentos («2 archivos tardarán varias veces su duración: nombre, nombre») con el motor que usará cada uno. No bloquea ni pide confirmación: un lote no debería pararse en cada vídeo, y el aviso ya está a la vista. Si el motor forzado en «WebCodecs» no puede con un archivo, el archivo aparece como rechazado con el motivo.
- La cola y «Exportaciones» ya manejan archivos grandes (OPFS, `release`): se ve el motor de cada trabajo y las advertencias de salida.

## Ajuste «Motor de vídeo»

No existe ninguna pantalla de ajustes, y este solo sirve para diagnosticar. Vive en el diálogo «Acerca de», que ya tiene el informe de errores: una sección «Motor de vídeo» con el selector (Automático, Solo ffmpeg.wasm, Solo WebCodecs), lo que el navegador declara poder hacer (codificar y decodificar H.264) y, bajo el informe, el motor de cada trabajo. El valor se guarda en `APP_SETTINGS` y lo lee el motor en cada trabajo. El informe de errores añade el valor y las capacidades.

## Presets

Los presets guardan ya `picture` y los campos de vídeo de `convert`. Los presets de arranque (primer uso) ganan dos: «H.264 1080p 25 fps (reproductor)» y «ProRes HQ (Resolume)». Quien ya usa la aplicación no los recibe (se crean solo la primera vez) y no se tocan sus presets.

## Archivos

La lista marca los archivos con imagen con un icono de vídeo y su resolución y fps (la línea técnica ya los da). Los textos de la interfaz, español e inglés; los de aviso nuevos ya existen.

## Qué se toca

- `ui/output/Inspector.tsx` (pasos `Pistas`, `Imagen`, `Convertir`; `Imagen` en un componente propio para no hinchar el archivo), `ui/steps.ts` (la visibilidad), `ui/editor/Editor.tsx` y `ui/editor/Waveform.tsx` (sin audio, imagen y encuadre, fotograma), `ui/output/process.ts` y `app/output.ts` (motivos y lentitud), `ui/About.tsx`, `ui/Files.tsx`, `model/presets` (arranque), `i18n/es.ts` y `en.ts`, `app/state` (la evaluación por archivo activo).
- Sin cambios en el modelo de ajustes ni en el motor, salvo que `assess` necesita recibir la información del archivo sustituto cuando lo hay.

## Pruebas

1. Unitarias: visibilidad de pasos por salida, validación del encuadre contra el tamaño orientado, conversión entre el rectángulo dibujado y los campos, nombre del fotograma, selección de la sustitución y su ámbito (lote o archivo), motivo traducido de cada error del plan, línea de lentitud.
2. e2e en Firefox con un vídeo pequeño generado y guardado en `e2e/fixtures` (varios segundos a 160×90 con y sin audio): abrir un vídeo, elegir salida de vídeo, rellenar `Imagen`, procesar y volver a leer la salida; vídeo sin audio en el editor; encuadre por campos y por arrastre; sacar un fotograma (descarga); sustitución del audio; el diálogo de motor forzado; motivo de rechazo.
3. axe sin infracciones en el inspector con `Imagen` y `Pistas` (tema oscuro y claro, español e inglés), en el editor con imagen y en el diálogo de motor.
4. Móvil: el mismo recorrido a ancho de teléfono (pestañas numeradas, encuadre por campos); la imagen con el encuadre arrastrable se comprueba a mano en el Xiaomi, con su confirmación.

## Fuera de este paso

- Mezcla de vídeo, miniaturas en la tira de la mezcla (paso 5).
- HAP (paso 6).
- Previsualización de velocidad, fundido o escala en el editor.
- Desentrelazado y mapeo de tonos HDR.
- Pantalla de ajustes general: hoy solo hay un ajuste, para diagnosticar.

## Riesgos

- La capa de encuadre sobre un `<video>` depende de cómo cada navegador pinta la imagen girada y con `object-fit`; hay que medir el rectángulo contra el tamaño real mostrado y no contra el tamaño del elemento.
- El editor sin forma de onda toca una pieza compleja (`Waveform`) que hoy supone audio; se prueba con la suite de editor existente antes de añadir nada.
- La estimación de lentitud usa cifras de pocos equipos; el texto dice «unas N veces», nunca un tiempo exacto.

## Resultado

Implementado y verificado: typecheck, lint, 320 pruebas unitarias y, en Firefox sobre la compilación de producción, los 7 e2e nuevos de `e2e/video.spec.ts` (vídeo sin audio en el editor, campos y rectángulo del encuadre sincronizados, giro, proceso a H.264 con lectura del resultado, fotograma, sustitución del audio, motivo de rechazo, ajuste «Motor de vídeo» recordado tras recargar) más los specs `ui`, `output`, `editor` y `files` en tema oscuro y claro, con axe sin infracciones. Dos fallos de la pasada acotada (carga del motor con dos workers) pasan al repetirlos solos. No se ha lanzado la pasada completa (`engine`, `webcodecs`): este paso no toca el motor.

Desviaciones respecto al diseño:
- La rotación es un desplegable (0°, 90°, 180°, 270°) y no un grupo segmentado: así conserva la marca de valor propio y el botón de volver al común, como el resto de ajustes. Al girar, el encuadre se recoloca dentro del nuevo marco.
- Las explicaciones van en tooltip, no en párrafos (preferencia del proyecto): por qué no sale «Sustituir» y la ayuda del motor de vídeo.
- La etiqueta de la salida es «Resultado» (Audio / Vídeo), porque «Salida» ya es el nombre de la sección.
- El rectángulo del editor escribe en el ámbito que tiene el inspector (`inspectorScope`, compartido) o, si el archivo ya tiene encuadre propio, en el del archivo.
- El inspector se partió: `output/controls.tsx` (contexto, `Setting`, `Select`, `Check`, `NumberField`), `output/Picture.tsx`, `output/SlowNotice.tsx`, `output/useAssessment.ts`, `editor/PictureFrame.tsx`.
- Los ajustes de la aplicación se guardan por primera vez (`app/settings.ts`); el informe de errores añade el motor elegido y lo que el navegador dice de WebCodecs.
- Presets de arranque: se crean solo en el primer uso; quien ya tiene su biblioteca no los recibe.
- Se corrigió el lint de `e2e/webcodecs.spec.ts` (del paso 3, no se había pasado `pnpm lint`).
- Fixtures: `e2e/fixtures/clip.mp4` (73 KB) y `clip-silent.mp4` (47 KB), 160×90, 3 s.

Sin comprobar: el arrastre del encuadre en el móvil real (a mano en el Xiaomi, con confirmación), el Firefox del móvil, y la vista previa de un archivo con etiqueta de rotación propia (se asume que el navegador la aplica, como indica `orientedSize`).
