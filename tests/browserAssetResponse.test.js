import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync, brotliCompressSync } from 'node:zlib';
import { serveBrowserAsset } from '../tools/browser_asset_response.mjs';

const source = await readFile(new URL('../public/animations/bjj/double_leg.glb', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');

async function transfer({ file = 'double_leg.glb', body = source, acceptEncoding, headers = {} } = {}) {
  const server = createServer((request, response) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    serveBrowserAsset(response, { file, body, contentType: file.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream',
      acceptEncoding: request.headers['accept-encoding'] });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve, reject) => {
      const request = get(`http://127.0.0.1:${server.address().port}/asset`, {
        headers: acceptEncoding === undefined ? {} : { 'Accept-Encoding': acceptEncoding },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
        response.on('error', reject);
      });
      request.setTimeout(5000, () => request.destroy(new Error('Fixture transfer timed out')));
      request.on('error', reject);
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('actual character GLB is gzip encoded on the wire and decodes to its original bytes', async () => {
  const result = await transfer({ acceptEncoding: 'gzip, deflate, br, zstd' });
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-type'], 'model/gltf-binary');
  assert.equal(result.headers['content-encoding'], 'gzip');
  assert.equal(Number(result.headers['content-length']), result.body.length);
  assert.equal(result.headers.vary, 'Accept-Encoding');
  assert.equal(result.headers['cache-control'], 'public, max-age=60');
  assert.ok(result.body.length < source.length);
  assert.deepEqual(gunzipSync(result.body), source);
  assert.equal(hash(source), 'e91fb100e322e2a4744d84fd35c6a131a962d0cf03b8359d0587cee61047393c');
});

test('absent, rejected or invalid gzip acceptance preserves the original entity', async () => {
  for (const acceptEncoding of [undefined, 'identity', 'br', 'gzip;q=0', 'gzip;q=0, *;q=1', 'gzip;q=invalid']) {
    const result = await transfer({ acceptEncoding });
    assert.equal(result.headers['content-encoding'], undefined);
    assert.equal(result.headers.vary, 'Accept-Encoding');
    assert.equal(Number(result.headers['content-length']), source.length);
    assert.deepEqual(result.body, source);
  }
});

test('gzip quality, case and wildcard negotiation preserve existing Vary', async () => {
  for (const acceptEncoding of ['GZip; q=0.5', 'br, *;q=0.5']) {
    const result = await transfer({ body: source.subarray(0, 256), acceptEncoding, headers: { Vary: 'Origin' } });
    assert.equal(result.headers['content-encoding'], 'gzip');
    assert.equal(result.headers.vary, 'Origin, Accept-Encoding');
    assert.deepEqual(gunzipSync(result.body), source.subarray(0, 256));
  }
  const wildcard = await transfer({ body: source.subarray(0, 256), acceptEncoding: 'gzip', headers: { Vary: '*' } });
  assert.equal(wildcard.headers.vary, '*');
});

test('precompressed assets and existing content encoding are never recompressed', async () => {
  for (const file of ['scene.glb.gz', 'framework.js.unityweb', 'code.wasm.br', 'scene.glb']) {
    const compressed = file.endsWith('.br') ? brotliCompressSync(source.subarray(0, 1024)) : gzipSync(source.subarray(0, 1024));
    const headers = file.endsWith('.unityweb') ? {} : { 'Content-Encoding': file.endsWith('.br') ? 'br' : 'gzip' };
    const result = await transfer({ file, body: compressed, acceptEncoding: 'gzip', headers });
    assert.deepEqual(result.body, compressed);
    assert.equal(result.headers['content-encoding'], headers['Content-Encoding']);
    assert.equal(Number(result.headers['content-length']), compressed.length);
    assert.equal(result.headers.vary, undefined);
  }
});
