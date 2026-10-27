---
created: 2026-10-27
status: aprobado
plan: docs/plan-2026-10-27.md (fase 1, paso 8)
---

# compositio — diseño del paso 8 (salida)

Tableros de referencia del lienzo: «Definitivo», «InspectorDetalle», «Tableta», «MovilEditor», `PopPresets`, `PopCola`.

## Lote o archivo

- Conmutador arriba de «Salida»: Lote | Este archivo (este, solo con archivo activo)
- Lote edita `batch`; Este archivo guarda ajustes propios (solo lo distinto del lote)
- Campo propio: marca de acento y botón de volver al lote, explicación en tooltip; «Quitar ajustes propios» del archivo entero
- Todo deshacible: vive en el proyecto

## Pasos

- 1 Extraer audio: pista (del archivo activo; en lote, posición), recodificar o copiar
- 2 Recortar: quitar silencios de los extremos; sin recodificar (MP3/AAC)
- 3 Normalizar: activar; LUFS (objetivo, pico verdadero, LRA) o pico (pico objetivo)
- 4 Convertir: formato; frecuencia (origen, 44,1, 48, 88,2, 96 kHz); bits y dither (WAV y FLAC; dither al bajar a 16); canales (origen, mono, estéreo); MP3 CBR/VBR con bitrate o calidad; bitrate AAC y Opus; calidad OGG; conservar metadatos
- 5 Nombre y descarga: patrón con ejemplo del archivo activo; tokens `{name}` `{n}` `{title}` `{artist}` insertables con botones (explicación en tooltip); sueltos o zip
- Escritorio: los cinco visibles en columna con scroll; tableta y móvil: pestañas numeradas
- Avisos del plan para el archivo activo como alerta en su paso: MP3 → MP3 recodifica, recorte sin pérdida no disponible, frecuencia ajustada, fundidos acortados

## Procesar

- «Procesar N» al pie de «Salida»: N = seleccionados presentes; deshabilitado con 0
- Un trabajo de usuario por archivo con sus ajustes efectivos, su medición de loudnorm y nombres desambiguados en el lote
- Un archivo: descarga directa al terminar
- Varios: sueltos, cada uno al acabar; zip, uno al terminar el lote (client-zip)

## Cola

- Barra del pie con resumen («2 de 5 · 40 %») que abre `PopCola`
- `PopCola`: progreso por trabajo, cancelar, reintentar, descargar, error; «Descargar todo (zip)»; «Limpiar terminados»
- Resultados en memoria hasta limpiar la cola

## Presets

- Selector junto a «Procesar»: aplicar sustituye el lote, deshacible
- `PopPresets`: aplicar, guardar el lote actual, renombrar, borrar, importar y exportar JSON (`compositio.presets` con versión)
- En IndexedDB, fuera del deshacer
- Tres de partida, borrables: «WAV 48 kHz 24 bit», «Teatro: WAV 48 kHz, -14 LUFS», «MP3 320»

## Acciones rápidas

- Presets como botones en la columna de archivos, en móvil y en Inicio
- Pulsar: procesa la selección con ese preset sin tocar el lote
- Soltar archivos sobre uno: los añade y los procesa con él
- Un archivo: descarga directa

## Pruebas

- Unitarias: ajustes propios por campo y vuelta al lote; «Procesar N»; nombres del lote con patrón y desambiguación; presets (guardar, renombrar, importar con migración, versión demasiado nueva); resumen de la cola
- e2e en Firefox con WAV generados: procesar uno con descarga directa (nombre y formato, comprobado con ffprobe en el motor); lote en zip; normalizar a LUFS (cubre también la ganancia de B del paso 7); ajustes propios con marca; presets e importar/exportar; acción rápida; cancelar y reintentar; axe en las tres disposiciones y los dos temas
