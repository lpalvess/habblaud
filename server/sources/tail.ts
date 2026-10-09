// Leitura incremental de arquivos append-only (JSONL): devolve só as linhas completas novas,
// guarda a linha parcial para o próximo ciclo e detecta truncamento/rotação.
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';

export interface TailRead {
  lines: string[];
  /** O arquivo foi truncado ou substituído: a leitura recomeçou do início. */
  reset: boolean;
  /** O arquivo não existe (ainda ou mais). */
  missing: boolean;
  /** Ainda há bytes não lidos (o limite por leitura foi atingido). */
  more: boolean;
}

const NL = 0x0a;

export class FileTail {
  /** Próximo byte a ler. */
  offset = 0;
  size = 0;
  mtimeMs = 0;
  private partial: Buffer | null = null;
  private ino: number | undefined;
  /** Momento de criação do arquivo (0 quando o sistema de arquivos não informa). */
  private birthtimeMs = 0;
  private readonly maxChunk: number;

  constructor(
    readonly path: string,
    opts: { maxChunk?: number } = {},
  ) {
    this.maxChunk = opts.maxChunk ?? 8 * 1024 * 1024;
  }

  /**
   * Posiciona a leitura nos últimos `maxBytes` do arquivo, alinhada no início da linha seguinte
   * (a linha cortada é descartada). Devolve o offset escolhido (0 = arquivo inteiro).
   */
  seekTail(maxBytes: number): number {
    this.partial = null;
    let fd: number;
    try {
      fd = openSync(this.path, 'r');
    } catch {
      this.offset = 0;
      return 0;
    }
    try {
      const st = fstatSync(fd);
      this.ino = st.ino;
      this.birthtimeMs = st.birthtimeMs;
      this.size = st.size;
      this.mtimeMs = st.mtimeMs;
      if (st.size <= maxBytes) {
        this.offset = 0;
        return 0;
      }
      // Procura a primeira quebra de linha a partir de (início da janela - 1).
      let pos = st.size - maxBytes - 1;
      const buf = Buffer.allocUnsafe(64 * 1024);
      while (pos < st.size) {
        const n = readSync(fd, buf, 0, buf.length, pos);
        if (n <= 0) break;
        const i = buf.subarray(0, n).indexOf(NL);
        if (i !== -1) {
          this.offset = pos + i + 1;
          return this.offset;
        }
        pos += n;
      }
      this.offset = st.size;
      return this.offset;
    } finally {
      closeSync(fd);
    }
  }

  /** Posiciona no fim do arquivo (só o que for escrito daqui em diante será lido). */
  seekEnd(): void {
    this.partial = null;
    try {
      const st = statSync(this.path);
      this.ino = st.ino;
      this.birthtimeMs = st.birthtimeMs;
      this.size = st.size;
      this.mtimeMs = st.mtimeMs;
      this.offset = st.size;
    } catch {
      this.offset = 0;
    }
  }

  /**
   * O arquivo foi trocado por outro? O inode diferente basta, mas o sistema de arquivos pode reaproveitar o
   * número de um arquivo apagado: por isso, quando os dois lados informam o momento de criação, ele também conta.
   */
  private replaced(st: { ino: number; birthtimeMs: number }): boolean {
    if (this.ino === undefined) return false;
    if (st.ino !== this.ino) return true;
    return this.birthtimeMs > 0 && st.birthtimeMs > 0 && st.birthtimeMs !== this.birthtimeMs;
  }

  read(): TailRead {
    let fd: number;
    try {
      fd = openSync(this.path, 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { lines: [], reset: false, missing: true, more: false };
      throw err;
    }
    try {
      const st = fstatSync(fd);
      let reset = false;
      if (this.replaced(st) || st.size < this.offset) {
        this.offset = 0;
        this.partial = null;
        reset = true;
      }
      this.ino = st.ino;
      this.birthtimeMs = st.birthtimeMs;
      this.size = st.size;
      this.mtimeMs = st.mtimeMs;
      const avail = st.size - this.offset;
      if (avail <= 0) return { lines: [], reset, missing: false, more: false };
      const len = Math.min(avail, this.maxChunk);
      const chunk = Buffer.allocUnsafe(len);
      const n = readSync(fd, chunk, 0, len, this.offset);
      this.offset += n;
      const data = this.partial ? Buffer.concat([this.partial, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      const lines: string[] = [];
      let start = 0;
      for (let i = data.indexOf(NL, start); i !== -1; i = data.indexOf(NL, start)) {
        const line = data.toString('utf8', start, i).replace(/\r$/, '');
        if (line.trim()) lines.push(line);
        start = i + 1;
      }
      // Copia o resto para não segurar o buffer grande inteiro na memória.
      this.partial = start < data.length ? Buffer.from(data.subarray(start)) : null;
      return { lines, reset, missing: false, more: avail > len };
    } finally {
      closeSync(fd);
    }
  }
}
