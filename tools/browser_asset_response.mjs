import { extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

function acceptsGzip(header = '') {
  if (typeof header !== 'string') return false;
  const entries = header.toLowerCase().split(',').map(value => {
    const [name, ...parameters] = value.trim().split(';');
    const quality = parameters.map(value => value.trim()).find(value => value.startsWith('q='));
    const q = quality === undefined ? 1 : /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality) ? Number(quality.slice(2)) : 0;
    return { name: name.trim(), q };
  });
  return (entries.find(entry => entry.name === 'gzip') ?? entries.find(entry => entry.name === '*'))?.q > 0;
}

const timestamp = () => ({ monotonicMs: performance.now(), epochMs: performance.timeOrigin + performance.now(), cpu: process.cpuUsage() });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// A fixed local build is immutable during this suite, just like its deployed
// CDN entities. Prepare only the canonical 16 GLBs before Chromium starts;
// cold browser contexts still receive the full response under normal throttling.
export async function prepareBrowserAssets(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 16 || new Set(files).size !== files.length
    || files.some(file => typeof file !== 'string' || extname(file).toLowerCase() !== '.glb'))
    throw new Error('Expected at most 16 unique raw GLB files.');
  const assets = new Map();
  const evidence = { start: timestamp(), entries: [], retainedBytes: 0, rawBytes: 0, gzipBytes: 0 };
  for (const file of files) {
    if ((await stat(file)).size > 16 * 1024 * 1024) throw new Error('Canonical GLB exceeds the preparation size bound.');
    const entry = { name: file.replaceAll('\\', '/').split('/').at(-1), readStart: timestamp() };
    const body = await readFile(file);
    entry.readEnd = timestamp();
    entry.gzipStart = timestamp();
    const gzipBody = gzipSync(body);
    entry.gzipEnd = timestamp();
    evidence.retainedBytes += body.length + gzipBody.length;
    if (evidence.retainedBytes > 256 * 1024 * 1024) throw new Error('Prepared GLBs exceed the retained memory bound.');
    evidence.rawBytes += body.length; evidence.gzipBytes += gzipBody.length;
    Object.assign(entry, { rawBytes: body.length, gzipBytes: gzipBody.length, rawSha256: sha256(body), gzipSha256: sha256(gzipBody) });
    evidence.entries.push(entry);
    assets.set(file, Object.freeze({ body, gzipBody }));
  }
  evidence.complete = timestamp();
  return { get: file => assets.get(file), evidence };
}

export function createBrowserAssetTrace() {
  const evidence = { timeOriginMs: performance.timeOrigin, requests: [], dropped: 0, preparation: null,
    note: 'Server timestamps observe Node work. writeFinished means bytes handed to the OS, not Unity completion or browser presentation.' };
  return { evidence, begin(response) {
    const row = { path: null, phases: { request: timestamp() }, status: null };
    if (evidence.requests.length < 4096) evidence.requests.push(row); else evidence.dropped += 1;
    const mark = phase => { row.phases[phase] = timestamp(); };
    response.once('finish', () => { row.status = response.statusCode; mark('writeFinished'); });
    response.once('close', () => { row.complete = response.writableFinished; mark('closed'); });
    return { row, mark };
  } };
}

// Keep the existing negotiation, cache headers and precompressed-asset behavior.
// A prepared payload only moves deterministic file read/gzip work before launch.
export function serveBrowserAsset(response, { file, body, contentType, acceptEncoding, prepared, trace }) {
  let entity = body;
  if (prepared && prepared.body !== body) throw new Error('Prepared GLB does not belong to this source body.');
  if (extname(file).toLowerCase() === '.glb' && !response.hasHeader('Content-Encoding')) {
    const vary = String(response.getHeader('Vary') ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (!vary.includes('*') && !vary.some(value => value.toLowerCase() === 'accept-encoding')) vary.push('Accept-Encoding');
    response.setHeader('Vary', vary.join(', '));
    if (acceptsGzip(acceptEncoding)) {
      if (prepared) entity = prepared.gzipBody;
      else { trace?.mark('gzipStart'); entity = gzipSync(body); trace?.mark('gzipEnd'); }
      response.setHeader('Content-Encoding', 'gzip');
    }
  }
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', entity.length);
  response.setHeader('Cache-Control', 'public, max-age=60');
  if (trace) {
    trace.row.entityBytes = entity.length;
    trace.row.contentEncoding = response.getHeader('Content-Encoding') ?? null;
    const duration = (start, end) => trace.row.phases[start] && trace.row.phases[end]
      ? trace.row.phases[end].monotonicMs - trace.row.phases[start].monotonicMs : 0;
    response.setHeader('Server-Timing', `read;dur=${duration('readStart', 'readEnd').toFixed(3)}, gzip;dur=${duration('gzipStart', 'gzipEnd').toFixed(3)}`);
    trace.mark('headers');
  }
  response.writeHead(200);
  response.end(entity);
}
