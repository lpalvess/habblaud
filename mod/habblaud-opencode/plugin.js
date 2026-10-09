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
// 2. nunca lança nem atrasa o OpenCode: todo erro é engolido e os envios não são esperados pelo OpenCode;
// 3. nos pedidos de permissão (permission.asked, ou permission.updated nas versões 1.x antigas): registra o pedido em
//    POST /api/permissions (provider "opencode") e espera a decisão em GET /api/permissions/:id/wait até a espera do
//    arquivo (padrão 25 s, entre 5 e 120). Aprovado: responde ao OpenCode "once"; recusado: "reject" com o motivo.
//    Qualquer outra coisa (tempo esgotado, Habblaud fora do ar ou sem página aberta): não faz nada e fica valendo o
//    próprio pedido do OpenCode, que já está na tela dele. Nunca responde "always". A resposta vai pelo cliente do
//    plugin (v1: postSessionIdPermissionsPermissionId); se ele não tiver esse método, por POST /permission/{id}/reply
//    pelo mesmo cliente ou pela URL base dele; se nada disso existir, o pedido segue no OpenCode.
// 4. entrega as mensagens do escritório ("Mandar mensagem"): a cada ~1,5 s pergunta a POST /api/opencode/bridge/poll
//    ({session}) pelas mensagens de cada sessão que ESTE plugin serve (as que viu nos eventos e nas ferramentas e as da
//    lista do próprio cliente; nunca uma sessão que não é dele), entrega cada uma com
//    client.session.promptAsync({path: {id}, body: {parts: [{type: 'text', text}]}}) e confirma em
//    POST /api/opencode/bridge/ack. A busca também é o sinal de "plugin conectado" do escritório. O timer não segura o
//    processo (unref), erros são engolidos, Habblaud fora do ar só espaça as buscas e server.instance.disposed a encerra.
// Só fala com 127.0.0.1 (e com o servidor do próprio OpenCode, para responder). HABBLAUD_HOOK_DEBUG=1 escreve o que
// acontece no stderr.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_PORT = 4747;
/** Espera padrão por uma decisão no escritório (segundos), e os limites do arquivo de configuração. */
const DEFAULT_WAIT_S = 25;
const MIN_WAIT_S = 5;
const MAX_WAIT_S = 120;
const CONFIG_FILE = 'opencode-hook.json';
/** Eventos mandados ao Habblaud (o que o servidor aceita em /api/opencode/events). */
const OBSERVED = new Set(['session.status', 'session.idle', 'todo.updated', 'permission.asked', 'permission.updated']);
/** Prazo do envio de um evento: o Habblaud responde na hora (e o plugin não pode atrasar o OpenCode). */
const EVENT_TIMEOUT_MS = 1_500;
/** Registrar o pedido: se o Habblaud não responder nisso, ele está fora do ar (ou travado). */
const REGISTER_TIMEOUT_MS = 2_000;
/** Espera máxima de cada long-poll (o servidor responde "pending" e o plugin pergunta de novo). */
const POLL_S = 25;
/** Pedidos já tratados que o plugin lembra (o mesmo pedido pode chegar como permission.asked e permission.updated). */
const MAX_SEEN = 200;
/** Id de permissão do OpenCode (vai para uma URL: só caracteres seguros) e id de sessão. */
const PERMISSION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const SESSION_ID_RE = /^ses_[A-Za-z0-9]{26}$/;
/** Envios pendentes além disto são descartados (Habblaud travado: o OpenCode nunca acumula trabalho por nossa causa). */
const MAX_QUEUE = 50;
/** Textos e listas mandados ao Habblaud (o servidor só mostra prévias). */
const MAX_STRING = 1_000;
const MAX_ITEMS = 100;
/** Campos dos argumentos de uma ferramenta que servem de título curto (o primeiro que existir). */
const TITLE_FIELDS = ['filePath', 'file_path', 'path', 'pattern', 'command', 'url', 'query', 'description'];

