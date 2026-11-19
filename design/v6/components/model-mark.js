/* boopis v6 · model marks (shared library, beside components.js; owner: design-system agent)
   Which model answered, at a glance: the provider's logo beside the model's name, never instead of it.

     HX.ui.modelMark(ref, {size, color, label}) -> SVGElement   HX.ui.html.modelMark(ref, o) -> string
       ref: 'sonnet 5.5' | 'bedrock/anthropic.claude-sonnet-4' | 'ollama/my-finetune' | {model, host}
       size: px, 14–20 (default 16). color: 'mono' (default: currentColor, so it follows the theme's tokens)
       or 'brand' (the provider's colours; only in the model selection menu and its chip preview).
       label: the accessible name, the family's ("Claude", "OpenAI"); false when the mark sits in an aria-hidden slot.
     HX.ui.html.model(ref, o)       -> mark + name, one unit that never breaks across lines ({mono, size, color})
     HX.ui.html.modelRoute(text, o) -> 'qwen3-coder → sonnet 5.5': both marks and names, the arrow kept
     HX.ui.modelMark.family(ref)    -> {id, name, icon, model, host}
     HX.ui.modelMark.parse(text)    -> ['qwen3-coder', 'sonnet 5.5'];  .last(text) -> the model that answered
     HX.ui.modelMark.swap(root, ref) re-draws the first mark under root (a chip or picker after a new choice)

   The family comes from the model id (the last path segment), never the host: Claude through Bedrock is still
   Claude. A model whose family is unknown gets the served-by mark (local Ollama) or a neutral generic mark,
   never the φ. The mapping is data: vendor/model-icons/map.json, built with the SVGs into icons.js.

   The library's own pieces take a model too, so every caller goes through this one primitive:
     html.menuItems  item {model}            -> a brand mark leads the label (a menu of models is the picker)
     html.chip       {model, modelColor}     -> a mono mark in place of the icon; label defaults to the name
     html.ladder     variant 'list'          -> every station's name leads with its mono mark
     html.entry      callno [{model, via}]   -> the call number's model lines carry their marks ("→" kept); an agent
                                                entry's leading string lines ('qwen3-coder', '→ sonnet 5.5') are read
                                                the same way when they name a known family
   Load order: vendor/model-icons/icons.js, then this file, after components.js. CSS: model-mark.css. */
