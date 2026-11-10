// Used only by the trusted 49080 embedded client. Media readiness remains separate.
export function connectControl({ onOpen, onResponse, onClose, fetchFn = fetch, Socket = WebSocket }) {
  let socket = null, stopped = false, ready = false, credential = null;
  const abort = new AbortController();
  const deadline = setTimeout(() => stop(), 10000);
  const bounded = text => typeof text === 'string' && new TextEncoder().encode(text).length <= 8192
    && text.startsWith('{') && text.endsWith('}') && !text.includes('\0');
  function stop() {
    if (stopped) return;
    stopped = true; ready = false; credential = null;
    clearTimeout(deadline); abort.abort();
    if (socket) { socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); }
    onClose();
  }
  const connected = (async () => {
    try {
      const result = await fetchFn('http://127.0.0.1:49081/session', {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: abort.signal,
      });
      if (!result.ok || stopped) { stop(); return; }
      const body = await result.json();
      if (stopped) return;
      if (!body || Object.keys(body).sort().join(',') !== 'expiresInMs,token'
        || !/^[a-f0-9]{64}$/.test(body.token) || body.expiresInMs !== 10000) { stop(); return; }
      credential = body.token;
      socket = new Socket('ws://127.0.0.1:49081/browser');
      socket.onopen = () => { if (!stopped) { socket.send('BROWSER\n' + credential); credential = null; } };
      socket.onmessage = event => {
        if (stopped || typeof event.data !== 'string') { stop(); return; }
        if (!ready) {
          if (event.data !== 'READY') { stop(); return; }
          ready = true; clearTimeout(deadline); onOpen(); return;
        }
        if (!bounded(event.data)) { stop(); return; }
        onResponse(event.data);
      };
      socket.onclose = socket.onerror = stop;
    } catch { stop(); }
  })();
  return { connected, close: stop, isOpen: () => ready && !stopped,
    send(text) {
      if (!ready || stopped || !bounded(text) || socket.readyState !== 1 || socket.bufferedAmount > 32768) { stop(); return false; }
      try { socket.send(text); return true; } catch { stop(); return false; }
    },
  };
}
