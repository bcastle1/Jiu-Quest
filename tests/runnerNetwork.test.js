import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { RUNNER_NETWORK_ERRORS, runnerNetwork, runnerNetworkError } from '../tools/runner_network.mjs';

// The console error that failed the deploy of 64a7370 (run 44291865018, test_match_moments),
// as Playwright reported it.
const ORIGIN = 'http://127.0.0.1:54287';
const CI_LINE = Object.freeze({
  text: 'Failed to load resource: net::ERR_NO_BUFFER_SPACE',
  location: { url: `${ORIGIN}/assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2`, line: 0, column: 0, lineNumber: 0, columnNumber: 0 },
});
const at = (url, text = CI_LINE.text) => ({ text, location: { ...CI_LINE.location, url } });
const listening = (address, port) => ({ address: () => (address === null ? null : { address, family: 'IPv4', port }), on() { return this; }, prependListener() { return this; } });

test('the console line that failed the deploy of 64a7370 is a runner error on the suite\'s own server', () => {
  assert.deepEqual(RUNNER_NETWORK_ERRORS, ['net::ERR_NO_BUFFER_SPACE']);
  assert.ok(Object.isFrozen(RUNNER_NETWORK_ERRORS));
  assert.equal(runnerNetworkError(CI_LINE, ORIGIN), 'net::ERR_NO_BUFFER_SPACE');
  // Any file of that server: a clip, a picture, a script, with a query or a fragment.
  for (const path of ['/assets/unreal-clips/standing_stance/fighter-side.mp4', '/index.html?engine=snapshot', '/assets/index-rAUHIpq2.js#x', '/']) {
    assert.equal(runnerNetworkError(at(`${ORIGIN}${path}`), ORIGIN), 'net::ERR_NO_BUFFER_SPACE', path);
  }
});

test('every other socket error, page error or HTTP error stays the suite\'s to judge', () => {
  const others = ['ERR_FAILED', 'ERR_ABORTED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_ABORTED',
    'ERR_CONNECTION_FAILED', 'ERR_EMPTY_RESPONSE', 'ERR_TIMED_OUT', 'ERR_ADDRESS_IN_USE', 'ERR_ADDRESS_INVALID', 'ERR_ADDRESS_UNREACHABLE',
    'ERR_INSUFFICIENT_RESOURCES', 'ERR_OUT_OF_MEMORY', 'ERR_SOCKET_NOT_CONNECTED', 'ERR_NETWORK_CHANGED', 'ERR_CACHE_MISS', 'ERR_INVALID_RESPONSE'];
  for (const code of others) assert.equal(runnerNetworkError(at(CI_LINE.location.url, `Failed to load resource: net::${code}`), ORIGIN), null, code);
  for (const text of [
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
    'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
    'Failed to load resource: net::ERR_NO_BUFFER_SPACE (retrying)',
    ' Failed to load resource: net::ERR_NO_BUFFER_SPACE',
    'Failed to load resource: net::ERR_NO_BUFFER_SPACE\n',
    'Error: Failed to load resource: net::ERR_NO_BUFFER_SPACE',
    'Failed to load resource: net::err_no_buffer_space',
    'Failed to load resource: ERR_NO_BUFFER_SPACE',
    'net::ERR_NO_BUFFER_SPACE',
    'TypeError: Failed to fetch dynamically imported module (net::ERR_NO_BUFFER_SPACE)',
    'Uncaught (in promise) Error: net::ERR_NO_BUFFER_SPACE',
    '',
  ]) assert.equal(runnerNetworkError(at(CI_LINE.location.url, text), ORIGIN), null, JSON.stringify(text));
  for (const text of [undefined, null, 42, { toString: () => CI_LINE.text }]) assert.equal(runnerNetworkError({ text, location: CI_LINE.location }, ORIGIN), null, String(text));
});

