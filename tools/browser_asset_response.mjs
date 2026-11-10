import { extname } from 'node:path';
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

// GitHub Pages gzip-encodes raw GLBs. Match that delivery in the browser test
// without rewriting source assets or recompressing Unity's existing payloads.
export function serveBrowserAsset(response, { file, body, contentType, acceptEncoding }) {
  let entity = body;
  if (extname(file).toLowerCase() === '.glb' && !response.hasHeader('Content-Encoding')) {
    const vary = String(response.getHeader('Vary') ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (!vary.includes('*') && !vary.some(value => value.toLowerCase() === 'accept-encoding')) vary.push('Accept-Encoding');
    response.setHeader('Vary', vary.join(', '));
    if (acceptsGzip(acceptEncoding)) {
      entity = gzipSync(body);
      response.setHeader('Content-Encoding', 'gzip');
    }
  }
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', entity.length);
  response.setHeader('Cache-Control', 'public, max-age=60');
  response.writeHead(200);
  response.end(entity);
}
