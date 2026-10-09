import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { FileTail } from './tail';

describe('FileTail', () => {
  let tmp: ReturnType<typeof tempDir>;
  let file: string;
  beforeEach(() => {
    tmp = tempDir();
    file = join(tmp.dir, 'a.jsonl');
  });
  afterEach(() => tmp.cleanup());

  it('lê só linhas completas e guarda a linha parcial para o próximo ciclo', () => {
    writeFileSync(file, '{"a":1}\n{"b":');
    const t = new FileTail(file);
    expect(t.read().lines).toEqual(['{"a":1}']);
    expect(t.read().lines).toEqual([]);
    appendFileSync(file, '2}\n{"c":3}\n');
    expect(t.read().lines).toEqual(['{"b":2}', '{"c":3}']);
  });

  it('não quebra caracteres multibyte divididos entre leituras', () => {
    const line = JSON.stringify({ t: 'ação — café ☕' });
    const buf = Buffer.from(`${line}\n`);
    writeFileSync(file, buf.subarray(0, 12));
    const t = new FileTail(file);
    expect(t.read().lines).toEqual([]);
    appendFileSync(file, buf.subarray(12));
    expect(t.read().lines).toEqual([line]);
  });

  it('detecta truncamento e recomeça do início', () => {
    writeFileSync(file, 'um\ndois\n');
    const t = new FileTail(file);
    expect(t.read().lines).toEqual(['um', 'dois']);
    writeFileSync(file, 'x\n');
    const r = t.read();
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(['x']);
  });

  it('detecta arquivo substituído (rotação) mesmo maior', () => {
    writeFileSync(file, 'a\n');
    const t = new FileTail(file);
    t.read();
    rmSync(file);
    writeFileSync(file, 'novo-1\nnovo-2\n');
    const r = t.read();
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(['novo-1', 'novo-2']);
  });

  it('não trata linhas acrescentadas ao mesmo arquivo como rotação', () => {
    writeFileSync(file, 'a\n');
    const t = new FileTail(file);
    t.read();
    appendFileSync(file, 'b\nc\n');
    const r = t.read();
    expect(r.reset).toBe(false);
    expect(r.lines).toEqual(['b', 'c']);
  });

  it('informa arquivo inexistente sem lançar erro', () => {
    const t = new FileTail(join(tmp.dir, 'nao-existe.jsonl'));
    expect(t.read()).toMatchObject({ missing: true, lines: [] });
  });

  it('seekTail alinha no início da próxima linha', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `linha-${String(i).padStart(3, '0')}`);
    writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
    const t = new FileTail(file);
    const start = t.seekTail(25);
    expect(start).toBeGreaterThan(0);
    const got = t.read().lines;
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((l) => /^linha-\d{3}$/.test(l))).toBe(true);
    expect(got.at(-1)).toBe('linha-049');
  });

  it('seekTail em arquivo pequeno lê tudo', () => {
    writeFileSync(file, 'a\nb\n');
    const t = new FileTail(file);
    expect(t.seekTail(1024)).toBe(0);
    expect(t.read().lines).toEqual(['a', 'b']);
  });

  it('respeita o limite por leitura e sinaliza que há mais', () => {
    writeFileSync(file, 'aaaa\nbbbb\ncccc\n');
    const t = new FileTail(file, { maxChunk: 6 });
    const r1 = t.read();
    expect(r1.lines).toEqual(['aaaa']);
    expect(r1.more).toBe(true);
    const all = [...r1.lines];
    for (let i = 0; i < 5; i++) all.push(...t.read().lines);
    expect(all).toEqual(['aaaa', 'bbbb', 'cccc']);
  });
});