test('only a file of the suite\'s own 127.0.0.1 server: never another port, host or scheme, a preview URL, or no URL', () => {
  for (const url of ['http://127.0.0.1:54288/assets/font.woff2', 'http://localhost:54287/assets/font.woff2', 'https://127.0.0.1:54287/assets/font.woff2',
    'http://[::1]:54287/assets/font.woff2', 'http://0.0.0.0:54287/assets/font.woff2', 'https://jiuquest.com/assets/font.woff2',
    'http://127.0.0.1.example.com:54287/a', 'data:text/plain,x', 'about:blank', '', 'not a url', '/assets/font.woff2']) {
    assert.equal(runnerNetworkError(at(url), ORIGIN), null, url);
  }
  assert.equal(runnerNetworkError({ text: CI_LINE.text }, ORIGIN), null, 'no location');
  assert.equal(runnerNetworkError({ text: CI_LINE.text, location: {} }, ORIGIN), null, 'no url');
  assert.equal(runnerNetworkError({ text: CI_LINE.text, location: { url: null, lineNumber: 0, columnNumber: 0 } }, ORIGIN), null, 'url null');
  assert.equal(runnerNetworkError({ text: CI_LINE.text, location: 'http://127.0.0.1:54287/' }, ORIGIN), null, 'location as text');
  assert.equal(runnerNetworkError(null, ORIGIN), null, 'no entry');
  // Without the suite's own origin (a suite run against JIUQUEST_PREVIEW_URL) nothing is a runner error.
  for (const origin of [undefined, null, '', 'http://localhost:54287', 'https://127.0.0.1:54287', 'http://127.0.0.1', 'http://127.0.0.1:54287/', 'https://jiuquest.com', 'http://127.0.0.1:x']) {
    assert.equal(runnerNetworkError(CI_LINE, origin), null, String(origin));
  }
});

test('the line must be the network log\'s own, at line 0 and column 0: a script of the site that logs the same words is the site\'s error', () => {
  // console.error('Failed to load resource: net::ERR_NO_BUFFER_SPACE') in the bundle, or in an inline script of the page.
  for (const location of [
    { url: `${ORIGIN}/assets/index-rAUHIpq2.js`, lineNumber: 0, columnNumber: 18734 },
    { url: `${ORIGIN}/assets/index-rAUHIpq2.js`, lineNumber: 41, columnNumber: 0 },
    { url: `${ORIGIN}/`, lineNumber: 12, columnNumber: 8 },
    { url: `${ORIGIN}/assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2` },
    { url: `${ORIGIN}/assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2`, lineNumber: '0', columnNumber: '0' },
    { url: `${ORIGIN}/assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2`, line: 0, column: 0 },
  ]) assert.equal(runnerNetworkError({ text: CI_LINE.text, location }, ORIGIN), null, JSON.stringify(location));
});

test('a suite\'s log keeps and prints a runner error, and nothing else', () => {
  const printed = [];
  const runner = runnerNetwork('match-moments', { warn: (line) => printed.push(line), env: {} });
  // Before the suite's server listens (or when the suite runs against a preview URL), nothing is taken.
  assert.equal(runner.origin, null);
  assert.equal(runner.take(CI_LINE), false);
  assert.equal(runner.serving(listening('127.0.0.1', 54287)), ORIGIN);
  assert.equal(runner.origin, ORIGIN);
  const before = Date.now();
  assert.equal(runner.take(CI_LINE), true);
  for (const entry of [at('http://127.0.0.1:1/x'), at(CI_LINE.location.url, 'Failed to load resource: net::ERR_FAILED'), { text: 'Unity failed' }]) assert.equal(runner.take(entry), false, JSON.stringify(entry));
  assert.equal(runner.errors.length, 1);
  const [kept] = runner.errors;
  assert.deepEqual({ ...kept, atUtc: undefined }, { text: CI_LINE.text, location: CI_LINE.location, code: 'net::ERR_NO_BUFFER_SPACE', atUtc: undefined });
  assert.ok(Date.parse(kept.atUtc) >= before - 1000 && Date.parse(kept.atUtc) <= Date.now() + 1000, kept.atUtc);
  assert.deepEqual(printed, [`Warning: match-moments: "${CI_LINE.text}" for ${CI_LINE.location.url} is the runner's error, not the site's: the host had no socket buffer or port free. Kept in the report as runnerErrors; the suite's checks decide.`]);
  // What else a suite writes down about an entry (tools/test_unity_browser.mjs: its type, time, phase and context) is kept with it.
  const unity = { ...CI_LINE, type: 'error', atUtc: '2026-11-18T11:15:00.000Z', phase: 'arena:ready', context: { id: 3, createdPhase: 'starting' } };
  assert.equal(runner.take(unity), true);
  assert.deepEqual(runner.errors[1], { ...unity, code: 'net::ERR_NO_BUFFER_SPACE' });
  assert.equal(printed.length, 2);
});

