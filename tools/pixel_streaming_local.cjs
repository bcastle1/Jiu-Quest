'use strict';

// Original local harness; Epic's implementation and dependencies remain ignored.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PILOT = path.join(ROOT, 'tmp', 'unreal-pilot');
const INFRA = path.join(PILOT, 'PixelStreamingInfrastructure-UE5.8');
const SOURCE_COMMIT = '4afd64170216002070a42fa52a87a44d4e97e77c';
const HOST = '127.0.0.1';
const PLAYER_PORT = 49080;
const STREAMER_PORT = 49088;
const ORIGIN = `http://${HOST}:${PLAYER_PORT}`;
// UE5.8's native WebSocket client sends this host-only Origin on loopback.
const NATIVE_STREAMER_ORIGIN = `http://${HOST}`;
const PACKAGES = {
    common: '0.1.0', signalling: '0.2.0', frontend: '0.1.3', 'frontend-ui': '0.1.2'
};

const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const acceptPlayer = info => loopback(info.req?.socket?.remoteAddress) && info.origin === ORIGIN;
const acceptStreamer = info => loopback(info.req?.socket?.remoteAddress)
    && (!info.origin || info.origin === ORIGIN || info.origin === NATIVE_STREAMER_ORIGIN);

function fileFor(url, publicRoot) {
    try {
        const pathname = decodeURIComponent(new URL(url, ORIGIN).pathname);
        if (pathname.includes('\\')) return null;
        const file = path.resolve(publicRoot, '.' + (pathname === '/' ? '/player.html' : pathname));
        return file.startsWith(publicRoot + path.sep) ? file : null;
    } catch { return null; }
}

function loadInfrastructure() {
    if (!fs.existsSync(path.join(INFRA, 'package.json'))) {
        throw new Error('Prepare the pinned UE5.8 infrastructure first; see docs/unreal-local-streaming.md.');
    }
    const git = args => execFileSync('git', args, { cwd: INFRA, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    assert.equal(git(['rev-parse', 'HEAD']), SOURCE_COMMIT, 'Unexpected infrastructure revision');
    assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Infrastructure source was modified');
    const vendorRequire = createRequire(path.join(INFRA, 'package.json'));
    const versions = {};
    for (const [name, version] of Object.entries(PACKAGES)) {
        const id = `@epicgames-ps/lib-pixelstreaming${name}-ue5.8`;
        versions[id] = vendorRequire(id + '/package.json').version;
        assert.equal(versions[id], version, 'Unexpected SDK package ' + id);
    }
    const { SignallingServer, InitLogging } = vendorRequire('@epicgames-ps/lib-pixelstreamingsignalling-ue5.8');
    const { SignallingProtocol } = vendorRequire('@epicgames-ps/lib-pixelstreamingcommon-ue5.8');
    assert.equal(SignallingProtocol.SIGNALLING_VERSION, '1.3.0');
    const publicRoot = fs.realpathSync(path.join(INFRA, 'SignallingWebServer', 'www'));
    for (const name of ['player.html', 'player.js']) assert.ok(fs.statSync(path.join(publicRoot, name)).isFile());
    return { SignallingServer, InitLogging, publicRoot, versions, protocol: SignallingProtocol.SIGNALLING_VERSION };
}

function checkGuards(publicRoot) {
    const info = (address, origin) => ({ origin, req: { socket: { remoteAddress: address } } });
    assert.equal(acceptPlayer(info(HOST, ORIGIN)), true);
    assert.equal(acceptPlayer(info(HOST, 'https://example.com')), false);
    assert.equal(acceptPlayer(info(HOST)), false);
    assert.equal(acceptPlayer(info('192.0.2.1', ORIGIN)), false);
    assert.equal(acceptStreamer(info(HOST)), true);
    assert.equal(acceptStreamer(info(HOST, NATIVE_STREAMER_ORIGIN)), true);
    assert.equal(acceptStreamer(info(HOST, 'http://127.0.0.1:9999')), false);
    assert.equal(acceptStreamer(info('192.0.2.1')), false);
    assert.equal(acceptStreamer(info(HOST, 'https://example.com')), false);
    assert.equal(fileFor('/..%2f..%2fpackage.json', publicRoot), null);
    assert.equal(fileFor('/..%5c..%5cpackage.json', publicRoot), null);
    assert.equal(fileFor('/%zz', publicRoot), null);
}

function listen(server, port) {
    return new Promise((resolve, reject) => {
        const fail = error => { server.removeListener('listening', ready); reject(error); };
        const ready = () => {
            server.removeListener('error', fail);
            const address = server.address();
            if (address?.address !== HOST || address?.port !== port) reject(new Error('Unexpected listener binding'));
            else resolve();
        };
        server.once('error', fail);
        server.once('listening', ready);
        server.listen({ port, host: HOST, exclusive: true });
    });
}

// Own the underlying servers and accepted sockets, including upgraded WebSockets.
// Closing only HTTP connections would leave the streamer's upgraded socket alive.
async function closeSockets(servers, sockets) {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => {
        if (!server.listening) { resolve(); return; }
        server.close(() => resolve());
        server.closeAllConnections?.();
    })));
}