/** Busca das mensagens do escritório: de quanto em quanto tempo, e quantas sessões no máximo (as mais recentes). */
const POLL_MS = 1_500;
const MAX_SESSIONS = 20;
/** Habblaud fora do ar: espera isto antes de perguntar de novo. */
const BACKOFF_MS = 10_000;
/** Prazos: a busca (o Habblaud responde na hora), a lista de sessões do cliente e o promptAsync (o servidor desiste em 20 s). */
const POLL_TIMEOUT_MS = 2_000;
const LIST_TIMEOUT_MS = 3_000;
const DELIVER_TIMEOUT_MS = 15_000;
const LIST_EVERY_MS = 30_000;
/** Mensagens por busca e tamanho máximo da mensagem (o servidor já limita em 20.000). */
const MAX_BATCH = 5;
const MAX_TEXT = 20_000;
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,300}$/;

const debug = process.env.HABBLAUD_HOOK_DEBUG === '1' ? (msg) => process.stderr.write(`[habblaud-opencode] ${msg}\n`) : () => {};
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const validPort = (p) => Number.isInteger(p) && p > 0 && p < 65_536;

/** Porta e espera: ~/.habblaud/opencode-hook.json; sem porta no arquivo, HABBLAUD_PORT; senão os padrões. Ilegível = padrões. */
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
  const wait = Number(f.permissionTimeoutS);
  return {
    port: validPort(filePort) ? filePort : validPort(envPort) ? envPort : DEFAULT_PORT,
    waitMs: (Number.isFinite(wait) && wait > 0 ? Math.min(MAX_WAIT_S, Math.max(MIN_WAIT_S, wait)) : DEFAULT_WAIT_S) * 1_000,
  };
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

const textList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX_ITEMS).map((x) => x.slice(0, MAX_STRING));

/** O pedido de permissão do evento (v2: permission/patterns; v1: type/pattern/title), ou undefined se não serve. */
function permissionOf(event) {
  if (!isObject(event) || (event.type !== 'permission.asked' && event.type !== 'permission.updated')) return undefined;
  const p = event.properties;
  if (!isObject(p) || typeof p.id !== 'string' || !PERMISSION_ID_RE.test(p.id) || typeof p.sessionID !== 'string' || !SESSION_ID_RE.test(p.sessionID)) return undefined;
  const tool = typeof p.permission === 'string' ? p.permission : typeof p.type === 'string' ? p.type : '';
  if (!tool.trim()) return undefined;
  const meta = isObject(p.metadata) ? p.metadata : {};
  const metadata = {};
  for (const k of ['command', 'description', 'filepath', 'diff']) if (typeof meta[k] === 'string') metadata[k] = meta[k].slice(0, MAX_STRING * 8);
  const tool_input = { patterns: textList(p.patterns ?? p.pattern), metadata };
  if (typeof p.title === 'string' && p.title.trim()) tool_input.title = p.title.slice(0, MAX_STRING);
  return { id: p.id, sessionID: p.sessionID, tool: tool.slice(0, 200), tool_input };
}

/** Motivo da recusa como o OpenCode o mostra ao modelo. */
function denyMessage(result) {
  const reason = typeof result.message === 'string' && result.message.trim() ? result.message.trim().slice(0, 1_000) : '';
  return reason ? `Recusado pelo usuário no Habblaud: ${reason}` : 'Recusado pelo usuário no Habblaud.';
}