test('on GitHub Actions the warning is one workflow command, a warning annotation', () => {
  const printed = [];
  const runner = runnerNetwork('stance-picker', { warn: (line) => printed.push(line), env: { GITHUB_ACTIONS: 'true' } });
  runner.serving(listening('127.0.0.1', 50000));
  assert.equal(runner.take(at('http://127.0.0.1:50000/assets/a%20b.webp')), true);
  assert.equal(printed.length, 1);
  assert.match(printed[0], /^::warning title=Runner network error in stance-picker::stance-picker: "Failed to load resource: net::ERR_NO_BUFFER_SPACE" for http:\/\/127\.0\.0\.1:50000\/assets\/a%2520b\.webp is the runner's error/);
  assert.ok(!/[\r\n]/.test(printed[0]));
});

test('a log is only for the suite\'s own server on 127.0.0.1, and a suite name that fits an annotation title', () => {
  const runner = runnerNetwork('unity-browser', { warn: () => {}, env: {} });
  for (const [address, port] of [['::1', 1234], ['0.0.0.0', 1234], ['localhost', 1234], [null, null], ['127.0.0.1', undefined]]) {
    assert.throws(() => runner.serving(listening(address, port)), /own 127\.0\.0\.1 server/, `${address}:${port}`);
  }
  assert.equal(runner.origin, null);
  assert.equal(runner.serving(listening('127.0.0.1', 1234)), 'http://127.0.0.1:1234');
  assert.throws(() => runner.serving(listening('127.0.0.1', 1235)), /one server per suite/);
  assert.equal(runner.origin, 'http://127.0.0.1:1234');
  for (const name of ['', 'Match moments', 'a,b', 'a:b', 'match_moments']) assert.throws(() => runnerNetwork(name), /lower-case letters, digits and hyphens/, name);
});

// A real node:http server on 127.0.0.1, as the suites run theirs, and raw connections to it, which
// see what the browser would: whether the server closed a connection, and what bytes came first.
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(ok, what, ms = 5000) {
  for (const end = Date.now() + ms; !ok(); await sleep(5)) if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
}
async function suiteServer(handler) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const sockets = [];
  const open = (path = null) => {
    const socket = connect(server.address().port, '127.0.0.1');
    const seen = { socket, bytes: Buffer.alloc(0), closedByServer: false, body: () => { const at = seen.bytes.indexOf('\r\n\r\n'); return at < 0 ? null : seen.bytes.subarray(at + 4); } };
    socket.on('data', (chunk) => { seen.bytes = Buffer.concat([seen.bytes, chunk]); });
    socket.on('end', () => { seen.closedByServer = true; });
    socket.on('error', () => {});
    if (path) socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
    sockets.push(socket);
    return seen;
  };
  const stop = async () => { for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise((done) => server.close(done)); };
  return { server, open, stop };
}

