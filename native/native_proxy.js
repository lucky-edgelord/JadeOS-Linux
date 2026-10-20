// Requests the page makes to other sites (Ollama Cloud, Groq, OpenAI ...) go through jaded, which makes them from the machine.
// The browser then only talks to its own origin, so cross-origin (CORS) blocking cannot happen.
(function () {
  var J = window.__JADED__; if (!J || !J.proxy || !window.fetch) return;
  var orig = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    var url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href); } catch (e) { return orig(input, init); }
    if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return orig(input, init);
    var req = new Request(input, init), headers = {};
    req.headers.forEach(function (v, k) { headers[k] = v; });
    var body = (req.method === 'GET' || req.method === 'HEAD') ? undefined : await req.arrayBuffer();
    var r = await orig('/native/proxy', { method: 'POST', body: body, signal: req.signal, headers: {
      'X-Jaded-Token': J.token, 'X-Proxy-Url': url.href, 'X-Proxy-Method': req.method, 'X-Proxy-Headers': JSON.stringify(headers) } });
    var st; try { st = decodeURIComponent(r.headers.get('X-Proxy-Status-Text') || ''); } catch (e) { st = ''; }
    return new Response(r.body, { status: r.status, statusText: st, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream' } });
  };
})();
