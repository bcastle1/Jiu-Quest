// The browser suites and the network of the machine that runs them.
//
// Each browser suite (package.json "test:browser") serves the build from its own
// node:http server on 127.0.0.1 and fails on any console error it does not expect.
// One console error says nothing about the site: Chromium asked the operating system
// for a socket and got none. "Failed to load resource: net::ERR_NO_BUFFER_SPACE" is
// Chromium's name for WSAENOBUFS on Windows (ENOBUFS elsewhere): the host had no
// socket buffer, or no ephemeral port, left for a new connection. On Windows a
// connect() fails with WSAENOBUFS once the dynamic ports (16,384 by default) are in
// use, and a socket the browser closed first keeps its port for two to four minutes
// in TIME_WAIT. The deploy of 64a7370 failed on one such line, for a font of
// test_match_moments' own server, after every check of that suite had passed.
//
// So this module does two things for every suite that fails on console errors.
//
// It keeps the suite from using up the machine's ports (closingIdleFirst): a browser
// context opens six connections at its first page load and, when it closes, closes
// the ones still open itself, each keeping one of the browser's ports in TIME_WAIT.
// Here, just before a context closes, the suite's server closes the connections that
// have answered a request and have nothing left to send, so the TIME_WAIT is on the
// server's own port and the browser's ports are free at once. Chromium has used each
// of those connections, so a request it was sending on one just then is sent again on
// a new one, and the operating system still delivers the last answer, which it already
// has. Two kinds are left alone. A connection that has not answered yet: Chromium may
// have just opened it for a request, and it does not send a request again on a
// connection it has just opened. A connection whose answer is still being written, or
// still sits in Node: closing it would cut the answer short (net::ERR_CONTENT_LENGTH_MISMATCH
// or net::ERR_EMPTY_RESPONSE). Node's own server.closeIdleConnections() closes
// that last kind: it takes an answer as done once end() is called, before the operating
// system has its bytes, which on Linux and macOS can be long before for a big file.
// Measured on test_match_moments (November 18, 2026: 340 connections, 2994 requests):
// the browser's ports in TIME_WAIT peaked at 216 without this and at 2 with it, with
// the same connections, requests and checks.
//
// And it tells a runner error apart (take): the line above, for a file of the suite's
// own 127.0.0.1 server, is kept in the suite's report (runnerErrors) and printed as a
// warning, a warning annotation on GitHub Actions; it is never dropped. The suite's
// checks still decide: a page that the failed load broke fails them (a missing script
// is a page error, a missing picture or clip a check that times out). Every other
// console error is judged by the suite as before. The line has to be the network log's
// own: Chromium writes it with the failed file's URL at line 0, column 0, where a
// script that logged the same words would show its own place in its own file.
//
// Only net::ERR_NO_BUFFER_SPACE is a runner error; on Windows Chromium gives it for
// WSAENOBUFS alone (net/base/net_errors_win.cc). The other socket errors are not,
// because the suite or the page can cause them: ERR_CONNECTION_REFUSED, _RESET,
// _CLOSED, _ABORTED, ERR_EMPTY_RESPONSE and ERR_TIMED_OUT come from a server that
// stopped, cut a response off or hung; ERR_FAILED and ERR_ABORTED from a blocked route
// or a cancelled load; ERR_ADDRESS_IN_USE also from a port the suite itself holds;
// ERR_INSUFFICIENT_RESOURCES and ERR_OUT_OF_MEMORY from a page that leaks or asks for
// too much. A line on another origin (a preview URL, another port, localhost by name)
// is never one.
import { escapeAnnotation } from './ci_error_annotation.mjs';

export const RUNNER_NETWORK_ERRORS = Object.freeze(['net::ERR_NO_BUFFER_SPACE']);
const LOCAL_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+$/;

// The runner error that a console entry ({ text, location: { url, lineNumber, columnNumber } },
// as Playwright gives it) is, or null. `origin` is the suite's own server,
// http://127.0.0.1:<port>; without it, nothing is.
export function runnerNetworkError(entry, origin) {
  if (typeof origin !== 'string' || !LOCAL_ORIGIN.test(origin)) return null;
  const found = /^Failed to load resource: (net::ERR_[A-Z_]+)$/.exec(typeof entry?.text === 'string' ? entry.text : '');
  if (!found || !RUNNER_NETWORK_ERRORS.includes(found[1])) return null;
  const { url, lineNumber, columnNumber } = entry.location ?? {};
  if (lineNumber !== 0 || columnNumber !== 0) return null;
  try { return new URL(url).origin === origin ? found[1] : null; } catch { return null; }
}

// One per suite, named after its file (match-moments for test_match_moments.mjs).
// `serving(server)` once the suite's own server listens, before the browser asks it for
// anything. `closingIdleFirst(browser)` on the browser the suite launches. `take(entry)` first
// in the console handler: true when the entry is a runner error, which is then kept in `errors`
// (with any other fields the suite gave the entry) and printed, false for anything else.
export function runnerNetwork(suite, { warn = (line) => console.warn(line), env = process.env } = {}) {
  if (!/^[a-z0-9-]+$/.test(suite)) throw new Error(`a suite is named with lower-case letters, digits and hyphens (${suite})`);
  const errors = [];
  let origin = null;
  // Each open connection of the suite's server: its answers still being written (`open`, from
  // the request until the answer closes) and its answers whose last byte Node has handed to the
  // operating system (`sent`, at the answer's 'finish').
  const connections = new Map();
  const track = (socket) => {
    let count = connections.get(socket);
    if (!count && !socket.destroyed) {
      connections.set(socket, count = { open: 0, sent: 0 });
      socket.once('close', () => connections.delete(socket));
    }
    return count;
  };
  const counting = ({ socket }, response) => {
    const count = track(socket);
    if (!count) return;
    count.open += 1;
    response.once('finish', () => { count.sent += 1; });
    response.once('close', () => { count.open -= 1; });
  };
  const closeAnswered = () => {
    for (const [socket, { open, sent }] of connections) if (sent > 0 && open === 0) socket.destroy();
  };
  return {
    errors,
    get origin() { return origin; },
    serving(own) {
      const { address, port } = own.address() ?? {};
      if (address !== '127.0.0.1' || !Number.isInteger(port)) throw new Error(`${suite}: runner errors are only told apart on the suite's own 127.0.0.1 server`);
      if (origin) throw new Error(`${suite}: one server per suite`);
      // Every connection from its first moment, and every answer before the suite's own handler starts it.
      own.on('connection', track);
      own.prependListener('request', counting);
      origin = `http://127.0.0.1:${port}`;
      return origin;
    },
    // Every context of this browser has the suite's server close the connections that have
    // answered and have nothing left to send just before it closes (see the top of this file).
    // Without a server of the suite's own (a preview URL) it just closes.
    closingIdleFirst(browser) {
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...options) => {
        const context = await newContext(...options);
        const close = context.close.bind(context);
        context.close = (...rest) => { closeAnswered(); return close(...rest); };
        return context;
      };
      return browser;
    },
    take(entry) {
      const code = runnerNetworkError(entry, origin);
      if (!code) return false;
      errors.push({ ...entry, code, atUtc: entry.atUtc ?? new Date().toISOString() });
      const line = `${suite}: "${entry.text}" for ${entry.location.url} is the runner's error, not the site's: the host had no socket buffer or port free. Kept in the report as runnerErrors; the suite's checks decide.`;
      warn(env.GITHUB_ACTIONS === 'true' ? `::warning title=Runner network error in ${suite}::${escapeAnnotation(line)}` : `Warning: ${line}`);
      return true;
    },
  };
}
