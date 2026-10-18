/* Speech synthesis for the kiosk browser. WPE WebKit is built without a speech engine and without audio, so this installs
   window.speechSynthesis / SpeechSynthesisUtterance on top of jaded's /tts API: the machine's own engine (Kokoro, or Flite
   as the fallback) makes the audio and plays it through ALSA. Runs before the page's own scripts (jaded injects it). */
(function () {
  var J = window.__JADED__;
  if (!J || !J.tts || !J.tts.engine || J.tts.engine === 'none') return;

  var voices = (J.tts.voices || []).map(function (v, i) {
    return { name: v.name, voiceURI: v.id, lang: v.lang || 'en-US', localService: true, default: i === 0 };
  });

  function Utterance(text) {
    this.text = text == null ? '' : String(text);
    this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1;
    this.onstart = this.onend = this.onerror = this.onboundary = this.onpause = this.onresume = this.onmark = null;
  }
  Utterance.prototype.addEventListener = function (t, f) { this['on' + t] = f; };

  var queue = [], current = null, speaking = false, tick = null, listeners = [];
  var synth = {
    onvoiceschanged: null,
    get speaking() { return speaking; },
    get pending() { return queue.length > 0; },
    get paused() { return false; },
    getVoices: function () { return voices.slice(); },
    speak: function (u) { queue.push(u); if (!current) next(); },
    cancel: function () {
      var q = queue; queue = [];
      var c = current; current = null;
      if (c) { c.aborted = true; stopTick(); speaking = false; fire(c.u, 'onerror', { error: 'canceled' }); }
      q.forEach(function (u) { fire(u, 'onerror', { error: 'canceled' }); });
      if (c) post('/tts/stop', {});
    },
    pause: function () {}, resume: function () {},
    addEventListener: function (t, f) { if (t === 'voiceschanged') listeners.push(f); },
    removeEventListener: function () {}
  };

  function fire(u, name, extra) {
    var f = u && u[name]; if (typeof f !== 'function') return;
    var ev = { type: name.slice(2), target: u, utterance: u, charIndex: 0, elapsedTime: 0, name: '' };
    if (extra) for (var k in extra) ev[k] = extra[k];
    try { f.call(u, ev); } catch (e) { try { console.error(e); } catch (_) {} }
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'X-Jaded-Token': J.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

  function next() {
    var u = queue.shift(); if (!u) { current = null; speaking = false; return; }
    var cur = { u: u, aborted: false }; current = cur;
    speaking = true;
    var voice = u.voice && u.voice.voiceURI;
    var started = false;
    function begin() {
      if (started || cur.aborted) return; started = true;
      fire(u, 'onstart');
      stopTick();
      // the page animates the avatar's mouth from word boundaries; there are none to report, so pulse while the audio plays
      tick = setInterval(function () { fire(u, 'onboundary', { name: 'word' }); }, 240);
    }
    post('/tts/speak', { text: u.text, voice: voice, rate: u.rate, pitch: u.pitch, volume: u.volume, lang: u.lang }).then(function (r) {
      if (cur.aborted) return;
      begin(); stopTick(); current = null; speaking = false;
      if (r && r.ok) fire(u, 'onend'); else fire(u, 'onerror', { error: (r && r.error) || 'synthesis-failed' });
      next();
    }, function (e) {
      if (cur.aborted) return;
      stopTick(); current = null; speaking = false; fire(u, 'onerror', { error: 'network' }); next();
    });
    // the request is held open until the audio has played, so the first audio is heard a little after this
    setTimeout(begin, 60);
  }

  try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true }); } catch (e) { window.speechSynthesis = synth; }
  window.SpeechSynthesisUtterance = Utterance;
  window.__jadeNativeTTS = true;
  setTimeout(function () { if (typeof synth.onvoiceschanged === 'function') try { synth.onvoiceschanged({ type: 'voiceschanged' }); } catch (e) {} listeners.forEach(function (f) { try { f({ type: 'voiceschanged' }); } catch (e) {} }); }, 0);
})();