function makeSignallingConfig(playerServer, streamerServer) {
    return {
        httpServer: playerServer,
        streamerPort: STREAMER_PORT,
        // Supplying an already bound server prevents the SDK creating a wildcard listener.
        streamerWsOptions: { server: streamerServer, port: undefined, host: HOST, verifyClient: acceptStreamer },
        playerWsOptions: { verifyClient: acceptPlayer },
        peerOptions: { iceServers: [] }, maxSubscribers: 1, playerKeepaliveTimeout: 30000
    };
}

async function main(args = process.argv.slice(2)) {
    if (args.some(arg => arg !== '--check')) throw new Error('Only --check is supported; bindings cannot be overridden.');
    const sdk = loadInfrastructure();
    checkGuards(sdk.publicRoot);
    const summary = {
        infrastructureCommit: SOURCE_COMMIT, host: HOST, playerPort: PLAYER_PORT,
        streamerPort: STREAMER_PORT, origin: ORIGIN, signallingProtocol: sdk.protocol,
        packages: sdk.versions, sfuEnabled: false, iceServers: []
    };
    if (args.includes('--check')) {
        console.log(JSON.stringify({ status: 'prepared_not_started', ...summary }, null, 2));
        return;
    }

    sdk.InitLogging({ logDir: path.join(PILOT, 'pixelstreaming-logs'), logLevelConsole: 'info', logLevelFile: 'info' });
    let signalling;
    const playerServer = http.createServer((req, res) => {
        if (!loopback(req.socket.remoteAddress) || req.headers.host !== `${HOST}:${PLAYER_PORT}`) {
            res.writeHead(403); res.end(); return;
        }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        if (req.url === '/healthz') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: signalling ? 'signalling_ready' : 'starting', streamers: signalling?.streamerRegistry.count() || 0, players: signalling?.playerRegistry.count() || 0, signallingProtocol: sdk.protocol }));
            return;
        }
        try {
            const candidate = fileFor(req.url, sdk.publicRoot);
            const file = candidate && fs.realpathSync(candidate);
            if (!file || !file.startsWith(sdk.publicRoot + path.sep) || !fs.statSync(file).isFile()) {
                res.writeHead(404); res.end(); return;
            }
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
            const bytes = fs.readFileSync(file);
            res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length });
            res.end(req.method === 'HEAD' ? undefined : bytes);
        } catch { res.writeHead(404); res.end(); }
    });
    const streamerServer = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    const servers = [playerServer, streamerServer], sockets = new Set();
    let closing;
    const shutdown = (code, error) => {
        if (closing) return closing;
        if (error) console.error('Local Pixel Streaming stopped: ' + error.message);
        process.exitCode = code;
        const deadline = setTimeout(() => process.exit(code), 2000);
        closing = closeSockets(servers, sockets).finally(() => { clearTimeout(deadline); process.exit(code); });
        return closing;
    };
    for (const server of servers) {
        server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
        server.on('error', error => { void shutdown(1, error); });
    }
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(0); });
    // The upstream SDK does not expose its WebSocketServer error emitters. Treat an
    // unexpected SDK/socket exception as fatal and close both owned listeners.
    process.once('uncaughtException', error => { void shutdown(1, error); });
    process.once('unhandledRejection', error => { void shutdown(1, error instanceof Error ? error : new Error(String(error))); });
    try {
        await listen(playerServer, PLAYER_PORT);
        await listen(streamerServer, STREAMER_PORT);
        signalling = new sdk.SignallingServer(makeSignallingConfig(playerServer, streamerServer));
        console.log(JSON.stringify({ event: 'local_pixelstreaming_ready', url: ORIGIN, streamerUrl: `ws://${HOST}:${STREAMER_PORT}`, ...summary }));
    } catch (error) { await shutdown(1, error); }
}

module.exports = { HOST, PLAYER_PORT, STREAMER_PORT, ORIGIN, loopback, acceptPlayer, acceptStreamer, fileFor, checkGuards, listen, closeSockets, makeSignallingConfig, main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