test('before a context closes, the suite\'s server closes the connections that have answered and have nothing left to send, and no other', async () => {
  const big = Buffer.alloc(4 * 1024 * 1024, 7);
  let release;
  const held = new Promise((done) => { release = done; });
  const answers = {};
  let accepted = 0;
  const { server, open, stop } = await suiteServer((request, response) => {
    if (request.url.startsWith('/small')) { if (request.url === '/small?answered') answers.small = request.socket; response.writeHead(200, { 'Content-Length': 2 }); response.end('ok'); return; }
    if (request.url === '/held') {
      // Ended, but its bytes stay in Node for now, as with a big file on a slow network on Linux or macOS.
      for (const name of ['_write', '_writev']) {
        const write = response.socket[name];
        response.socket[name] = function later(...args) { held.then(() => write.apply(this, args)); };
      }
      response.writeHead(200, { 'Content-Length': big.length });
      response.end(big);
      response.once('close', () => { answers.heldClosed = true; });
      answers.held = response;
      return;
    }
    if (request.url === '/writing') { response.writeHead(200, { 'Content-Length': 10 }); response.write('12345'); answers.writing = response; }
  });
  server.on('connection', () => { accepted += 1; });
  // A second request on a connection whose first answer has arrived whole.
  const ask = (connection, path) => { connection.bytes = Buffer.alloc(0); connection.socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`); };
  try {
    const runner = runnerNetwork('match-moments', { warn: () => {}, env: {} });
    runner.serving(server);
    const calls = [];
    const context = { close: async (...args) => { calls.push({ args, answeredClosedOnServer: answers.small.destroyed }); return 'closed'; } };
    const browser = { newContext: async (...options) => { calls.push({ options }); return context; }, version: () => '1' };
    assert.equal(runner.closingIdleFirst(browser), browser, 'the same browser, so a suite keeps using it as before');

    // One connection that has answered and is idle; one that has not been asked anything; two that
    // have answered once and are answering again: one ended with its bytes still in Node, one still writing.
    const answered = open('/small?answered'), fresh = open(), heldBack = open('/small'), writing = open('/small');
    await until(() => accepted === 4 && [answered, heldBack, writing].every((connection) => connection.body()?.toString() === 'ok'), 'the first answers');
    ask(heldBack, '/held');
    ask(writing, '/writing');
    await until(() => answers.held && writing.body()?.toString() === '12345', 'the second answers to start');
    assert.equal(answers.held.finished, true, 'the held answer is ended');
    assert.equal(answers.held.writableFinished, false, 'but its bytes are not with the operating system yet');
    assert.equal(heldBack.body(), null, 'and none has arrived');

    const opened = await browser.newContext({ viewport: { width: 390, height: 844 } });
    assert.equal(opened, context);
    assert.equal(answers.small.destroyed, false, 'nothing is closed when a context opens');
    assert.equal(await opened.close({ reason: 'done' }), 'closed');
    assert.deepEqual(calls, [{ options: [{ viewport: { width: 390, height: 844 } }] }, { args: [{ reason: 'done' }], answeredClosedOnServer: true }],
      'the server closes first, then the context closes and gets what it was asked');
    await until(() => answered.closedByServer, 'the server to close the connection that has answered');
    await sleep(200);
    assert.equal(fresh.closedByServer, false, 'a connection that has not answered yet stays open: Chromium would not send its request again');
    assert.equal(heldBack.closedByServer, false, 'a connection whose answer is still in Node stays open');
    assert.equal(writing.closedByServer, false, 'a connection still writing its answer stays open');

    release();
    await until(() => heldBack.body()?.length === big.length && answers.heldClosed, 'the held answer');
    assert.ok(heldBack.body().equals(big), 'the held answer arrives whole');
    await (await browser.newContext()).close();
    await until(() => heldBack.closedByServer, 'the server to close it once its answer is with the operating system');
    await sleep(100);
    assert.equal(fresh.closedByServer, false);
    assert.equal(writing.closedByServer, false);
    assert.equal(writing.body()?.toString(), '12345');
    assert.equal(browser.version(), '1', 'the rest of the browser is untouched');
  } finally {
    await stop();
  }
});

test('without a server of the suite\'s own (a preview URL) a context just closes', async () => {
  const calls = [];
  const browser = { newContext: async () => ({ close: async () => { calls.push('context closes'); } }) };
  const runner = runnerNetwork('showcase-cards', { warn: () => {}, env: {} });
  await (await runner.closingIdleFirst(browser).newContext()).close();
  assert.deepEqual(calls, ['context closes']);
});

// Every browser suite that can fail on a console error goes through this one helper: its server and
// its browser, runner errors taken out first in its console handler, and its report. A suite counts
// as one when it listens to the console in any way or keeps console errors at all, however it then
// asserts on them.
const CONSOLE_LISTENER = /\.(?:on|once|addListener|prependListener)\(\s*['"`]console['"`]/g;
const judgesConsole = (source) => new RegExp(CONSOLE_LISTENER.source).test(source) || /\.consoleMessages\(|\bconsoleErrors\b/.test(source);

test('which suites count: any console listener or any list of console errors, not one way of asserting', () => {
  for (const source of ["page.on('console', (m) => {})", 'page.on("console", log)', 'context.on(\'console\', log)', 'popup.once(`console`, log)', "page.addListener('console', log)",
    'const messages = await page.consoleMessages();', 'assert.equal(consoleErrors.length, 0);', 'const consoleErrors = [];']) assert.equal(judgesConsole(source), true, source);
  for (const source of ["page.on('pageerror', log)", "page.on('request', log)", 'const errors = []; assert.deepEqual(errors, []);', '// console errors are not checked here']) assert.equal(judgesConsole(source), false, source);
});

test('every browser suite that can fail on console errors closes answered connections first, takes runner errors out first and reports them', () => {
  const suites = readdirSync(new URL('../tools/', import.meta.url)).filter((name) => /^test_.*\.mjs$/.test(name)).sort();
  const judging = [];
  for (const name of suites) {
    const source = readFileSync(new URL(`../tools/${name}`, import.meta.url), 'utf8');
    if (!judgesConsole(source)) continue;
    judging.push(name);
    assert.match(source, /^import \{ runnerNetwork \} from '\.\/runner_network\.mjs';\r?$/m, `${name} imports the helper`);
    assert.match(source, /^const runner = runnerNetwork\('[a-z0-9-]+'\);\r?$/m, `${name} keeps one`);
    assert.match(source, /runner\.serving\(server\);/, `${name} tells it its own server`);
    const launches = source.match(/\b(?:chromium|firefox|webkit)\.launch\(/g)?.length ?? 0;
    assert.ok(launches > 0 && (source.match(/browser = runner\.closingIdleFirst\(await (?:chromium|firefox|webkit)\.launch\(/g)?.length ?? 0) === launches, `${name}: every browser it launches closes answered connections first`);
    const listeners = [...source.matchAll(CONSOLE_LISTENER)].map((found) => found.index);
    assert.ok(listeners.length > 0, `${name} listens to the console with page.on('console', ...), where runner.take can come first`);
    for (const listener of listeners) {
      const next = source.slice(listener + 1).search(/\.(?:on|once|addListener|prependListener)\(/);
      const handler = source.slice(listener, next >= 0 ? listener + 1 + next : undefined);
      const take = handler.indexOf('runner.take(');
      const push = handler.search(/consoleErrors\)?\.push\(/i);
      assert.ok(take > 0 && push > take, `${name}: runner.take comes first in each console handler, before anything is pushed to consoleErrors (or expectedConsoleErrors)`);
    }
    assert.match(source, /runnerErrors: runner\.errors/, `${name} writes its runner errors into its report`);
  }
  // The 13 that did on November 18, 2026, so the search above cannot miss them; a new suite that
  // listens to the console or keeps console errors is held to the same checks.
  for (const name of ['test_keyboard_polish.mjs', 'test_match_moments.mjs', 'test_music_engine.mjs', 'test_showcase_cards.mjs', 'test_stance_picker.mjs',
    'test_unity_browser.mjs', 'test_unity_canvas_lifecycle.mjs', 'test_unreal_athlete.mjs', 'test_unreal_athlete_heads.mjs', 'test_unreal_character_preview.mjs',
    'test_unreal_clip_stage.mjs', 'test_unreal_position_still.mjs', 'test_unreal_technique_clips.mjs']) assert.ok(judging.includes(name), `${name} judges console errors`);
});
