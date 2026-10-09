// Plugin do Habblaud para o OpenCode: mostra no escritório, na hora, o que as sessões do OpenCode fazem (a leitura do
// banco já as mostra sem instalar nada; o plugin só adianta e completa). `npm run opencode:install` copia ESTE arquivo
// para ~/.config/opencode/plugins/habblaud.js (o OpenCode carrega sozinho os plugins dessa pasta), então ele precisa
// continuar um único arquivo ESM, só com imports `node:*`, que funciona longe do repositório.
//
// O OpenCode chama cada export de função deste arquivo como um plugin; por isso o ÚNICO export é o plugin (o resto
// fica interno).
//
// Porta e espera ficam em ~/.habblaud/opencode-hook.json ({port, permissionTimeoutS}, gravado pelo instalador);
// HABBLAUD_PORT vale como reserva (padrão 4747). O plugin:
// 1. manda para POST http://127.0.0.1:<porta>/api/opencode/events (prazo de 1,5 s, em fila para manter a ordem) só
//    os eventos session.status, session.idle, todo.updated, permission.asked, permission.updated e as ferramentas
//    (tool.execute.before/after, com o nome e um título curto, nunca o resultado);
// 2. nunca lança nem atrasa o OpenCode: todo erro é engolido e os envios não são esperados pelo OpenCode.
// Só fala com 127.0.0.1. HABBLAUD_HOOK_DEBUG=1 escreve o que acontece no stderr.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_PORT = 4747;
const CONFIG_FILE = 'opencode-hook.json';
/** Eventos mandados ao Habblaud (o que o servidor aceita em /api/opencode/events). */
const OBSERVED = new Set(['session.status', 'session.idle', 'todo.updated', 'permission.asked', 'permission.updated']);
/** Prazo do envio de um evento: o Habblaud responde na hora (e o plugin não pode atrasar o OpenCode). */
const EVENT_TIMEOUT_MS = 1_500;
/** Envios pendentes além disto são descartados (Habblaud travado: o OpenCode nunca acumula trabalho por nossa causa). */
const MAX_QUEUE = 50;
/** Textos e listas mandados ao Habblaud (o servidor só mostra prévias). */
const MAX_STRING = 1_000;
const MAX_ITEMS = 100;
/** Campos dos argumentos de uma ferramenta que servem de título curto (o primeiro que existir). */
const TITLE_FIELDS = ['filePath', 'file_path', 'path', 'pattern', 'command', 'url', 'query', 'description'];

const debug = process.env.HABBLAUD_HOOK_DEBUG === '1' ? (msg) => process.stderr.write(`[habblaud-opencode] ${msg}\n`) : () => {};
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const validPort = (p) => Number.isInteger(p) && p > 0 && p < 65_536;

/** Porta: ~/.habblaud/opencode-hook.json; sem porta no arquivo, HABBLAUD_PORT; senão o padrão. Ilegível = padrão. */
function readConfig(env = process.env) {
  let file;
  try {
    file = JSON.parse(readFileSync(join(env.HOME || homedir(), '.habblaud', CONFIG_FILE), 'utf8'));
  } catch {
    file = undefined;
  }
  const f = isObject(file) ? file : {};
  const filePort = Number(f.port);
  const envPort = Number.parseInt(env.HABBLAUD_PORT ?? '', 10);
  return { port: validPort(filePort) ? filePort : validPort(envPort) ? envPort : DEFAULT_PORT };
}

/** Corta textos longos e listas grandes. */
function trim(v, depth = 0) {
  if (typeof v === 'string') return v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v;
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => trim(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = trim(x, depth + 1);
  return out;
}

/** Título curto de uma chamada de ferramenta (arquivo, padrão, comando...), dos argumentos. */
function titleOf(args) {
  if (!isObject(args)) return undefined;
  for (const k of TITLE_FIELDS) if (typeof args[k] === 'string' && args[k].trim()) return args[k].trim().slice(0, 200);
  return undefined;
}

/** Requisição ao Habblaud local; null = fora do ar, tempo esgotado ou resposta ilegível. */
async function call(port, method, path, body, timeoutMs) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  } catch (err) {
    debug(`${method} ${path}: ${err?.name ?? 'erro'} ${err?.message ?? ''}`);
    return null;
  }
}

/** O evento do OpenCode como o Habblaud espera ({type, properties}), ou undefined se não interessa. */
function observed(event) {
  if (!isObject(event) || typeof event.type !== 'string' || !OBSERVED.has(event.type)) return undefined;
  const properties = event.properties;
  if (!isObject(properties) || typeof properties.sessionID !== 'string') return undefined;
  return { type: event.type, properties: trim(properties) };
}

export const HabblaudPlugin = async () => {
  let queue = Promise.resolve();
  let pending = 0;
  /** Põe um evento na fila de envio (em ordem, sem ninguém esperar por ele). Nunca lança. */
  const post = (event) => {
    if (!event || pending >= MAX_QUEUE) return;
    const { port } = readConfig(); // lida ao enfileirar: o evento vai para a porta de quando aconteceu
    pending++;
    queue = queue
      .then(async () => {
        const r = await call(port, 'POST', '/api/opencode/events', { event }, EVENT_TIMEOUT_MS);
        debug(`${event.type}: ${r ? `${r.status} ${JSON.stringify(r.json ?? null)}` : 'Habblaud fora do ar'}`);
      })
      .catch(() => {})
      .finally(() => {
        pending--;
      });
  };

  return {
    event: async (input) => {
      try {
        post(observed(input?.event));
      } catch (err) {
        debug(`erro: ${err?.message ?? err}`);
      }
    },
    'tool.execute.before': async (input, output) => {
      try {
        if (!isObject(input) || typeof input.sessionID !== 'string' || typeof input.tool !== 'string') return;
        const properties = { sessionID: input.sessionID, tool: input.tool.slice(0, 80), callID: typeof input.callID === 'string' ? input.callID.slice(0, 80) : undefined };
        const title = titleOf(output?.args);
        if (title) properties.title = title;
        post({ type: 'tool.execute.before', properties });
      } catch (err) {
        debug(`erro: ${err?.message ?? err}`);
      }
    },
    'tool.execute.after': async (input) => {
      try {
        if (!isObject(input) || typeof input.sessionID !== 'string' || typeof input.tool !== 'string') return;
        post({ type: 'tool.execute.after', properties: { sessionID: input.sessionID, tool: input.tool.slice(0, 80), callID: typeof input.callID === 'string' ? input.callID.slice(0, 80) : undefined } });
      } catch (err) {
        debug(`erro: ${err?.message ?? err}`);
      }
    },
  };
};