/** URL base do servidor do OpenCode pelo cliente do plugin, se ele a mostrar. */
function baseUrlOf(client) {
  for (const c of [client?._client, client?.client, client]) {
    try {
      const u = c?.getConfig?.()?.baseUrl;
      if (typeof u === 'string' && /^https?:\/\//.test(u)) return u.replace(/\/+$/, '');
    } catch {
      // próximo
    }
  }
  return undefined;
}

/** A resposta do cliente é um erro? (o cliente do SDK devolve {error} em vez de lançar) */
const failed = (r) => !r || r.error !== undefined || r.response?.ok === false;

/**
 * Responde ao pedido no OpenCode: "once" ou "reject" (nunca "always"). Primeiro o método v1 do cliente do plugin; se ele
 * não existir ou falhar, POST /permission/{id}/reply (pelo cliente HTTP dele, ou pela URL base). Devolve se alguma
 * via funcionou. Nunca lança.
 */
async function reply(client, perm, response, message) {
  const body = message ? { response, message } : { response };
  try {
    if (typeof client?.postSessionIdPermissionsPermissionId === 'function') {
      const r = await client.postSessionIdPermissionsPermissionId({ path: { id: perm.sessionID, permissionID: perm.id }, body });
      if (!failed(r)) return true;
    }
  } catch (err) {
    debug(`resposta v1: ${err?.message ?? err}`);
  }
  const next = { reply: response, ...(message ? { message } : {}) };
  try {
    const post = client?._client?.post;
    if (typeof post === 'function') {
      const r = await post.call(client._client, { url: '/permission/{requestID}/reply', path: { requestID: perm.id }, body: next, headers: { 'Content-Type': 'application/json' } });
      if (!failed(r)) return true;
    }
  } catch (err) {
    debug(`resposta pelo cliente: ${err?.message ?? err}`);
  }
  try {
    const base = baseUrlOf(client);
    if (!base) return false;
    const res = await fetch(`${base}/permission/${encodeURIComponent(perm.id)}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next), signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch (err) {
    debug(`resposta pela URL base: ${err?.message ?? err}`);
    return false;
  }
}

/** Registra o pedido no Habblaud, espera a decisão e responde ao OpenCode (ou não faz nada). Nunca lança. */
async function decide(client, perm, cwd) {
  const startedAt = Date.now();
  try {
    const { port, waitMs } = readConfig();
    const deadline = startedAt + waitMs;
    const body = { provider: 'opencode', session_id: perm.sessionID, tool_name: perm.tool, tool_input: perm.tool_input, timeout_ms: waitMs };
    if (typeof cwd === 'string' && cwd) body.cwd = cwd.slice(0, 4_096);
    const reg = await call(port, 'POST', '/api/permissions', body, REGISTER_TIMEOUT_MS);
    if (!reg || reg.status !== 201 || typeof reg.json?.id !== 'string') {
      debug(`sem desvio (${reg ? `${reg.status} ${JSON.stringify(reg.json ?? null)}` : 'Habblaud fora do ar'})`);
      return;
    }
    const id = encodeURIComponent(reg.json.id);
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) return debug('tempo esgotado: vale o pedido do OpenCode');
      const waitS = Math.max(0.05, Math.min(POLL_S, left / 1_000));
      const r = await call(port, 'GET', `/api/permissions/${id}/wait?timeout=${waitS}`, undefined, waitS * 1_000 + 5_000);
      if (!r || r.status !== 200) return;
      if (r.json?.status === 'pending') continue;
      debug(`resposta: ${JSON.stringify(r.json)}`);
      if (r.json?.status !== 'decided') return;
      if (r.json.behavior === 'allow') await reply(client, perm, 'once');
      else if (r.json.behavior === 'deny') await reply(client, perm, 'reject', denyMessage(r.json));
      return;
    }
  } catch (err) {
    debug(`erro: ${err?.message ?? err}`);
  }
}

/** Resolve com o resultado de `p` ou, passado `ms`, com `fallback` (o timer não segura o processo). Rejeita se `p` rejeitar. */
function within(p, ms, fallback) {
  let timer;
  return Promise.race([Promise.resolve(p), new Promise((ok) => (timer = setTimeout(() => ok(fallback), ms)))]).finally(() => {
    clearTimeout(timer);
  });
}

/** Entrega o texto à sessão pelo cliente do plugin: {ok: true} ou {ok: false, error}. Nunca lança. */
async function deliver(client, sessionID, text) {
  try {
    if (typeof client?.session?.promptAsync !== 'function') return { ok: false, error: 'o OpenCode desta sessão não oferece session.promptAsync' };
    const r = await within(client.session.promptAsync({ path: { id: sessionID }, body: { parts: [{ type: 'text', text }] } }), DELIVER_TIMEOUT_MS, 'timeout');
    if (r === 'timeout') return { ok: false, error: 'o OpenCode não respondeu ao promptAsync a tempo' };
    return failed(r) ? { ok: false, error: 'o OpenCode recusou a mensagem' } : { ok: true };
  } catch (err) {
    debug(`promptAsync: ${err?.message ?? err}`);
    return { ok: false, error: String(err?.message ?? 'erro ao entregar').slice(0, 300) };
  }
}

export const HabblaudPlugin = async ({ client, directory } = {}) => {
  const seen = new Set();
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

  // Sessões que este plugin serve (as mais recentes por último): só delas ele busca e entrega mensagens.
  const owned = new Map();
  const own = (id) => {
    if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) return;
    owned.delete(id);
    owned.set(id, Date.now());
    while (owned.size > MAX_SESSIONS) owned.delete(owned.keys().next().value);
  };
  const ownFrom = (p) => {
    if (!isObject(p)) return;
    own(p.sessionID);
    if (isObject(p.info)) own(p.info.id);
  };
  let stopped = false;
  let busy = false;
  let pausedUntil = 0;
  let nextListAt = 0;
  const poller = setInterval(() => {
    tick().catch(() => {});
  }, POLL_MS);
  poller.unref?.();
  const stop = () => {
    stopped = true;
    clearInterval(poller);
  };

  /** Uma rodada: atualiza a lista de sessões de vez em quando e busca/entrega as mensagens de cada uma. Nunca lança. */
  async function tick() {
    if (stopped || busy || Date.now() < pausedUntil) return;
    busy = true;
    try {
      if (Date.now() >= nextListAt) {
        nextListAt = Date.now() + LIST_EVERY_MS;
        const r = await within(Promise.resolve().then(() => client?.session?.list?.()), LIST_TIMEOUT_MS, undefined).catch(() => undefined);
        const rows = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [];
        for (const row of rows.slice(0, MAX_SESSIONS)) if (isObject(row)) own(row.id);
      }
      for (const session of [...owned.keys()]) {
        if (stopped) return;
        const { port } = readConfig();
        const r = await call(port, 'POST', '/api/opencode/bridge/poll', { session }, POLL_TIMEOUT_MS);
        if (!r) {
          pausedUntil = Date.now() + BACKOFF_MS; // Habblaud fora do ar: não insiste a cada rodada
          return;
        }
        const list = r.status === 200 && Array.isArray(r.json?.messages) ? r.json.messages.slice(0, MAX_BATCH) : [];
        const results = [];
        for (const m of list) {
          if (!isObject(m) || typeof m.id !== 'string' || !MESSAGE_ID_RE.test(m.id) || typeof m.text !== 'string' || !m.text.trim() || m.text.length > MAX_TEXT) continue;
          results.push({ id: m.id, ...(await deliver(client, session, m.text)) });
        }
        if (results.length) await call(port, 'POST', '/api/opencode/bridge/ack', { session, results }, POLL_TIMEOUT_MS);
      }
    } catch (err) {
      debug(`busca: ${err?.message ?? err}`);
    } finally {
      busy = false;
    }
  }

  return {
    event: async (input) => {
      try {
        const type = input?.event?.type;
        if (type === 'server.instance.disposed' || type === 'global.disposed') return stop();
        ownFrom(input?.event?.properties);
        post(observed(input?.event));
        const perm = permissionOf(input?.event);
        if (perm && !seen.has(perm.id)) {
          seen.add(perm.id);
          if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value);
          decide(client, perm, directory).catch(() => {}); // em segundo plano: o OpenCode não espera
        }
      } catch (err) {
        debug(`erro: ${err?.message ?? err}`);
      }
    },
    'tool.execute.before': async (input, output) => {
      try {
        if (!isObject(input) || typeof input.sessionID !== 'string' || typeof input.tool !== 'string') return;
        own(input.sessionID);
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
        own(input.sessionID);
        post({ type: 'tool.execute.after', properties: { sessionID: input.sessionID, tool: input.tool.slice(0, 80), callID: typeof input.callID === 'string' ? input.callID.slice(0, 80) : undefined } });
      } catch (err) {
        debug(`erro: ${err?.message ?? err}`);
      }
    },
  };
};
