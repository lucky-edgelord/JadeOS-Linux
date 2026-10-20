/* Mouse for the kiosk. Cog's DRM platform only passes the mouse on when its own pointer is on, and that pointer
   crashes on machines with unused video outputs (Cog 0.18 reads the resolution of a screen that is not there).
   So jaded reads the mouse itself (/dev/input) and sends the movement here; this draws a pointer and turns the
   movement, buttons and wheel into the page's mouse events. jaded injects it when JADED_POINTER=1. */
(function () {
  var J = window.__JADED__;
  if (!J || !J.pointer || !window.EventSource) return;
  var K = 1.5;                                   // pointer speed
  var x = Math.round(innerWidth / 2), y = Math.round(innerHeight / 2), buttons = 0, downEl = null, overEl = null;
  var c = document.createElement('div');
  c.id = '__jadePointer';
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;pointer-events:none;z-index:2147483647;display:none;will-change:transform';
  c.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 1.5v22.5l6-6 4 9.5 4-1.7-4-9.3h8.5z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function attach() { if (!c.parentNode) (document.body || document.documentElement).appendChild(c); }
  function place() { attach(); c.style.display = 'block'; c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
  function opts(extra) {
    var o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y,
      buttons: buttons, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }
  function fire(el, type, extra) {
    if (!el) return true;
    var E = type.indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : type === 'wheel' ? WheelEvent : MouseEvent;
    try { return el.dispatchEvent(new E(type, opts(extra))); } catch (e) { return el.dispatchEvent(new MouseEvent(type, opts(extra))); }
  }
  var at = function () { return document.elementFromPoint(x, y); };
  function move() {
    var el = at();
    if (el !== overEl) {
      if (overEl) { fire(overEl, 'pointerout', { relatedTarget: el }); fire(overEl, 'mouseout', { relatedTarget: el }); fire(overEl, 'mouseleave', { bubbles: false, relatedTarget: el }); }
      if (el) { fire(el, 'pointerover', { relatedTarget: overEl }); fire(el, 'mouseover', { relatedTarget: overEl }); fire(el, 'mouseenter', { bubbles: false, relatedTarget: overEl }); }
      overEl = el;
    }
    fire(el, 'pointermove'); fire(el, 'mousemove');
  }
  var FOCUSABLE = 'input,textarea,select,button,a[href],[tabindex],[contenteditable=""],[contenteditable="true"]';
  function press(i, down) {
    var el = at(), b = [0, 2, 1][i], mask = [1, 2, 4][i];
    if (b === undefined) return;
    if (down) {
      buttons |= mask; downEl = el;
      fire(el, 'pointerdown', { button: b });
      if (fire(el, 'mousedown', { button: b }) && b === 0) {
        var f = el && el.closest && el.closest(FOCUSABLE);
        if (f && f.focus) f.focus();
        else if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
      }
    } else {
      buttons &= ~mask;
      fire(el, 'pointerup', { button: b }); fire(el, 'mouseup', { button: b });
      if (b === 0 && el && downEl && (el === downEl || downEl.contains(el) || el.contains(downEl))) {
        if (typeof el.click === 'function') el.click(); else fire(el, 'click');
      }
      if (b === 2) fire(el, 'contextmenu', { button: 2 });
      downEl = null;
    }
  }
  function wheel(w) {
    var el = at(), dy = -w * 90;
    if (!fire(el, 'wheel', { deltaY: dy, deltaMode: 0 })) return;
    for (var s = el; s && s !== document.body && s !== document.documentElement; s = s.parentElement) {
      var cs = getComputedStyle(s);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) && s.scrollHeight > s.clientHeight + 1) { s.scrollBy(0, dy); return; }
    }
    (document.scrollingElement || document.documentElement).scrollBy(0, dy);
  }
  function handle(d) {
    if (d.dx || d.dy) {
      x = Math.max(0, Math.min(innerWidth - 1, Math.round(x + d.dx * K)));
      y = Math.max(0, Math.min(innerHeight - 1, Math.round(y + d.dy * K)));
      place(); move();
    }
    (d.b || []).forEach(function (p) { if (p[1] !== 2) press(p[0], p[1] === 1); });
    if (d.w) wheel(d.w);
  }
  window.__jadePointer = { handle: handle, pos: function () { return [x, y]; } };
  var es = new EventSource('/native/events?token=' + encodeURIComponent(J.token));
  es.addEventListener('ptr', function (m) { try { handle(JSON.parse(m.data)); } catch (e) { try { console.error(e); } catch (_) {} } });
})();
