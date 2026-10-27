// Spanish, the reference: every other language has exactly these keys.

export interface Plural {
  one: string;
  other: string;
}

export const es = {
  'app.skip': 'Saltar al contenido',
  'app.update': 'Nueva versión: recargar',
  'header.files': 'Archivos',
  'header.undo': 'Deshacer',
  'header.redo': 'Rehacer',
  'header.montages': 'Montajes',
  'header.untitled': 'Sin título',
  'home.drop': 'Soltar audios, vídeos o una carpeta',
  'home.choose': 'Elegir archivos',
  'home.example': 'Probar con un ejemplo',
  'home.open': 'Abrir montaje',
  'files.title': 'Archivos',
  'files.count': { one: '{n} archivo', other: '{n} archivos' },
  'editor.title': 'Editor',
  'editor.empty': 'Ningún archivo elegido',
  'mix.title': 'Mezcla',
  'mix.empty': 'Sin pistas en la mezcla',
  'output.title': 'Salida',
  'output.steps': 'Pasos de salida',
  'output.extract': 'Extraer audio',
  'output.trim': 'Recortar',
  'output.normalize': 'Normalizar',
  'output.convert': 'Convertir',
  'output.output': 'Nombre y descarga',
  'output.preset': 'Preset',
  'output.process': 'Procesar',
  'output.open': 'Ajustes de salida',
  'queue.title': 'Cola',
  'queue.empty': 'Sin trabajos',
  'nav.sections': 'Secciones',
  'dialog.close': 'Cerrar',
} satisfies Record<string, string | Plural>;

export type Key = keyof typeof es;
export type Messages = { [K in Key]: (typeof es)[K] extends Plural ? Plural : string };
