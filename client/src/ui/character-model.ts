// Editor do personagem, parte pura (sem DOM): quando a gaveta oferece a edição, como as peças se agrupam, os rótulos
// em português e o que vai para o servidor em `parts`. A interface fica em character-editor.ts.
import { PART_KEYS, type AppearanceParts, type PartKey } from '../../../shared/appearance';
import { isDemoId } from '../../../shared/timeline';
import type { AgentInfo } from '../../../shared/types';
import type { Appearance } from '../art/api';

export interface EditGate {
  /** O agente ainda está no escritório. */
  live: boolean;
  /** meta.terminal: o Habblaud só é acessível pelo próprio computador (bind local). */
  terminal: boolean;
  /** A página foi aberta por localhost/127.x (o servidor recusa o resto). */
  local: boolean;
  replaying: boolean;
  mock: boolean;
}

/**
 * O lápis "Editar personagem" aparece? Só para o principal real, ao vivo, que não está saindo (offline: o servidor
 * responderia 404) e com acesso local (a trava do terminal).
 */
export function canEditCharacter(a: Pick<AgentInfo, 'id' | 'kind' | 'status'>, g: EditGate): boolean {
  return a.kind === 'main' && a.status !== 'offline' && g.live && g.terminal && g.local && !g.replaying && !g.mock && !isDemoId(a.id);
}

/** Peças que diferem da aparência sorteada pela seed (o que vai em `parts`), na ordem de PART_KEYS. */
export function changedParts(base: Appearance, edited: Appearance): AppearanceParts {
  const out: Record<string, string> = {};
  for (const k of PART_KEYS) {
    const v = edited[k];
    if (v !== undefined && v !== base[k]) out[k] = v;
  }
  return out as AppearanceParts;
}

export interface EditorRow {
  key: PartKey;
  label: string;
  kind: 'style' | 'color';
}

export const EDITOR_GROUPS: readonly { title: string; rows: readonly EditorRow[] }[] = [
  { title: 'Pele', rows: [{ key: 'skin', label: 'Tom', kind: 'color' }] },
  {
    title: 'Cabelo',
    rows: [
      { key: 'hairStyle', label: 'Estilo', kind: 'style' },
      { key: 'hair', label: 'Cor', kind: 'color' },
    ],
  },
  { title: 'Barba', rows: [{ key: 'facialHair', label: 'Estilo', kind: 'style' }] },
  { title: 'Olhos', rows: [{ key: 'eyes', label: 'Cor', kind: 'color' }] },
  {
    title: 'Parte de cima',
    rows: [
      { key: 'topStyle', label: 'Estilo', kind: 'style' },
      { key: 'top', label: 'Cor', kind: 'color' },
      { key: 'topAccent', label: 'Detalhe', kind: 'color' },
    ],
  },
  {
    title: 'Parte de baixo',
    rows: [
      { key: 'bottomStyle', label: 'Estilo', kind: 'style' },
      { key: 'bottom', label: 'Cor', kind: 'color' },
    ],
  },
  { title: 'Sapatos', rows: [{ key: 'shoes', label: 'Cor', kind: 'color' }] },
  {
    title: 'Acessório',
    rows: [
      { key: 'accessory', label: 'Tipo', kind: 'style' },
      { key: 'accessoryColor', label: 'Cor', kind: 'color' },
    ],
  },
];

const STYLE_LABELS: Partial<Record<PartKey, Readonly<Record<string, string>>>> = {
  hairStyle: {
    short: 'Curto', buzz: 'Raspado', spiky: 'Espetado', side_part: 'Repartido', curly: 'Cacheado', afro: 'Black power',
    bob: 'Chanel', long: 'Longo', ponytail: 'Rabo de cavalo', bun: 'Coque', pigtails: 'Maria-chiquinha', mohawk: 'Moicano',
    bald: 'Careca', wavy: 'Ondulado',
  },
  topStyle: {
    tshirt: 'Camiseta', hoodie: 'Moletom', shirt_tie: 'Camisa e gravata', sweater: 'Suéter', jacket: 'Jaqueta',
    blouse: 'Blusa', polo: 'Polo',
  },
  bottomStyle: { pants: 'Calça', shorts: 'Bermuda', skirt: 'Saia' },
  accessory: {
    none: 'Nenhum', glasses: 'Óculos', sunglasses: 'Óculos escuros', headphones: 'Fone', cap: 'Boné', beanie: 'Gorro',
    earrings: 'Brincos', bow: 'Laço',
  },
  facialHair: { none: 'Sem barba', stubble: 'Por fazer', beard: 'Barba', mustache: 'Bigode', goatee: 'Cavanhaque' },
};

/** Rótulo em português de um estilo (cabelo, roupa, acessório...). */
export function styleLabel(key: PartKey, value: string): string {
  return STYLE_LABELS[key]?.[value] ?? value;
}

/** A linha aparece com esta aparência? (sem acessório, não há cor de acessório para escolher) */
export function rowVisible(r: EditorRow, a: Pick<Appearance, 'accessory'>): boolean {
  return !(r.key === 'accessoryColor' && a.accessory === 'none');
}
