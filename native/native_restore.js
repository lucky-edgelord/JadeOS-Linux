/* One-time restore of a Jade Vault backup on a new JadeOS machine. The vault files are already on the disk; this puts
   the rest (settings, chats, schedules, flow runs, and the other app data) where the page keeps it, then reloads.
   jaded injects it only while a restore is pending (JADED_RESTORE file present). */
(function () {
  var J = window.__JADED__;
  if (!J || !J.restore) return;
  var x = new XMLHttpRequest();
  try { x.open('GET', '/native/restore', false); x.setRequestHeader('X-Jaded-Token', J.token); x.send(); } catch (e) { return; }
  if (x.status !== 200) return;
  var d; try { d = JSON.parse(x.responseText); } catch (e) { return; }
  window.__restoring = true;   // the page's own autosaves stay off until the reload
  try {
    localStorage.setItem('jvault:settings', JSON.stringify(d.settings || {}));
    for (var k in (d.storage || {})) localStorage.setItem('jvault:' + k, JSON.stringify(d.storage[k]));
  } catch (e) { try { console.error('restore: settings', e); } catch (_) {} }
  function done() {
    var y = new XMLHttpRequest(); try { y.open('POST', '/native/restore/done', false); y.setRequestHeader('X-Jaded-Token', J.token); y.send('{}'); } catch (e) {}
    location.reload();
  }
  var r = indexedDB.open('jade-vault', 1);
  r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
  r.onerror = function () { done(); };
  r.onsuccess = function () {
    var db = r.result, t = db.transaction('kv', 'readwrite'), st = t.objectStore('kv');
    st.clear();
    for (var k in (d.db || {})) st.put(d.db[k], k);
    t.oncomplete = function () { db.close(); done(); };
    t.onerror = function () { try { console.error('restore: db', t.error); } catch (_) {} db.close(); done(); };
  };
})();
