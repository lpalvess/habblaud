// Registro da fonte do OpenCode no boot: OC-07, OC-08, OC-10, e as outras fontes seguem rodando.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountsService } from '../../accounts/service';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { tempDir } from '../../test/fixtures';
import { buildOpencodeDb, HAS_SQLITE, ocId } from '../../test/opencode-fixtures';
import { SourceSet, type AgentSource } from '../source';
import { createOpencodeSource } from './boot';

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  vi.restoreAllMocks();
  setQuiet(true);
});

function deps() {
  const t = tempDir();
  cleanups.push(t.cleanup);
  const accounts = new AccountsService({ dirs: [], home: t.dir, env: {}, now: Date.now, onChange: () => {} });
  const office = new Office({ names: new NameStore(null), version: 'teste', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
  return { accounts, office };
}

describe('createOpencodeSource', () => {
  it('OC-10: HABBLAUD_OPENCODE=0 (config.opencode false) não cria a fonte nem abre o banco', () => {
    const importer = vi.fn(async () => {
      throw new Error('não deveria importar');
    });
    expect(createOpencodeSource({ opencode: false, opencodeDir: '/qualquer' }, { ...deps(), importer })).toBeUndefined();
    expect(importer).not.toHaveBeenCalled();
  });

  it('OC-08: sem opencode.db não cria a fonte e não loga', () => {
    setQuiet(false);
    const spies = (['log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const t = tempDir();
    cleanups.push(t.cleanup);
    expect(createOpencodeSource({ opencode: true, opencodeDir: t.dir }, deps())).toBeUndefined();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it.skipIf(!HAS_SQLITE)('com o banco e ligado, cria a fonte do provider opencode', () => {
    const fx = buildOpencodeDb();
    cleanups.push(fx.cleanup);
    const src = createOpencodeSource({ opencode: true, opencodeDir: fx.dir }, deps());
    expect(src?.provider).toBe('opencode');
  });

  it.skipIf(!HAS_SQLITE)('OC-07: node:sqlite ausente loga uma linha e as outras fontes continuam no SourceSet', async () => {
    setQuiet(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fx = buildOpencodeDb();
    cleanups.push(fx.cleanup);
    fx.addSession({ id: ocId('ses', 1), directory: '/p/a' });
    const oc = createOpencodeSource(
      { opencode: true, opencodeDir: fx.dir },
      {
        ...deps(),
        importer: async () => {
          throw new Error('sem sqlite');
        },
      },
    )!;
    const started: string[] = [];
    const other: AgentSource = { provider: 'claude', start: () => void started.push('claude'), stop: () => {}, sources: () => [], transcriptPathOf: () => undefined };
    const set = new SourceSet([other, oc]);
    await set.start();
    expect(started).toEqual(['claude']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('22.13');
    expect(err).not.toHaveBeenCalled();
    expect(set.of('opencode')).toBe(oc);
    set.stop();
  });
});
