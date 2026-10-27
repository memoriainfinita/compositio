// Output file names: the pattern of step 5 and the disambiguation of names that collide in a batch.

export interface NameFields {
  /** Source file name, with or without extension. */
  name: string;
  /** Position in the batch, from 1. */
  n: number;
  /** Batch size, for the padding of {n}. */
  total: number;
  title?: string;
  artist?: string;
}

// Control characters are not valid in file names, so matching them is the point.
// eslint-disable-next-line no-control-regex
const FORBIDDEN =/[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export const stem = (name: string): string => name.replace(/\.[^./\\]+$/, '');

/** Valid on Windows, macOS, Android and in a zip. */
export function sanitize(name: string): string {
  let out = name.replace(FORBIDDEN, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (RESERVED.test(out)) out = `_${out}`;
  return out.slice(0, 200) || 'output';
}

export function applyPattern(pattern: string, f: NameFields, extension: string): string {
  const width = Math.max(2, String(f.total).length);
  const base = pattern.replace(/\{(name|n|title|artist)\}/g, (_, token: string) => {
    switch (token) {
      case 'name':
        return stem(f.name);
      case 'n':
        return String(f.n).padStart(width, '0');
      case 'title':
        return f.title || stem(f.name);
      default:
        return f.artist ?? '';
    }
  });
  return `${sanitize(base)}.${extension}`;
}

/** Keeps the first of each name and numbers the rest: `song.wav`, `song (2).wav`. Case-blind. */
export function disambiguate(names: readonly string[]): string[] {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  return names.map((name) => {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let i = 2; ; i++) {
      const candidate = `${base} (${i})${ext}`;
      if (!taken.has(candidate.toLowerCase()) && !seen.has(candidate.toLowerCase())) {
        seen.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}
