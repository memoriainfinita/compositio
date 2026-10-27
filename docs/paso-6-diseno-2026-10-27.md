---
created: 2026-10-27
status: aprobado
plan: docs/plan-2026-10-27.md (fase 1, paso 6)
---

# compositio — diseño del paso 6 (archivos)

Tableros de referencia del lienzo: «Definitivo», «Inicio», «MovilArchivos», «Avisos».

## Añadir

- Soltar sobre toda la ventana, con resaltado; carpetas recorridas con subcarpetas (`webkitGetAsEntry`)
- «Elegir archivos»: selector del sistema, múltiple; única vía en móvil. Sin botón de carpeta
- Filtro: MIME de audio o vídeo, o extensión conocida; ffprobe confirma
- Orden natural por nombre dentro de cada tanda, añadida al final

## Analizar antes de añadir

- Probe de cada archivo en la cola de fondo; la tanda entra al proyecto entera, con su duración: un solo paso de deshacer
- «Analizando N archivos» con progreso mientras tanto
- Silencios de los extremos (-60 dBFS) después, en segundo plano y por detrás del trabajo del usuario; viven en la sesión; el editor los dibuja en el paso 7

## Avisos

- Más de 2 GB: no se añade; alerta con nombre, tamaño y máximo, que se puede cerrar
- No audio/vídeo o ilegible: no se añade; alerta con cuántos y cuáles
- Ya presente (mismo nombre, tamaño y fecha): se omite y se anuncia en la región para lector de pantalla
- «Modo de un solo hilo»: solo al añadir un vídeo sin multihilo

## Lista

- Fila: casilla de lote, tipo, nombre, marca «Ajustes propios» con tooltip, duración
- Cabecera: «N de M» y casilla de todos/ninguno
- Archivo activo al pulsar el nombre; el editor muestra nombre y línea técnica («FLAC · 48 kHz · 24 bit · estéreo»); la onda en el paso 7
- Botón «Quitar» sobre la selección, deshacible (no está en el lienzo)
- Selección y archivo activo son de la sesión: ni se deshacen ni se guardan
- Archivos que faltan (sesión restaurada): atenuados, «falta el archivo», no seleccionables para procesar; al soltar el archivo correcto se empareja (`pairFiles`). «Reabrir montaje» completo en el paso 10
- Pie de columna: «Soltar archivos o carpeta»; en móvil, «Añadir archivos»

## Inicio

- «Elegir archivos» y soltar funcionan
- Carga del motor con progreso en bytes («Cargando motor de audio 18 / 31 MB»): `fetch` del núcleo midiendo bytes; el service worker lo cachea y ffmpeg lo carga de caché
- «Probar con un ejemplo» sigue deshabilitado hasta el paso 11

## Pruebas

- Unitarias: filtro, orden natural, duplicados, límite de 2 GB, emparejamiento, recorrido de carpetas con entradas simuladas, línea técnica
- e2e en Firefox sobre la build, con WAV generados en la prueba: elegir, soltar archivos y carpeta, duraciones y orden, selección y contador, quitar y deshacer, alerta de no audio, sesión con un archivo que falta y emparejamiento, progreso del motor, axe
- El aviso de 2 GB solo en unitarias