(function () {
  'use strict';
  const HX = window.HX, ui = HX && HX.ui;
  if (!ui || !ui.html) { console.error('model-mark.js: load components/components.js first'); return; }
  const DATA = window.HX_MODEL_ICONS;
  if (!DATA) console.error('model-mark.js: load vendor/model-icons/icons.js first; every model gets the generic mark');
  const H = ui.html;
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

  const MAP = DATA ? DATA.map : { families: [], served: [], fallback: { id: 'generic', name: 'Unknown provider', icon: 'generic' } };
  const ICONS = DATA ? DATA.icons : {};
  const FAMILIES = MAP.families.map((f) => Object.assign({}, f, { re: new RegExp(f.match, 'i') }));

  /* a ref is the model id, optionally behind a host path ('openrouter/anthropic/claude-sonnet-4.5'), or {model, host} */
  function split(ref) {
    if (ref && typeof ref === 'object') return { model: String(ref.model || ref.id || ''), host: String(ref.host || ref.provider || ref.via || '').toLowerCase() };
    const s = String(ref == null ? '' : ref).trim(), i = s.lastIndexOf('/');
    return i < 0 ? { model: s, host: '' } : { model: s.slice(i + 1), host: s.slice(0, i).toLowerCase() };
  }
  const cache = new Map();
  function family(ref) {
    const r = split(ref), key = r.host + '\u0000' + r.model;
    let f = cache.get(key);
    if (!f) {
      f = FAMILIES.find((x) => x.re.test(r.model)) ||
        MAP.served.find((x) => x.hosts.some((h) => r.host.split(/[/.:]/).indexOf(h) >= 0)) || MAP.fallback;
      cache.set(key, f);
    }
    return { id: f.id, name: f.name, icon: f.icon, model: r.model, host: r.host };
  }
  const parse = (text) => String(text == null ? '' : text).split(/\s*(?:→|->)\s*/).map((s) => s.trim()).filter(Boolean);
  const last = (text) => { const p = parse(text); return p[p.length - 1] || ''; };

  /* gradients carry ids: each drawn copy gets its own, so two Meta marks on a page never share a gradient */
  let uid = 0;
  function markHTML(ref, o) {
    o = o || {};
    const f = family(ref), ic = ICONS[f.icon] || ICONS.generic;
    const size = o.size || 16, brand = o.color === 'brand';
    const label = o.label === false ? null : (o.label || f.name);
    const a = 'class="ui-mm' + (o.class ? ' ' + esc(o.class) : '') + '" data-family="' + esc(f.id) + '" data-color="' + (brand ? 'brand' : 'mono') + '" width="' + size + '" height="' + size +
      '" style="--mm-size:' + size + 'px"' + (label ? ' role="img" aria-label="' + esc(label) + '"' : ' aria-hidden="true"') + ' focusable="false"';
    if (!ic) return '<svg ' + a + ' viewBox="0 0 24 24"></svg>';
    const v = brand && ic.color ? ic.color : ic.mono;
    let body = v.body;
    if (body.indexOf(' id="') >= 0) {
      const k = '-mm' + (++uid);
      body = body.replace(/ id="([^"]+)"/g, ' id="$1' + k + '"').replace(/url\(#([^)]+)\)/g, 'url(#$1' + k + ')');
    }
    return '<svg ' + a + ' viewBox="' + v.viewBox + '"' + (v.attrs ? ' ' + v.attrs : '') + '>' + body + '</svg>';
  }
  const tpl = document.createElement('template');
  const frag = (s) => { tpl.innerHTML = s; return tpl.content.firstElementChild; };

  /* mark + name: the name stays (a logo alone is never the answer to "which model"), and the pair never wraps apart */
  function modelHTML(ref, o) {
    o = o || {};
    const f = family(ref), name = o.name != null ? o.name : (typeof ref === 'object' ? f.model : String(ref));
    return '<span class="ui-model' + (o.class ? ' ' + esc(o.class) : '') + '" data-family="' + esc(f.id) + '">' + markHTML(ref, o) +
      '<span class="' + (o.mono === false ? 'ui-model__name' : 'ui-model__name ui-mono') + '">' + esc(name) + '</span></span>';
  }
  const arrowHTML = (via) => '<span class="ui-model-route__to" aria-hidden="true">' + esc(via || '→') + '</span><span class="ui-sr">then</span>';
  function routeHTML(text, o) {
    const p = parse(text);
    return '<span class="ui-model-route">' + p.map((m, i) => (i ? arrowHTML() : '') + modelHTML(m, o)).join('') + '</span>';
  }

  const modelMark = (ref, o) => frag(markHTML(ref, o));
  modelMark.family = family;
  modelMark.parse = parse;
  modelMark.last = last;
  modelMark.families = () => FAMILIES.map((f) => ({ id: f.id, name: f.name })).concat(MAP.served.map((f) => ({ id: f.id, name: f.name })), [{ id: MAP.fallback.id, name: MAP.fallback.name }]);
  modelMark.swap = function (root, ref, o) {
    const old = root && root.querySelector('.ui-mm');
    if (!old) return null;
    const next = frag(markHTML(ref, Object.assign({ size: +old.getAttribute('width') || 16, color: old.getAttribute('data-color'), label: old.hasAttribute('aria-label') ? undefined : false }, o)));
    old.replaceWith(next);
    return next;
  };
  ui.modelMark = modelMark;
  ui.model = (ref, o) => frag(modelHTML(ref, o));
  ui.modelRoute = (text, o) => frag(routeHTML(text, o));
  H.modelMark = markHTML;
  H.model = modelHTML;
  H.modelRoute = routeHTML;

  /* ───────────── the library's pieces, through the one primitive ───────────── */
  const menuItems0 = H.menuItems;
  H.menuItems = function (items, o) {
    const out = menuItems0.call(this, items, o);
    if (!items || !items.some((x) => x && x.model)) return out;
    const t = document.createElement('template');
    t.innerHTML = out;
    const btns = t.content.querySelectorAll('.ui-menu__item');
    let i = 0;
    for (const x of items) {
      if (!x || x === '-' || x.title || x.foot) continue;
      const b = btns[i++];
      if (!b || !x.model) continue;
      const lab = b.querySelector('.ui-menu__label');
      lab.insertAdjacentHTML('afterbegin', markHTML(x.model, { size: 16, color: x.modelColor || 'brand' }));
      lab.setAttribute('data-content', '');
    }
    return t.innerHTML;
  };
  const chip0 = H.chip;
  H.chip = function (o) {
    if (!o || !o.model) return chip0.apply(this, arguments);
    const out = chip0.call(this, Object.assign({}, o, { icon: null, mono: o.mono !== false, label: o.label != null ? o.label : split(o.model).model }));
    return out.replace(/^(<button[^>]*>)/, '$1' + markHTML(o.model, { size: 14, color: o.modelColor || 'mono' }));
  };
  const ladder0 = H.ladder;
  H.ladder = function (o) {
    const out = ladder0.apply(this, arguments);
    if (!o || o.variant !== 'list' || o.marks === false) return out;
    const L = o.stations || [];
    let i = 0;
    return out.replace(/<span class="ui-ladder__name">/g, (m) => m + markHTML((L[i++] || [])[0], { size: 14 }));
  };
  /* an agent's call number starts with its model, then '→ model' for each step up the ladder: those leading string
     lines are read as models when they name a known family (a time or a cost never does) */
  const known = (s) => { const f = family(s); return f.id !== MAP.fallback.id; };
  function leadingModels(o) {
    const out = (o.callno || []).slice();
    if (o.kind !== 'agent') return out;
    for (let i = 0; i < out.length; i++) {
      const l = out[i];
      if (l && typeof l === 'object') continue;
      const m = /^\s*(→|->)\s*(.+)$/.exec(String(l)), name = m ? m[2] : String(l);
      if ((i === 0) === !!m || !known(name)) break;
      out[i] = m ? { model: name, via: m[1] } : { model: name };
    }
    return out;
  }
  const entry0 = H.entry;
  H.entry = function (o) {
    const lines = o ? leadingModels(o) : [];
    if (!lines.some((l) => l && typeof l === 'object')) return entry0.apply(this, arguments);
    const held = [];
    const callno = lines.map((l) => (l && typeof l === 'object' ? '' + (held.push(l) - 1) + '' : l));
    return entry0.call(this, Object.assign({}, o, { callno })).replace(/(\d+)/g, (_, k) => {
      const l = held[+k];
      return (l.via ? arrowHTML(l.via) : '') + modelHTML(l.model, { size: l.size || 14 });
    });
  };
})();
