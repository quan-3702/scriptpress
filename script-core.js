// ScriptPress – screenplay model, industry-standard pagination, Fountain/FDX import & export, reports, PDF (no DOM).
const SC = (() => {
// ---------- elements ----------
// type: scene | action | character | paren | dialogue | transition | shot | general
const TYPES = ['scene', 'action', 'character', 'paren', 'dialogue', 'transition', 'shot', 'general'];
const TYPE_NAMES = { scene: 'Scene Heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot', general: 'General' };
// what comes after Enter / what Tab turns an element into
const NEXT = { scene: 'action', action: 'action', character: 'dialogue', paren: 'dialogue', dialogue: 'character', transition: 'scene', shot: 'action', general: 'action' };
const TAB = { action: 'character', character: 'transition', scene: 'action', dialogue: 'paren', paren: 'dialogue', transition: 'scene', shot: 'action', general: 'action' };
const UPPER = { scene: true, character: true, transition: true, shot: true };
// layout in characters (Courier 12 pt = 10 characters per inch, 6 lines per inch). Page body starts 1.5" from the left.
const LAYOUT = {
  scene: { x: 0, w: 61, before: 2 }, action: { x: 0, w: 61, before: 1 }, character: { x: 22, w: 38, before: 1 },
  paren: { x: 16, w: 26, before: 0 }, dialogue: { x: 10, w: 35, before: 0 }, transition: { x: 0, w: 60, before: 1, right: true },
  shot: { x: 0, w: 61, before: 1 }, general: { x: 0, w: 61, before: 1 },
};
const DUAL = { character: [{ x: 6, w: 22 }, { x: 37, w: 22 }], paren: [{ x: 3, w: 24 }, { x: 34, w: 24 }], dialogue: [{ x: 0, w: 28 }, { x: 31, w: 28 }] };
const PAGE_LINES = 54; // 1" top and bottom margins on US Letter
const REV_COLORS = [['White', '#ffffff'], ['Blue', '#c9ddff'], ['Pink', '#ffd3e6'], ['Yellow', '#fff6b3'], ['Green', '#cdf3cd'], ['Goldenrod', '#f1d28a'], ['Buff', '#f3e3c5'], ['Salmon', '#ffc7b3'], ['Cherry', '#f6a5b5'], ['Tan', '#e2cfae']];
let nid = 0;
const newId = () => 'e' + Date.now().toString(36) + (nid++).toString(36);
const el = (type, text, more) => Object.assign({ id: newId(), type, text: String(text || '') }, more || {});
const shown = (e) => (UPPER[e.type] ? String(e.text).toUpperCase() : String(e.text));

// ---------- word wrap (monospace) ----------
function wrap(text, width) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    if (!para.length) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (/^\s+$/.test(word)) { if (line.length && line.length < width) line += ' '; continue; }
      let w = word;
      while (w.length > width) { if (line.trim()) { out.push(line.trimEnd()); line = ''; } out.push(w.slice(0, width)); w = w.slice(width); }
      if ((line + w).length > width) { out.push(line.trimEnd()); line = w; } else line += w;
    }
    out.push(line.trimEnd());
  }
  return out;
}
// split wrapped lines where a sentence ends (for breaking action/dialogue across pages)
function sentenceBreak(lines, maxFirst, minRest) {
  for (let k = Math.min(maxFirst, lines.length - minRest); k >= 2; k--) if (/[.!?…"”)]\s*$/.test(lines[k - 1])) return k;
  return -1;
}

// ---------- scenes ----------
const SCENE_RX = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?|INT |EXT )\s*/i;
function parseScene(text) {
  const t = String(text || '').trim().toUpperCase(), m = t.match(SCENE_RX);
  const ie = m ? m[1].replace(/\s+$/, '').replace(/\.$/, '').replace('I/E', 'INT/EXT') : '';
  let rest = m ? t.slice(m[0].length) : t;
  let time = '';
  const dm = rest.match(/\s+[-–—]+\s*([^-–—]+)$/);
  if (dm) { time = dm[1].trim(); rest = rest.slice(0, dm.index); }
  return { ie: ie.replace('.', ''), location: rest.trim(), time };
}
// scene numbers: kept numbers stay, new scenes get the number before + A, B, C…
function numberScenes(els, locked) {
  let n = 0, last = null, suffix = 0;
  for (const e of els) {
    if (e.type !== 'scene') continue;
    if (locked && e.num) { last = e.num; suffix = 0; const k = parseInt(e.num, 10); if (k > n) n = k; continue; }
    if (locked && last) { suffix++; e.num = String(parseInt(last, 10)) + String.fromCharCode(64 + Math.min(26, suffix)); }
    else { n++; e.num = String(n); last = e.num; }
  }
  return els;
}

// ---------- pagination ----------
// returns pages: [{ n, lines: [{ t: text, x, kind, id, rev, num?, cols? }] }]
function paginate(els, opts) {
  opts = opts || {};
  const L = opts.lines || PAGE_LINES, contd = opts.contd !== false, more = opts.more !== false;
  const pages = []; let page = { lines: [] }; pages.push(page);
  const room = () => L - page.lines.length;
  const newPage = () => { page = { lines: [] }; pages.push(page); };
  const push = (ln) => page.lines.push(ln);
  const blank = (k) => { if (!page.lines.length) return; for (let i = 0; i < k && page.lines.length < L; i++) push({ t: '', kind: 'blank' }); };
  // group: a character with its parentheticals and dialogue is one block
  const blocks = [];
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    if (e.type === 'character') {
      const b = { kind: 'speech', items: [e] }; let j = i + 1;
      while (j < els.length && (els[j].type === 'paren' || els[j].type === 'dialogue')) b.items.push(els[j++]);
      if (j < els.length && els[j].type === 'character' && els[j].dual) { // dual dialogue: the next speech goes on the right
        const r = [els[j++]]; while (j < els.length && (els[j].type === 'paren' || els[j].type === 'dialogue')) r.push(els[j++]);
        b.kind = 'dual'; b.right = r;
      }
      blocks.push(b); i = j - 1;
    } else blocks.push({ kind: 'single', items: [e] });
  }
  const linesOf = (e, lay) => wrap(e.type === 'paren' ? parenText(e.text) : shown(e), lay.w).map((t) => ({ t, x: lay.right ? lay.x + lay.w - t.length : e.type === 'general' && e.center ? lay.x + Math.floor((lay.w - t.length) / 2) : lay.x, kind: e.type, id: e.id, rev: e.rev || 0 }));
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi], first = b.items[0];
    if (first.type === 'pagebreak') { if (page.lines.length) newPage(); continue; }
    const lay = LAYOUT[first.type] || LAYOUT.action;
    const before = page.lines.length ? lay.before : 0;
    if (b.kind === 'single') {
      const ls = linesOf(first, lay);
      if (first.type === 'scene' && first.num != null) ls[0].num = first.num;
      // a scene heading or shot never stays alone at the bottom: it needs 2 lines of what follows
      let need = ls.length;
      if (first.type === 'scene' || first.type === 'shot') { const nx = blocks[bi + 1]; need += nx ? 1 + Math.min(2, nx.kind === 'single' ? linesOf(nx.items[0], LAYOUT[nx.items[0].type] || LAYOUT.action).length : 2) : 0; }
      if (first.type === 'transition' && room() < before + ls.length) { // a transition stays with the line before it
        const prev = page.lines.length ? page.lines.splice(-1, 1) : [];
        newPage(); prev.forEach(push); blank(lay.before); ls.forEach(push); continue;
      }
      if (room() >= before + need) { blank(before); ls.forEach(push); continue; }
      if ((first.type === 'action' || first.type === 'general') && ls.length >= 4 && room() - before >= 2) {
        const k = sentenceBreak(ls, room() - before, 2);
        if (k > 0) { blank(before); ls.slice(0, k).forEach(push); newPage(); ls.slice(k).forEach(push); continue; }
      }
      newPage(); ls.forEach(push); continue;
    }
    // speech
    const build = (items, cols) => {
      const out = []; let name = '';
      items.forEach((e, k) => {
        const lay2 = cols ? cols[e.type] : LAYOUT[e.type];
        const ls = wrap(e.type === 'paren' ? parenText(e.text) : shown(e), lay2.w).map((t) => ({ t, x: lay2.x, kind: e.type, id: e.id, rev: e.rev || 0 }));
        if (e.type === 'character') { name = shown(e).replace(/\s*\((CONT'D|CONT’D|CONTINUED)\)\s*$/i, ''); if (e.ext) ls[0].t += ` (${e.ext.toUpperCase()})`; }
        ls.forEach((l) => out.push(l));
      });
      return { lines: out, name };
    };
    if (b.kind === 'dual') {
      const L1 = build(b.items, { character: DUAL.character[0], paren: DUAL.paren[0], dialogue: DUAL.dialogue[0] });
      const R1 = build(b.right, { character: DUAL.character[1], paren: DUAL.paren[1], dialogue: DUAL.dialogue[1] });
      const h = Math.max(L1.lines.length, R1.lines.length);
      if (room() < before + h) newPage(); else blank(before);
      for (let k = 0; k < h; k++) { const a = L1.lines[k], c = R1.lines[k]; push({ t: '', kind: 'dual', cols: [a || null, c || null], id: (a || c).id, rev: Math.max(a ? a.rev : 0, c ? c.rev : 0) }); }
      continue;
    }
    const sp = build(b.items);
    const ls = sp.lines, head = ls.filter((l) => l.kind === 'character').length;
    if (room() >= before + ls.length) { blank(before); ls.forEach(push); continue; }
    // split the dialogue across pages: at least the name + 1 line of dialogue here, 2 lines on the next page
    const avail = room() - before - (more ? 1 : 0);
    let k = -1;
    if (avail >= head + 1 && ls.length - head >= 3) {
      for (let cut = Math.min(avail, ls.length - 2); cut > head; cut--) { const l = ls[cut - 1]; if (l.kind === 'dialogue' && (/[.!?…"”]\s*$/.test(l.t) || cut === head + 1) && ls[cut].kind !== 'paren') { k = cut; break; } if (l.kind === 'paren' && ls[cut].kind === 'dialogue' && cut > head + 1) { k = cut - 1; break; } }
    }
    if (k > head) {
      blank(before); ls.slice(0, k).forEach(push);
      if (more) push({ t: '(MORE)', x: LAYOUT.character.x, kind: 'more', id: ls[0].id });
      newPage();
      push({ t: sp.name + (contd ? " (CONT'D)" : ''), x: LAYOUT.character.x, kind: 'character', id: ls[0].id, rev: 0 });
      ls.slice(k).forEach(push);
    } else { newPage(); ls.forEach(push); }
  }
  // a speech that continues after action in the same scene gets (CONT'D)
  pages.forEach((p, i) => (p.n = i + 1));
  if (pages.length > 1 && !pages[pages.length - 1].lines.length) pages.pop();
  return pages;
}
function parenText(t) { t = String(t || '').trim(); if (!t) return '()'; if (!t.startsWith('(')) t = '(' + t; if (!t.endsWith(')')) t += ')'; return t; }
// automatic (CONT'D) for a character who speaks again after action in the same scene
function autoContd(els) {
  let lastSpeaker = null;
  return els.map((e) => {
    if (e.type === 'scene') { lastSpeaker = null; return e; }
    if (e.type === 'character') {
      const name = String(e.text).toUpperCase().replace(/\s*\(.*\)\s*$/, '').trim();
      const out = name && name === lastSpeaker && !/\(CONT/i.test(e.text) && !e.ext ? { ...e, ext: "CONT'D" } : e;
      lastSpeaker = name; return out;
    }
    return e;
  });
}
const pageOf = (pages, id) => { for (const p of pages) if (p.lines.some((l) => l.id === id || (l.cols && l.cols.some((c) => c && c.id === id)))) return p.n; return 0; };

// ---------- Fountain ----------
function toFountain(doc) {
  const out = [];
  const tp = doc.title || {};
  const keys = [['Title', tp.title], ['Credit', tp.credit], ['Author', tp.author], ['Source', tp.source], ['Draft date', tp.date], ['Contact', tp.contact]];
  const t = keys.filter((k) => k[1]).map(([k, v]) => `${k}: ${String(v).includes('\n') ? '\n' + String(v).split('\n').map((l) => '   ' + l).join('\n') : v}`);
  if (t.length) out.push(t.join('\n'), '');
  for (const e of doc.els) {
    const s = String(e.text || '');
    if (e.type === 'scene') out.push((SCENE_RX.test(s) ? s.toUpperCase() : '.' + s.toUpperCase()) + (e.num ? ` #${e.num}#` : ''), '');
    else if (e.type === 'action') out.push(/^[A-Z0-9 .,'!?-]+$/.test(s) && s.length < 40 && !/[a-z]/.test(s) ? '!' + s : s, '');
    else if (e.type === 'character') { const forced = /[a-z]/.test(s) || !/[A-Z]/.test(s); const nm = (forced ? s : s.toUpperCase()) + (e.ext ? ` (${e.ext})` : '') + (e.dual ? ' ^' : ''); out.push(forced ? '@' + nm : nm); }
    else if (e.type === 'paren') out.push(parenText(s));
    else if (e.type === 'dialogue') out.push(s, '');
    else if (e.type === 'transition') out.push(/TO:$/.test(s.toUpperCase()) ? s.toUpperCase() : '> ' + s.toUpperCase(), '');
    else if (e.type === 'shot') out.push(s.toUpperCase(), '');
    else if (e.type === 'general') out.push(e.center ? `> ${s} <` : s, '');
    else if (e.type === 'pagebreak') out.push('===', '');
    if (e.note) out[out.length - (out[out.length - 1] === '' ? 2 : 1)] += ` [[${e.note}]]`;
  }
  // the blank line after a dialogue block must come after the last dialogue line only
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function fromFountain(src) {
  let text = String(src || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  text = text.replace(/\/\*[\s\S]*?\*\//g, ''); // boneyard
  const doc = { title: {}, els: [] };
  // title page
  const tm = text.match(/^((?:[A-Za-z ]+:.*(?:\n(?:\s{2,}|\t).*)*\n?)+)\n/);
  if (tm && /^(Title|Credit|Author|Authors|Source|Draft date|Contact|Copyright|Notes)\s*:/im.test(tm[1].split('\n')[0])) {
    let key = null;
    for (const ln of tm[1].split('\n')) {
      const m = ln.match(/^([A-Za-z ]+):\s*(.*)$/);
      if (m && !/^\s/.test(ln)) { key = m[1].toLowerCase().replace(/s$/, '').replace('draft date', 'date'); doc.title[key] = m[2].trim(); }
      else if (key && ln.trim()) doc.title[key] = (doc.title[key] ? doc.title[key] + '\n' : '') + ln.trim();
    }
    text = text.slice(tm[0].length);
  }
  const lines = text.split('\n');
  const isBlank = (i) => i < 0 || i >= lines.length || !lines[i].trim();
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let note = ''; raw = raw.replace(/\[\[([\s\S]*?)\]\]/g, (m, n) => { note += (note ? ' ' : '') + n.trim(); return ''; });
    const t = raw.trim(); if (!t) continue;
    const add = (e) => { if (note) e.note = note; doc.els.push(e); };
    if (/^={3,}$/.test(t)) { add(el('pagebreak', '')); continue; }
    if (/^#/.test(t) || /^=(?!=)/.test(t)) continue; // sections and synopses are outline only
    if (t.startsWith('.') && !t.startsWith('..')) { const m = t.slice(1).match(/^(.*?)\s*(?:#([\w.-]+)#)?$/); add(el('scene', m[1], m[2] ? { num: m[2] } : {})); continue; }
    if (SCENE_RX.test(t) && isBlank(i - 1)) { const m = t.match(/^(.*?)\s*(?:#([\w.-]+)#)?$/); add(el('scene', m[1], m[2] ? { num: m[2] } : {})); continue; }
    if (/^>.*<$/.test(t)) { add(el('general', t.slice(1, -1).trim(), { center: true })); continue; }
    if (t.startsWith('>')) { add(el('transition', t.slice(1).trim())); continue; }
    if (/^[A-Z0-9 .'\-]+TO:$/.test(t) && isBlank(i - 1) && isBlank(i + 1)) { add(el('transition', t)); continue; }
    if (t.startsWith('!')) { add(el('action', t.slice(1))); continue; }
    // character: an upper-case line after a blank line with something right below it
    const forced = t.startsWith('@');
    const name = forced ? t.slice(1) : t;
    if ((forced || (/^[^a-z]*[A-Z][^a-z]*$/.test(name) && !/^[\d\W]+$/.test(name))) && isBlank(i - 1) && !isBlank(i + 1)) {
      const dual = /\^\s*$/.test(name);
      const nm = name.replace(/\s*\^\s*$/, '');
      add(el('character', nm.trim(), dual ? { dual: true } : {}));
      let j = i + 1;
      for (; j < lines.length && lines[j].trim(); j++) {
        const d = lines[j].trim();
        if (/^\(.*\)$/.test(d)) doc.els.push(el('paren', d));
        else { const last = doc.els[doc.els.length - 1]; if (last.type === 'dialogue') last.text += '\n' + d; else doc.els.push(el('dialogue', d)); }
      }
      i = j - 1; continue;
    }
    // action: lines until a blank line belong together
    let txt = t, j = i + 1;
    while (j < lines.length && lines[j].trim()) { txt += '\n' + lines[j].trimEnd(); j++; }
    add(el('action', txt.replace(/^\s+/, ''))); i = j - 1;
  }
  return doc;
}

// ---------- Final Draft (.fdx) ----------
const FDX_TYPES = { scene: 'Scene Heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot', general: 'General' };
const xesc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function toFDX(doc) {
  const para = (e) => {
    const type = FDX_TYPES[e.type] || 'Action';
    let attrs = ` Type="${type}"`;
    if (e.type === 'scene' && e.num) attrs += ` Number="${xesc(e.num)}"`;
    if (e.type === 'general' && e.center) attrs += ' Alignment="Center"';
    const text = e.type === 'paren' ? parenText(e.text) : e.type === 'character' && e.ext ? `${e.text} (${e.ext})` : e.text;
    const sp = e.type === 'scene' && (e.synopsis || e.color) ? `<SceneProperties${e.color ? ` Color="${xesc(e.color)}"` : ''}${e.title ? ` Title="${xesc(e.title)}"` : ''}>${e.synopsis ? `<Summary><Paragraph><Text>${xesc(e.synopsis)}</Text></Paragraph></Summary>` : ''}</SceneProperties>` : '';
    return `<Paragraph${attrs}>${sp}${String(text).split('\n').map((t, k) => `<Text>${k ? '\n' : ''}${xesc(t)}</Text>`).join('')}</Paragraph>`;
  };
  const body = [];
  for (let i = 0; i < doc.els.length; i++) {
    const e = doc.els[i];
    if (e.type === 'pagebreak') continue;
    if (e.type === 'character' && i + 1 < doc.els.length) {
      // find a dual pair: this speech + the next speech marked dual
      let j = i + 1; while (j < doc.els.length && (doc.els[j].type === 'paren' || doc.els[j].type === 'dialogue')) j++;
      if (j < doc.els.length && doc.els[j].type === 'character' && doc.els[j].dual) {
        let k = j + 1; while (k < doc.els.length && (doc.els[k].type === 'paren' || doc.els[k].type === 'dialogue')) k++;
        body.push(`<Paragraph><DualDialogue>${doc.els.slice(i, k).map((x) => para({ ...x, dual: false })).join('')}</DualDialogue></Paragraph>`);
        i = k - 1; continue;
      }
    }
    body.push(para(e));
  }
  const tp = doc.title || {}, tpp = (t, al) => `<Paragraph Type="Action"${al ? ` Alignment="${al}"` : ''}><Text>${xesc(t || '')}</Text></Paragraph>`;
  const title = [tpp(''), tpp(''), tpp(''), tpp(''), tpp(tp.title, 'Center'), tpp(''), tpp(tp.credit || 'written by', 'Center'), tpp(''), tpp(tp.author, 'Center')];
  if (tp.source) title.push(tpp(''), tpp(tp.source, 'Center'));
  if (tp.contact || tp.date) title.push(tpp(''), tpp(''), tpp(''), ...String(tp.contact || '').split('\n').map((l) => tpp(l, 'Left')), tpp(tp.date, 'Left'));
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n<Content>\n${body.join('\n')}\n</Content>\n<TitlePage><Content>${title.join('')}</Content></TitlePage>\n</FinalDraft>\n`;
}
function fromFDX(xml, parse) {
  // parse: a DOMParser-like function (text) -> Document (so this file stays DOM-free)
  const d = parse(String(xml));
  const content = d.getElementsByTagName('Content')[0];
  if (!d.getElementsByTagName('FinalDraft')[0] || !content) throw new Error('This is not a Final Draft (.fdx) file.');
  const rev = { 'Scene Heading': 'scene', Action: 'action', Character: 'character', Parenthetical: 'paren', Dialogue: 'dialogue', Transition: 'transition', Shot: 'shot', General: 'general', 'Cast List': 'action', 'New Act': 'general', 'End of Act': 'general' };
  const doc = { title: {}, els: [] };
  const textOf = (p) => Array.from(p.childNodes).filter((n) => n.nodeName === 'Text').map((n) => n.textContent).join('');
  const addPara = (p, dual) => {
    const type = rev[p.getAttribute('Type')] || 'action', text = textOf(p).replace(/\r/g, '');
    if (!text.trim() && type !== 'action') return;
    if (!text.trim()) return;
    const e = el(type, type === 'paren' ? parenText(text) : text);
    if (type === 'scene' && p.getAttribute('Number')) e.num = p.getAttribute('Number');
    if (type === 'general' && p.getAttribute('Alignment') === 'Center') e.center = true;
    if (type === 'character') { e.text = e.text.trim(); if (dual) e.dual = true; }
    const spp = Array.from(p.childNodes).find((n) => n.nodeName === 'SceneProperties');
    if (spp) { if (spp.getAttribute('Color')) e.color = spp.getAttribute('Color'); if (spp.getAttribute('Title')) e.title = spp.getAttribute('Title'); const sum = spp.getElementsByTagName('Text'); if (sum.length) e.synopsis = Array.from(sum).map((x) => x.textContent).join(' '); }
    doc.els.push(e);
  };
  for (const p of Array.from(content.childNodes).filter((n) => n.nodeName === 'Paragraph')) {
    const dd = Array.from(p.childNodes).find((n) => n.nodeName === 'DualDialogue');
    if (dd) { let chars = 0; for (const q of Array.from(dd.childNodes).filter((n) => n.nodeName === 'Paragraph')) { const isChar = q.getAttribute('Type') === 'Character'; if (isChar) chars++; addPara(q, isChar && chars === 2); } }
    else addPara(p);
  }
  const tpg = d.getElementsByTagName('TitlePage')[0];
  if (tpg) {
    const ls = Array.from(tpg.getElementsByTagName('Paragraph')).map((p) => ({ t: textOf(p).trim(), al: p.getAttribute('Alignment') || '' })).filter((x) => x.t);
    const centered = ls.filter((x) => x.al === 'Center').map((x) => x.t);
    if (centered[0]) doc.title.title = centered[0];
    if (centered[1]) doc.title.credit = centered[1];
    if (centered[2]) doc.title.author = centered[2];
    if (centered[3]) doc.title.source = centered[3];
    const left = ls.filter((x) => x.al !== 'Center').map((x) => x.t);
    if (left.length) doc.title.contact = left.join('\n');
  }
  return doc;
}

// ---------- reports ----------
function scenes(els, pages) {
  const out = [];
  els.forEach((e, i) => {
    if (e.type !== 'scene') return;
    const p = parseScene(e.text), sc = { id: e.id, num: e.num || '', heading: shown(e), ie: p.ie, location: p.location, time: p.time, page: pages ? pageOf(pages, e.id) : 0, color: e.color || '', synopsis: e.synopsis || '', chars: new Set(), words: 0, idx: i };
    for (let j = i + 1; j < els.length && els[j].type !== 'scene'; j++) { const x = els[j]; sc.words += String(x.text).split(/\s+/).filter(Boolean).length; if (x.type === 'character') sc.chars.add(charName(x.text)); }
    sc.chars = Array.from(sc.chars);
    out.push(sc);
  });
  if (pages) { // length in eighths of a page
    const lineOf = new Map(); pages.forEach((pg) => pg.lines.forEach((l, k) => { if (l.id && !lineOf.has(l.id)) lineOf.set(l.id, (pg.n - 1) * PAGE_LINES + k); }));
    const total = pages.length * PAGE_LINES;
    out.forEach((s, k) => { const a = lineOf.get(s.id) || 0, b = k + 1 < out.length ? lineOf.get(out[k + 1].id) || total : pages.reduce((n, pg) => n, (pages.length - 1) * PAGE_LINES + pages[pages.length - 1].lines.length); s.eighths = Math.max(1, Math.round((b - a) / PAGE_LINES * 8)); });
  }
  return out;
}
const eighths = (n) => { const p = Math.floor(n / 8), r = n % 8; return (p ? p + (r ? ' ' : '') : '') + (r ? r + '/8' : p ? '' : '0'); };
const charName = (t) => String(t || '').toUpperCase().replace(/\s*\(.*\)\s*$/, '').replace(/\s*\^\s*$/, '').trim();
function characters(els) {
  const m = new Map(); let cur = null, scene = 0;
  for (const e of els) {
    if (e.type === 'scene') scene++;
    if (e.type === 'character') { const n = charName(e.text); if (!n) { cur = null; continue; } cur = m.get(n) || { name: n, speeches: 0, words: 0, scenes: new Set(), first: scene }; cur.speeches++; cur.scenes.add(scene); m.set(n, cur); }
    else if (e.type === 'dialogue' && cur) cur.words += String(e.text).split(/\s+/).filter(Boolean).length;
    else if (e.type !== 'paren') cur = null;
  }
  return Array.from(m.values()).map((c) => ({ ...c, scenes: c.scenes.size })).sort((a, b) => b.words - a.words);
}
function locations(els) {
  const m = new Map();
  for (const e of els) if (e.type === 'scene') { const p = parseScene(e.text); const k = p.location || '(no location)'; const x = m.get(k) || { location: k, count: 0, ie: new Set(), times: new Set() }; x.count++; if (p.ie) x.ie.add(p.ie); if (p.time) x.times.add(p.time); m.set(k, x); }
  return Array.from(m.values()).map((x) => ({ ...x, ie: Array.from(x.ie).join(', '), times: Array.from(x.times).join(', ') })).sort((a, b) => b.count - a.count);
}
function dialogueOf(els, name) {
  const out = []; let on = false, scene = 0;
  for (const e of els) {
    if (e.type === 'scene') scene++;
    if (e.type === 'character') on = charName(e.text) === name;
    else if (on && (e.type === 'dialogue' || e.type === 'paren')) out.push({ id: e.id, type: e.type, text: e.text, scene });
    else if (e.type !== 'paren' && e.type !== 'dialogue') on = false;
  }
  return out;
}
const STOP = new Set('the a an and or but of to in on at for with is are was were be been it its this that he she they we you i his her their our your my me him them as by from not no so if then there what when where who how all up out into over just do does did have has had will would can could should one'.split(' '));
function wordFreq(els, top) {
  const m = new Map();
  for (const e of els) if (e.type === 'action' || e.type === 'dialogue') for (const w of String(e.text).toLowerCase().match(/[\p{L}']+/gu) || []) { const k = w.replace(/^'+|'+$/g, ''); if (k.length < 3 || STOP.has(k)) continue; m.set(k, (m.get(k) || 0) + 1); }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, top || 40);
}
function renameCharacter(els, from, to) {
  from = charName(from); to = String(to || '').trim(); let n = 0;
  const rx = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  const out = els.map((e) => {
    if (e.type === 'character' && charName(e.text) === from) { n++; return { ...e, text: to.toUpperCase() }; }
    if ((e.type === 'action' || e.type === 'dialogue') && rx.test(e.text)) { rx.lastIndex = 0; n++; return { ...e, text: e.text.replace(rx, (m) => (m === m.toUpperCase() ? to.toUpperCase() : to)) }; }
    return e;
  });
  return { els: out, count: n };
}
function toCSV(rows, cols) { const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; return cols.map((c) => q(c[1])).join(',') + '\r\n' + rows.map((r) => cols.map((c) => q(r[c[0]])).join(',')).join('\r\n') + '\r\n'; }

// ---------- PDF (Courier, US Letter; text must be WinAnsi – check with pdfOk) ----------
const WINANSI_EXTRA = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };
const winAnsi = (ch) => { const c = ch.charCodeAt(0); if (c < 128 || (c >= 160 && c <= 255)) return c; return WINANSI_EXTRA[ch] != null ? WINANSI_EXTRA[ch] : -1; };
function pdfOk(doc) { const all = doc.els.map((e) => e.text + (e.ext || '')).join('') + Object.values(doc.title || {}).join(''); for (const ch of all) if (ch !== '\n' && winAnsi(ch) < 0) return false; return true; }
const pdfStr = (s) => { let o = ''; for (const ch of String(s)) { const c = winAnsi(ch); const b = c < 0 ? 63 : c; o += b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : b < 32 || b > 126 ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b); } return o; };
// TrueType: read the Unicode → glyph table (cmap format 4 / 12) so any Latin, Vietnamese, Greek or Cyrillic text can go in the PDF
function parseTTF(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint16(4); let cmapOff = -1;
  for (let i = 0; i < n; i++) { const r = 12 + i * 16; if (String.fromCharCode(bytes[r], bytes[r + 1], bytes[r + 2], bytes[r + 3]) === 'cmap') cmapOff = v.getUint32(r + 8); }
  if (cmapOff < 0) throw new Error('font has no cmap');
  const map = new Map(), nt = v.getUint16(cmapOff + 2); let best = -1, fmt = 0;
  for (let i = 0; i < nt; i++) { const r = cmapOff + 4 + i * 8, pid = v.getUint16(r), eid = v.getUint16(r + 2), off = cmapOff + v.getUint32(r + 4), f = v.getUint16(off); if (pid === 3 && eid === 10 && f === 12) { best = off; fmt = 12; } else if (pid === 3 && eid === 1 && f === 4 && fmt !== 12) { best = off; fmt = 4; } }
  if (best < 0) throw new Error('font has no Unicode cmap');
  if (fmt === 4) {
    const segX2 = v.getUint16(best + 6), ends = best + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      const end = v.getUint16(ends + i * 2), start = v.getUint16(starts + i * 2), delta = v.getInt16(deltas + i * 2), ro = v.getUint16(ranges + i * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) { let g; if (!ro) g = (c + delta) & 0xffff; else { const ga = ranges + i * 2 + ro + (c - start) * 2; g = v.getUint16(ga); if (g) g = (g + delta) & 0xffff; } if (g) map.set(c, g); }
    }
  } else {
    const ng = v.getUint32(best + 12);
    for (let i = 0; i < ng; i++) { const r = best + 16 + i * 12, s0 = v.getUint32(r), e0 = v.getUint32(r + 4), g0 = v.getUint32(r + 8); for (let c = s0; c <= e0; c++) map.set(c, g0 + c - s0); }
  }
  return map;
}
// characters the font cannot draw (the app then falls back to the browser's print)
function pdfMissing(doc, cmap) { const miss = new Set(); const all = doc.els.map((e) => e.text + (e.ext || '')).join('') + Object.values(doc.title || {}).join(''); for (const ch of all) if (ch !== '\n' && !cmap.has(ch.codePointAt(0))) miss.add(ch); return Array.from(miss); }
const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
// opts: { title (title page), sceneNums, revisions (mark lines with rev >= this), watermark, footer, header, pageColors, boldScenes,
//         fonts: { regular: { cmap, flate (zlib bytes), len }, bold: {...} } – without fonts the standard Courier is used (WinAnsi text only) }
function toPDF(doc, pages, opts) {
  opts = opts || {};
  const objs = [], add = (s) => { objs.push(s); return objs.length; };
  const W = 612, H = 792, LM = 108, TOP = 72, LH = 12, CW = 7.2;
  const F = opts.fonts && opts.fonts.regular ? opts.fonts : null;
  const used = [new Map(), new Map()]; // gid -> unicode, per font
  let fontR, fontB;
  const fontH = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const gs = add('<< /Type /ExtGState /ca 0.12 /CA 0.12 >>');
  if (!F) {
    fontR = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
    fontB = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');
  } else { fontR = add(null); fontB = add(null); }
  const pageIds = [], pagesId = add(null);
  const res = `<< /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R /F3 ${fontH} 0 R >> /ExtGState << /G1 ${gs} 0 R >> >>`;
  const enc = (s, bold) => {
    if (!F) return `(${pdfStr(s)})`;
    const f = bold && F.bold ? F.bold : F.regular, u = used[bold && F.bold ? 1 : 0];
    let h = '';
    for (const ch of String(s)) { const cp = ch.codePointAt(0); const g = f.cmap.get(cp) || f.cmap.get(63) || 0; if (!u.has(g)) u.set(g, cp); h += g.toString(16).padStart(4, '0'); }
    return `<${h}>`;
  };
  const txt = (x, y, s, f) => `BT /${f || 'F1'} 12 Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${enc(s, f === 'F2')} Tj ET\n`;
  const mark = (s) => s + (opts.watermark ? `q /G1 gs 0.3 g BT /F3 60 Tf 0.7071 0.7071 -0.7071 0.7071 ${(306 - opts.watermark.length * 60 * 0.36 * 0.7071).toFixed(1)} ${(396 - opts.watermark.length * 60 * 0.36 * 0.7071).toFixed(1)} Tm (${pdfStr(opts.watermark)}) Tj ET Q\n` : '');
  const streams = [];
  const tp = opts.title;
  if (tp && (tp.title || tp.author)) {
    let s = '';
    const center = (t, line) => (s += txt((W - [...t].length * CW) / 2, H - TOP - line * LH, t));
    let ln = 18; wrap(String(tp.title || '').toUpperCase(), 60).forEach((t) => center(t, ln++));
    ln += 3; center(tp.credit || 'Written by', ln); ln += 2; String(tp.author || '').split('\n').forEach((t) => center(t, ln++));
    if (tp.source) { ln += 2; String(tp.source).split('\n').forEach((t) => center(t, ln++)); }
    const left = String(tp.contact || '').split('\n').filter(Boolean).concat(tp.date ? [tp.date] : []);
    left.forEach((t, k) => (s += txt(LM, 72 + (left.length - k) * LH, t)));
    if (opts.footer) s += `BT /F3 8 Tf ${LM} 30 Td (${pdfStr(opts.footer)}) Tj ET\n`;
    streams.push(mark(s));
  }
  for (const p of pages) {
    let s = '';
    if (opts.pageColors && p.color && p.color !== '#ffffff') { const c = p.color.match(/\w\w/g).map((h) => (parseInt(h, 16) / 255).toFixed(3)); s += `${c.join(' ')} rg 0 0 ${W} ${H} re f 0 0 0 rg\n`; }
    if (p.n > 1) s += txt(W - 72 - (String(p.n).length + 1) * CW, H - 36, p.n + '.');
    if (opts.header && p.n > 1) s += txt(LM, H - 36, opts.header);
    p.lines.forEach((l, k) => {
      const y = H - TOP - (k + 1) * LH + 2;
      const one = (c) => { if (!c || !c.t) return; s += txt(LM + c.x * CW, y, c.t, c.kind === 'scene' && opts.boldScenes ? 'F2' : 'F1'); };
      if (l.cols) l.cols.forEach(one); else one(l);
      if (l.num != null && opts.sceneNums) { s += txt(LM - 54, y, String(l.num)); s += txt(W - 72 + 6, y, String(l.num)); }
      const rv = l.cols ? Math.max(...l.cols.map((c) => (c ? c.rev || 0 : 0))) : l.rev;
      if (rv && opts.revisions && rv >= opts.revisions) s += txt(W - 40, y, '*');
    });
    if (opts.footer) s += `BT /F3 8 Tf ${LM} 30 Td (${pdfStr(opts.footer)}) Tj ET\n`;
    streams.push(mark(s));
  }
  for (const s of streams) {
    const cid = add(`<< /Length ${s.length} >>\nstream\n${s}endstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources ${res} /Contents ${cid} 0 R >>`));
  }
  if (F) {
    const embed = (f, name, u, slot) => {
      const ff = add(`<< /Length ${f.flate.length} /Length1 ${f.len} /Filter /FlateDecode >>\nstream\n${latin1(f.flate)}\nendstream`);
      const desc = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 33 /FontBBox [-25 -300 625 833] /ItalicAngle 0 /Ascent 833 /Descent -300 /CapHeight 659 /StemV 80 /FontFile2 ${ff} 0 R >>`);
      const cidf = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW 600 /CIDToGIDMap /Identity >>`);
      const ent = Array.from(u.entries()).map(([g, cp]) => { const hex = cp > 0xffff ? ((0xd800 + ((cp - 0x10000) >> 10)).toString(16) + (0xdc00 + ((cp - 0x10000) & 1023)).toString(16)) : cp.toString(16).padStart(4, '0'); return `<${g.toString(16).padStart(4, '0')}> <${hex}>`; });
      let cm = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
      for (let i = 0; i < ent.length; i += 100) cm += `${Math.min(100, ent.length - i)} beginbfchar\n${ent.slice(i, i + 100).join('\n')}\nendbfchar\n`;
      cm += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
      const tu = add(`<< /Length ${cm.length} >>\nstream\n${cm}\nendstream`);
      objs[slot - 1] = `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidf} 0 R] /ToUnicode ${tu} 0 R >>`;
    };
    embed(F.regular, 'LiberationMono', used[0], fontR);
    if (F.bold) embed(F.bold, 'LiberationMono-Bold', used[1], fontB); else objs[fontB - 1] = objs[fontR - 1];
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
  const info = add(`<< /Producer (ScriptPress) /Title ${F ? '<feff' + Array.from(String((opts.title && opts.title.title) || 'Screenplay')).map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>' : '(' + pdfStr((opts.title && opts.title.title) || 'Screenplay') + ')'} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}

// ---------- autocomplete ----------
function suggestions(els, type, prefix) {
  const p = String(prefix || '').toUpperCase();
  if (type === 'character') { const names = Array.from(new Set(els.filter((e) => e.type === 'character').map((e) => charName(e.text)).filter(Boolean))); return names.filter((n) => n.startsWith(p) && n !== p).slice(0, 8); }
  if (type === 'scene') {
    if (!SCENE_RX.test(p)) return ['INT. ', 'EXT. ', 'INT./EXT. ', 'EST. '].filter((x) => x.startsWith(p) && x.trim() !== p);
    const m = p.match(SCENE_RX), rest = p.slice(m[0].length);
    if (/\s[-–—]\s*\S*$/.test(rest)) { const tw = rest.match(/[-–—]\s*(\S*)$/)[1]; return ['DAY', 'NIGHT', 'MORNING', 'EVENING', 'LATER', 'CONTINUOUS', 'MOMENTS LATER', 'DAWN', 'DUSK'].filter((t) => t.startsWith(tw) && t !== tw).map((t) => p.replace(/[-–—]\s*\S*$/, '- ') + t); }
    const locs = Array.from(new Set(els.filter((e) => e.type === 'scene').map((e) => parseScene(e.text).location).filter(Boolean)));
    return locs.filter((l) => l.startsWith(rest) && l !== rest).slice(0, 8).map((l) => m[0].trim() + ' ' + l);
  }
  if (type === 'transition') return ['CUT TO:', 'FADE OUT.', 'FADE TO BLACK.', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'FADE IN:'].filter((t) => t.startsWith(p) && t !== p);
  return [];
}
// a line typed in Action that is clearly something else
function guessType(text, prevType) {
  const t = String(text || '').trim();
  if (SCENE_RX.test(t)) return 'scene';
  if (/^(FADE IN:|FADE OUT\.|CUT TO:|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:|FADE TO BLACK\.)$/i.test(t)) return /^FADE IN:/i.test(t) ? 'general' : 'transition';
  return null;
}
const stats = (els, pages) => ({ pages: pages ? pages.length : 0, scenes: els.filter((e) => e.type === 'scene').length, words: els.reduce((n, e) => n + String(e.text).split(/\s+/).filter(Boolean).length, 0), characters: new Set(els.filter((e) => e.type === 'character').map((e) => charName(e.text))).size });

return { TYPES, TYPE_NAMES, NEXT, TAB, UPPER, LAYOUT, PAGE_LINES, REV_COLORS, el, newId, shown, wrap, parseScene, numberScenes, paginate, autoContd, parenText, pageOf, toFountain, fromFountain, toFDX, fromFDX, scenes, eighths, characters, locations, dialogueOf, wordFreq, renameCharacter, toCSV, pdfOk, toPDF, parseTTF, pdfMissing, suggestions, guessType, charName, stats, SCENE_RX };
})();
if (typeof module !== 'undefined') module.exports = SC;
