'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const local = require('./pixel_streaming_local.cjs');

const info = (address, origin) => ({ origin, req: { socket: { remoteAddress: address } } });

test('player requires loopback and the exact local page origin', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        assert.equal(local.acceptPlayer(info(address, local.ORIGIN)), true);
        for (const origin of [undefined, 'null', 'http://localhost:49080', 'http://127.0.0.1:49081', 'https://example.com']) {
            assert.equal(local.acceptPlayer(info(address, origin)), false);
        }
    }
    assert.equal(local.acceptPlayer(info('192.0.2.3', local.ORIGIN)), false);
    assert.equal(local.acceptPlayer({}), false);
});

test('native streamer may omit Origin but may not come from another host or page', () => {
    assert.equal(local.acceptStreamer(info('127.0.0.1')), true);
    assert.equal(local.acceptStreamer(info('127.0.0.1', local.ORIGIN)), true);
    assert.equal(local.acceptStreamer(info('192.0.2.3')), false);
    assert.equal(local.acceptStreamer(info('127.0.0.1', 'https://example.com')), false);
});

test('UE5.8 host-only native Origin is accepted only on loopback', () => {
    assert.equal(local.acceptStreamer(info('127.0.0.1', 'http://127.0.0.1')), true);
    assert.equal(local.acceptStreamer(info('192.0.2.3', 'http://127.0.0.1')), false);
    for (const origin of ['http://127.0.0.1:9999', 'http://localhost', 'https://example.com']) {
        assert.equal(local.acceptStreamer(info('127.0.0.1', origin)), false);
    }
});

test('static file resolution rejects encoded traversal and malformed input', () => {
    const root = path.resolve('isolated-public');
    assert.equal(local.fileFor('/', root), path.join(root, 'player.html'));
    assert.equal(local.fileFor('/images/icon.png?q=x', root), path.join(root, 'images', 'icon.png'));
    assert.equal(local.fileFor('/..%2f..%2fsecret', root), null);
    assert.equal(local.fileFor('/%zz', root), null);
    assert.equal(local.fileFor('/..%5c..%5csecret', root), null);
});

test('embedded player routes are fixed and never alter the stock default route', () => {
    assert.equal(local.APP_ORIGIN, 'http://127.0.0.1:5178');
    assert.ok(local.embeddedFile('/jiuquest/embed').file.endsWith(path.join('tools', 'unreal_embed.html')));
    assert.ok(local.embeddedFile('/jiuquest/embed.js?nonce=ignored').file.endsWith(path.join('tmp', 'unreal-pilot', 'jiuquest-embed.js')));
    for (const route of ['/', '/jiuquest/', '/jiuquest/embed.js.map', '/jiuquest/%65mbed', '/..%2f..%2fsecret', '/jiuquest/embed/secret']) assert.equal(local.embeddedFile(route), null);
    const root = path.resolve('isolated-public');
    assert.equal(local.fileFor('/', root), path.join(root, 'player.html'));
});

test('SDK reuses owned HTTP servers, has no SFU or external ICE endpoint', () => {
    const player = {}, streamer = {};
    const config = local.makeSignallingConfig(player, streamer);
    assert.equal(config.httpServer, player);
    assert.equal(config.streamerWsOptions.server, streamer);
    assert.equal(config.streamerWsOptions.port, undefined);
    assert.equal(config.streamerWsOptions.host, '127.0.0.1');
    assert.equal(config.sfuPort, undefined);
    assert.deepEqual(config.peerOptions, { iceServers: [] });
    assert.equal(config.maxSubscribers, 1);
});

test('listen forces loopback and rejects an unexpected actual address without real sockets', async () => {
    class FakeServer extends EventEmitter {
        listen(options) { this.options = options; queueMicrotask(() => this.emit('listening')); }
        address() { return { address: this.actual || local.HOST, port: this.options.port }; }
    }
    const server = new FakeServer();
    await local.listen(server, local.PLAYER_PORT);
    assert.deepEqual(server.options, { port: local.PLAYER_PORT, host: '127.0.0.1', exclusive: true });
    const wrong = new FakeServer(); wrong.actual = '0.0.0.0';
    await assert.rejects(local.listen(wrong, local.STREAMER_PORT), /Unexpected listener binding/);
    const occupied = new FakeServer();
    occupied.listen = function () { queueMicrotask(() => this.emit('error', new Error('EADDRINUSE'))); };
    await assert.rejects(local.listen(occupied, local.STREAMER_PORT), /EADDRINUSE/);
    assert.equal(occupied.listenerCount('listening'), 0);
});

test('cleanup destroys upgraded sockets and closes both owned listeners', async () => {
    let destroyed = 0, closed = 0, httpClosed = 0;
    const socket = { destroy() { destroyed++; } };
    const servers = [0, 1].map(() => ({ listening: true, close(callback) { closed++; callback(); }, closeAllConnections() { httpClosed++; } }));
    await local.closeSockets(servers, new Set([socket]));
    assert.equal(destroyed, 1); assert.equal(closed, 2); assert.equal(httpClosed, 2);
    await local.closeSockets([{ listening: false }], new Set());
});

test('bindings cannot be overridden through command arguments', async () => {
    await assert.rejects(local.main(['--host', '0.0.0.0']), /Only --check is supported/);
});
