// Quando a fonte do OpenCode entra no servidor (server/index.ts): HABBLAUD_OPENCODE ligado (OC-10) e opencode.db
// existente na pasta de dados (OC-08: sem banco, nada é registrado e nada é logado). A checagem de `node:sqlite` fica na
// própria fonte (OC-07: uma linha no log, o resto segue).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DB_FILE } from './files';
import { OpencodeSource, type OpencodeSourceOptions } from './source';

export function createOpencodeSource(
  config: { opencode: boolean; opencodeDir: string; inDocker?: boolean },
  deps: Pick<OpencodeSourceOptions, 'accounts' | 'office'> & Partial<Pick<OpencodeSourceOptions, 'now' | 'pollMs' | 'watch' | 'importer'>>,
): OpencodeSource | undefined {
  if (!config.opencode) return undefined;
  if (!existsSync(join(config.opencodeDir, DB_FILE))) return undefined;
  return new OpencodeSource({ ...deps, dir: config.opencodeDir });
}
