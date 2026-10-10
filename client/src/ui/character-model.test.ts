import { describe, expect, it } from 'vitest';
import { ACCESSORIES, BOTTOM_STYLES, FACIAL_HAIR, HAIR_STYLES, PART_KEYS, TOP_STYLES } from '../../../shared/appearance';
import { appearanceFromSeed } from '../art/character/appearance';
import { canEditCharacter, changedParts, EDITOR_GROUPS, rowVisible, styleLabel } from './character-model';

const OPEN = { live: true, terminal: true, local: true, replaying: false, mock: false };
const MAIN = { id: '.claude:1', kind: 'main', status: 'working' } as const;

describe('canEditCharacter', () => {
  it('só o principal real, ao vivo, com acesso local (fora do timelapse e do mock)', () => {
    expect(canEditCharacter(MAIN, OPEN)).toBe(true);
    expect(canEditCharacter({ ...MAIN, id: 's:sub', kind: 'sub' }, OPEN)).toBe(false);
    expect(canEditCharacter({ ...MAIN, id: 'demo:x-1' }, OPEN)).toBe(false);
    for (const k of ['live', 'terminal', 'local'] as const) expect(canEditCharacter(MAIN, { ...OPEN, [k]: false })).toBe(false);
    for (const k of ['replaying', 'mock'] as const) expect(canEditCharacter(MAIN, { ...OPEN, [k]: true })).toBe(false);
  });

  it('quem está saindo (offline, nos 20 s de graça) não ganha o lápis; os outros status, sim', () => {
    expect(canEditCharacter({ ...MAIN, status: 'offline' }, OPEN)).toBe(false);
    for (const status of ['idle', 'waiting', 'shell'] as const) expect(canEditCharacter({ ...MAIN, status }, OPEN), status).toBe(true);
  });
});

describe('changedParts', () => {
  it('só as peças diferentes da aparência da seed, na ordem fixa', () => {
    const base = appearanceFromSeed(3, { look: 'm' });
    const skin = base.skin === '#5a3623' ? '#ffe2cc' : '#5a3623';
    const topStyle = base.topStyle === 'jacket' ? 'polo' : 'jacket';
    const parts = changedParts(base, { ...base, topStyle, skin });
    expect(parts).toEqual({ skin, topStyle });
    expect(Object.keys(parts)).toEqual(['skin', 'topStyle']);
    expect(changedParts(base, { ...base })).toEqual({});
  });

  it('a ordem vem de PART_KEYS, não da ordem das chaves da aparência editada', () => {
    const base = appearanceFromSeed(3, { look: 'm' });
    const shoes = base.shoes === '#101010' ? '#ffffff' : '#101010';
    const bottomStyle = base.bottomStyle === 'skirt' ? 'pants' : 'skirt';
    // No literal da aparência `shoes` vem antes de `bottomStyle`; em PART_KEYS é o contrário.
    expect(Object.keys(base).indexOf('shoes')).toBeLessThan(Object.keys(base).indexOf('bottomStyle'));
    expect(PART_KEYS.indexOf('bottomStyle')).toBeLessThan(PART_KEYS.indexOf('shoes'));
    expect(Object.keys(changedParts(base, { ...base, shoes, bottomStyle }))).toEqual(['bottomStyle', 'shoes']);

    // Mesmo com as chaves da editada em ordem invertida, o resultado segue a ordem de PART_KEYS.
    const skin = base.skin === '#5a3623' ? '#ffe2cc' : '#5a3623';
    const topStyle = base.topStyle === 'jacket' ? 'polo' : 'jacket';
    const reversed = Object.fromEntries(Object.entries({ ...base, shoes, bottomStyle, topStyle, skin }).reverse()) as unknown as typeof base;
    expect(Object.keys(reversed).indexOf('shoes')).toBeLessThan(Object.keys(reversed).indexOf('skin'));
    expect(Object.keys(changedParts(base, reversed))).toEqual(['skin', 'topStyle', 'bottomStyle', 'shoes']);
  });
});

describe('grupos e rótulos do editor', () => {
  it('todas as peças aparecem uma vez no editor', () => {
    const keys = EDITOR_GROUPS.flatMap((g) => g.rows.map((r) => r.key));
    expect([...keys].sort()).toEqual([...PART_KEYS].sort());
  });

  it('todo estilo tem rótulo em português', () => {
    const lists = { hairStyle: HAIR_STYLES, topStyle: TOP_STYLES, bottomStyle: BOTTOM_STYLES, accessory: ACCESSORIES, facialHair: FACIAL_HAIR } as const;
    for (const [key, values] of Object.entries(lists)) {
      for (const v of values) expect(styleLabel(key as keyof typeof lists, v), `${key}=${v}`).not.toBe(v);
    }
  });

  it('a cor do acessório some quando não há acessório', () => {
    const color = EDITOR_GROUPS.flatMap((g) => g.rows).find((r) => r.key === 'accessoryColor')!;
    expect(rowVisible(color, { accessory: 'none' })).toBe(false);
    expect(rowVisible(color, { accessory: 'cap' })).toBe(true);
  });
});
