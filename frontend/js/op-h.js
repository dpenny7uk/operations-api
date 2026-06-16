/* op-h.js — shared DOM builder used by op-pages.js and op-app.js IIFEs.
   Loaded before both so window.H is available when their IIFEs evaluate. */
(function () {
  'use strict';

  function h(tag, props) {
    const m = tag.match(/^([a-z0-9]+)([\.#][^]*)?$/i) || ['', 'div'];
    const el = document.createElement(m[1] || 'div');
    if (m[2]) m[2].replace(/([\.#])([^.#]+)/g, (_, s, v) => s === '.' ? el.classList.add(v) : (el.id = v));
    if (props) for (const k in props) {
      const v = props[k]; if (v == null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'on' && typeof v === 'object') for (const ev in v) el.addEventListener(ev, v[ev]);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k in el) { try { el[k] = v; } catch { el.setAttribute(k, v); } } else el.setAttribute(k, v);
    }
    // a11y (Change 4): a clickable generic cell/row becomes a keyboard-operable
    // button — role + tabindex here; Enter/Space activation is handled by the
    // document-level keydown listener below. Skips anything that already declares
    // its own role (nav-items, Servers env-rows, table rows set it inline).
    if (props && props.on && props.on.click && !el.getAttribute('role') &&
        (el.classList.contains('cs-cell') || el.classList.contains('env-row') || el.classList.contains('feed-item'))) {
      el.setAttribute('role', 'button');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i]; if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(x => { if (x != null) el.append(x.nodeType ? x : document.createTextNode(x)); });
      else el.append(c.nodeType ? c : document.createTextNode(c));
    }
    return el;
  }

  window.H = h;

  // a11y (Change 4): Enter / Space activates any non-native element exposed as a
  // button (role="button"). Elements that handle the key themselves call
  // preventDefault, so the defaultPrevented guard stops their click firing twice.
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const t = e.target;
    if (!t || t.nodeType !== 1 || t.getAttribute('role') !== 'button') return;
    const tag = t.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    if (typeof t.click === 'function') t.click();
  });
})();
