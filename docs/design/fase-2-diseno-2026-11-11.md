# Fase 2: vídeo (diseño aprobado el 2026-11-11)

Todo lo de la sección «Vídeo» del spec sobre lo construido en la fase 1, sin recortar alcance: encuadrar, reescalar y rotar; fps y velocidad; fundido a negro; unir con cruce; sustituir o silenciar el audio; sacar un fotograma; recodificar a H.264, ProRes y HAP. Medidas que lo sustentan: «Pruebas de riesgo de vídeo» del spec.

Punto de partida: `src/model/operations.ts` escribe argumentos de ffmpeg directamente y exige una pista de audio (`no-audio-track`); el `Runner` es solo de ffmpeg; los ajustes tienen cinco pasos pensados para audio.

## Arquitectura

1. **Descripción del vídeo independiente del motor.** Los pasos de vídeo no escriben argumentos: rellenan una estructura declarativa (rango, recorte de encuadre, tamaño, rotación, fps, velocidad, fundidos, códec, calidad, qué hacer con el audio). Dos traductores la consumen: uno a órdenes de ffmpeg y otro a Mediabunny.
2. **Dos motores de vídeo, elegidos por trabajo.** WebCodecs con Mediabunny cuando el navegador codifica ese códec (`isConfigSupported`); ffmpeg.wasm en el resto (Firefox de Android, ProRes, HAP y lo que WebCodecs no exprese). Ajuste «Motor de vídeo: automático / solo ffmpeg.wasm / solo WebCodecs» para diagnosticar.
3. **El audio sigue en ffmpeg.** En un trabajo con vídeo por WebCodecs, el audio se procesa aparte y Mediabunny junta las pistas. Un trabajo con vídeo por ffmpeg sigue siendo una sola orden. Si la unión no encaja, todo el trabajo va por ffmpeg.
4. **Salida en flujo.** La de WebCodecs va a OPFS (memoria plana, sin el tope de 2 GB); la cola guarda un `File` respaldado por disco, que se limpia con «Limpiar».
5. **Aviso de lentitud antes de procesar**, con el mecanismo de avisos del plan.

## Modelo y ajustes

- Paso **Imagen** nuevo (encuadre, tamaño, rotación, fps, velocidad, fundido a negro), entre Recorte y Volumen. **Pistas** admite vídeo, solo audio, solo vídeo, y sustituir o silenciar el audio. **Formato** gana códec y calidad de vídeo.
- Los ajustes suben de versión con su migración.
- El plan deja de suponer audio: un archivo sin audio es válido.
- La mezcla acepta clips con imagen: `xfade` con el mismo tiempo que `acrossfade`, y resolución y fps igualados a un lienzo común. Un clip solo de audio en una mezcla de vídeo lleva fotogramas negros (decidido el 2026-11-11).

## Interfaz

Encuadre sobre el fotograma del editor con campos numéricos accesibles; fundido a negro junto a los de audio; «Sacar fotograma» en el editor; miniaturas en la tira de la mezcla; español e inglés; axe sin infracciones.

## Orden de trabajo (por dependencias)

1. Spike de HAP (hecho el 2026-11-11). Se planteaban dos caminos: A) código de referencia de Vidvox a wasm; B) núcleo de ffmpeg.wasm propio con `hap`. Resultado: un tercer camino, un codificador propio en JS (DXT1 + snappy + `.mov` mínimo escrito a mano), con la calidad del de ffmpeg y validado en Resolume. HAP se implementa así, en el paso 6, repartido en workers; Hap Alpha y Hap Q cambian solo el codificador de textura. Detalle en el spec, «Pruebas de riesgo de vídeo».
2. Modelo y traductor a ffmpeg, con las órdenes comprobadas contra ffmpeg nativo.
3. Motor WebCodecs: capacidades, Mediabunny, OPFS, audio aparte y unión, selección y ajuste; salidas de ambos motores comparadas. Primero se comprueba que la unión de audio y vídeo encaja.
4. Interfaz de Imagen y Pistas.
5. Mezcla de vídeo.
6. HAP (ProRes entra en el paso 2, porque es un codificador más de ffmpeg).
7. Documentación, guía y capturas.

## Riesgos

- Mediabunny es MPL-2.0 y la app GPL-3.0: compatible por la cláusula de licencia secundaria, por verificar en el paso 3. Comprobar también la CSP con él cargado.
- El `xfade` de ffmpeg entre dos 1080p no terminó en el Xiaomi (31 s en escritorio), sin causa explicada: el cruce va por WebCodecs donde exista, con aviso o menor resolución en Firefox de Android.
- Cifras de velocidad de un solo equipo y un solo móvil: los avisos usan rangos prudentes.
- HAP no tiene codificador en navegador: es la incógnita mayor y la resuelve el spike.
- Audio separado y unido con Mediabunny: sin probar.
