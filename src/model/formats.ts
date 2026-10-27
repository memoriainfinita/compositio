// Saved formats carry their name and version. Reading an older version migrates it step by step to
// the current one; a newer version than this app knows is refused, never guessed.

import * as v from 'valibot';
import { FileEditsSchema } from './edits.ts';
import { OutputSettingsSchema } from './settings.ts';
import { ClipSchema, MixSettingsSchema } from './timeline.ts';

type Body = Record<string, unknown>;

export interface FormatDef<T> {
  format: string;
  version: number;
  schema: v.GenericSchema<unknown, T>;
  /** `migrations[n]` turns a version-n body into a version n+1 body. */
  migrations: Readonly<Record<number, (body: Body) => Body>>;
}

export type ParseError =
  | { code: 'not-json' }
  | { code: 'wrong-format'; found: unknown }
  | { code: 'bad-version'; found: unknown }
  | { code: 'too-new'; version: number }
  | { code: 'invalid'; issues: { path: string; message: string }[] };

export type ParseResult<T> = { ok: true; value: T; migratedFrom: number | null } | { ok: false; error: ParseError };

const isBody = (x: unknown): x is Body => typeof x === 'object' && x !== null && !Array.isArray(x);

export function parseDoc<T>(def: FormatDef<T>, input: unknown): ParseResult<T> {
  let doc = input;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input);
    } catch {
      return { ok: false, error: { code: 'not-json' } };
    }
  }
  if (!isBody(doc) || doc.format !== def.format) {
    return { ok: false, error: { code: 'wrong-format', found: isBody(doc) ? doc.format : undefined } };
  }
  const version = doc.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: { code: 'bad-version', found: version } };
  }
  if (version > def.version) return { ok: false, error: { code: 'too-new', version } };

  const { format: _format, version: _version, ...rest } = doc;
  let body: Body = rest;
  for (let n = version; n < def.version; n++) {
    const migrate = def.migrations[n];
    if (!migrate) return { ok: false, error: { code: 'bad-version', found: version } };
    body = migrate(body);
  }
  const parsed = v.safeParse(def.schema, body);
  if (!parsed.success) {
    const issues = parsed.issues.map((i) => ({ path: v.getDotPath(i) ?? '', message: i.message }));
    return { ok: false, error: { code: 'invalid', issues } };
  }
  return { ok: true, value: parsed.output, migratedFrom: version < def.version ? version : null };
}

export const serializeDoc = <T extends object>(def: FormatDef<T>, value: T): Body => ({
  format: def.format,
  version: def.version,
  ...value,
});

export const FileRefSchema = v.object({
  id: v.string(),
  name: v.string(),
  size: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** Duration when it was saved; helps to pair the file when the montage is reopened. */
  duration: v.nullable(v.pipe(v.number(), v.minValue(0))),
  edits: v.optional(FileEditsSchema, {}),
});
export type FileRef = v.InferOutput<typeof FileRefSchema>;

export const MontageSchema = v.pipe(
  v.object({
    name: v.optional(v.string(), ''),
    files: v.array(FileRefSchema),
    clips: v.optional(v.array(ClipSchema), []),
    mix: v.optional(MixSettingsSchema, {}),
    batch: v.optional(OutputSettingsSchema, {}),
  }),
  v.check((m) => {
    const ids = new Set(m.files.map((f) => f.id));
    return ids.size === m.files.length && m.clips.every((c) => ids.has(c.fileId));
  }, 'Every clip must point to a file, and file ids must be unique'),
);
export type Montage = v.InferOutput<typeof MontageSchema>;

export const PresetSchema = v.object({
  id: v.string(),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  settings: OutputSettingsSchema,
});
export type Preset = v.InferOutput<typeof PresetSchema>;

export const PresetsSchema = v.object({ presets: v.array(PresetSchema) });

export const AppSettingsSchema = v.object({
  language: v.optional(v.picklist(['auto', 'es', 'en']), 'auto'),
  defaultPresetId: v.optional(v.nullable(v.string()), null),
});
export type AppSettings = v.InferOutput<typeof AppSettingsSchema>;

export const MONTAGE: FormatDef<Montage> = {
  format: 'compositio.montage',
  version: 1,
  schema: MontageSchema,
  migrations: {},
};

/** Exported and imported preset files; also how presets are stored. */
export const PRESETS: FormatDef<v.InferOutput<typeof PresetsSchema>> = {
  format: 'compositio.presets',
  version: 1,
  schema: PresetsSchema,
  migrations: {},
};

export const APP_SETTINGS: FormatDef<AppSettings> = {
  format: 'compositio.settings',
  version: 1,
  schema: AppSettingsSchema,
  migrations: {},
};
