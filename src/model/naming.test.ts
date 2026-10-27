import { describe, expect, it } from 'vitest';
import { applyPattern, disambiguate, sanitize } from './naming.ts';

describe('naming', () => {
  it('fills the pattern tokens', () => {
    const f = { name: 'Obertura final.mp3', n: 3, total: 12, title: 'Obertura', artist: 'Banda' };
    expect(applyPattern('{name}', f, 'wav')).toBe('Obertura final.wav');
    expect(applyPattern('{n} - {title}', f, 'wav')).toBe('03 - Obertura.wav');
    expect(applyPattern('{artist} - {title}', { ...f, artist: undefined }, 'flac')).toBe('- Obertura.flac');
    expect(applyPattern('{n}', { ...f, n: 7, total: 150 }, 'wav')).toBe('007.wav');
  });

  it('makes names valid everywhere', () => {
    expect(sanitize('a/b:c*?.')).toBe('a_b_c__');
    expect(sanitize('con')).toBe('_con');
    expect(sanitize('  ')).toBe('output');
    expect(sanitize('Canción ñ')).toBe('Canción ñ');
  });

  it('numbers names that collide, ignoring case', () => {
    expect(disambiguate(['cancion.wav', 'Cancion.wav', 'otra.wav', 'cancion.wav'])).toEqual([
      'cancion.wav',
      'Cancion (2).wav',
      'otra.wav',
      'cancion (3).wav',
    ]);
    expect(disambiguate(['a.wav', 'a.wav', 'a (2).wav'])).toEqual(['a.wav', 'a (3).wav', 'a (2).wav']);
  });
});
