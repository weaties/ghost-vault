/*
 * koenig-helpers.js — guarded helpers for proofreading a Ghost draft through
 * browser automation (Claude in Chrome). Ghost Starter has no Admin API, so the
 * Koenig (Lexical) editor in the browser is the only write path.
 *
 * Inject this whole file ONCE per page load with the javascript tool; it
 * installs `window.ge`. It must be re-injected after every reload/navigation.
 *
 * Design rule: every helper THROWS on anything unexpected, so a batched action
 * sequence halts instead of typing into the wrong place. The helpers never
 * change the document themselves. All text changes are made by real key events
 * from the automation tool, between a verified "before" and a checked "after".
 *
 * See runbooks/ghost-editor.md for the procedure and the reasons behind it.
 */
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const squash = (s) => s.replace(/\s+/g, ' ').trim();

  // Ghost keeps a zero-size duplicate of the editor in the DOM (word count).
  // Only ever look at editors that are actually laid out.
  const roots = () =>
    [...document.querySelectorAll('[data-lexical-editor]')].filter(
      (r) => r.getClientRects().length && r.getBoundingClientRect().width > 0
    );

  // The post body: the visible drag-and-drop container with the most text.
  const mainRoot = () => {
    const m = roots()
      .filter((r) => r.hasAttribute('data-koenig-dnd-container'))
      .sort((a, b) => b.innerText.length - a.innerText.length)[0];
    if (!m) throw new Error('ge: post body editor not found (page still loading?)');
    return m;
  };

  // Every occurrence of `text` inside a single text node, tagged with the
  // editor that directly owns it. Captions and callouts are nested editors.
  const hits = (text) => {
    const out = [];
    for (const r of roots()) {
      const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (n.parentElement.closest('[data-lexical-editor]') !== r) continue;
        let from = 0, i;
        while ((i = n.data.indexOf(text, from)) > -1) {
          out.push({ n, i, r });
          from = i + 1;
        }
      }
    }
    return out;
  };

  const one = (text) => {
    const h = hits(text);
    if (h.length !== 1) throw new Error(`ge: expected 1 match, got ${h.length} for ${JSON.stringify(text)}`);
    return h[0];
  };

  const blockOf = (h) => {
    const m = mainRoot();
    let b = h.n.parentElement;
    while (b && b.parentElement !== m) b = b.parentElement;
    if (!b) throw new Error('ge: match is not inside the post body');
    return b;
  };

  const scrollParent = (el) => {
    let sp = el.parentElement;
    while (sp && !(sp.scrollHeight > sp.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(sp).overflowY)))
      sp = sp.parentElement;
    return sp || document.scrollingElement;
  };

  const cardType = (block) => block.querySelector('[data-kg-card]')?.dataset.kgCard || null;

  // Set a DOM range, then prove Lexical adopted it. Lexical ignores scripted
  // selections in several states (card node-selected, editor never clicked).
  const setRange = async (root, sn, so, en, eo) => {
    root.focus({ preventScroll: true });
    const rg = document.createRange();
    rg.setStart(sn, so);
    rg.setEnd(en, eo);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(rg);
    document.dispatchEvent(new Event('selectionchange'));
    await sleep(300);
    const ed = root.__lexicalEditor;
    if (!ed) throw new Error('ge: no Lexical editor on root');
    const ls = ed.getEditorState()._selection;
    if (!ls || !ls.anchor) throw new Error('ge: editor has no range selection (a card is selected? click into the text first)');
    const pts = [ls.anchor, ls.focus].map((p) => ({ el: ed.getElementByKey(p.key), off: p.offset, type: p.type }));
    const ok = (p, n, o) => p.el && (p.el === n.parentElement || p.el.contains(n)) && (p.type !== 'text' || p.off === o);
    const fwd = ok(pts[0], sn, so) && ok(pts[1], en, eo);
    const bwd = ok(pts[1], sn, so) && ok(pts[0], en, eo);
    if (!fwd && !bwd) throw new Error('ge: editor selection does not match the requested range (click into the block first)');
    return 'VERIFIED';
  };

  const ge = {
    version: '0.1.0',

    /** Post title, save status, and one line per top-level block. Stored on
     *  ge._dump because tool output is truncated at roughly 1000 characters;
     *  page through it with ge.page(). */
    dump() {
      const k = [...mainRoot().children];
      const lines = k.map((c, i) => {
        const card = cardType(c);
        const t = squash(c.innerText).replace(/(Emoji Background|Alt)$/, '').trim();
        return `${i} ${c.tagName}${card ? '[' + card + ']' : ''}: ${t}`;
      });
      ge._dump = lines.join('\n');
      return JSON.stringify({
        title: document.querySelector('textarea')?.value,
        status: document.querySelector('[data-test-editor-post-status]')?.innerText,
        blocks: k.length,
        chars: ge._dump.length,
        pages: Math.ceil(ge._dump.length / 900),
      });
    },

    /** Page n (0-based) of the last dump, 900 characters each. */
    page(n) {
      if (!ge._dump) ge.dump();
      return ge._dump.slice(n * 900, (n + 1) * 900);
    },

    /** Full text of block i from the last dump, optionally sliced. */
    block(i, from = 0, to = 900) {
      if (!ge._dump) ge.dump();
      return (ge._dump.split('\n')[i] || '').slice(from, to);
    },

    /** Scroll a unique piece of text into view and return where to click it.
     *  `frameW` is the screenshot coordinate-frame width reported by the
     *  automation tool; it is usually a little narrower than innerWidth.
     *  A real click is REQUIRED before select(): typed text is silently dropped
     *  if the editor has not had a genuine mouse click this page load.
     *  Captions and callouts need `clicks: 2` (select the card, then enter it). */
    locate(text, frameW) {
      const h = one(text);
      const b = blockOf(h);
      b.scrollIntoView({ block: 'center' });
      const rg = document.createRange();
      rg.setStart(h.n, h.i);
      rg.setEnd(h.n, h.i + text.length);
      let r = rg.getClientRects()[0];
      scrollParent(b).scrollBy(0, r.top - 300);
      r = rg.getClientRects()[0];
      const k = (frameW || innerWidth) / innerWidth;
      const nested = h.r !== mainRoot();
      return JSON.stringify({
        x: Math.round((r.left + Math.min(r.width / 2, 40)) * k),
        y: Math.round((r.top + r.height / 2) * k),
        clicks: nested ? 2 : 1,
        where: nested ? cardType(b) + ' (nested editor)' : b.tagName,
      });
    },

    /** Select exactly `needle`, found via the unique surrounding `ctx`
     *  (defaults to needle). `atEnd` additionally requires the needle to end
     *  its text node, for appending punctuation. Then TYPE the replacement. */
    async select(needle, ctx, atEnd) {
      const full = ctx || needle;
      const h = one(full);
      const off = full.indexOf(needle);
      if (off < 0) throw new Error('ge: needle is not inside ctx');
      const st = h.i + off;
      if (atEnd && st + needle.length !== h.n.data.trimEnd().length)
        throw new Error('ge: needle is not at the end of its text: ' + JSON.stringify(h.n.data.slice(st)));
      const v = await setRange(h.r, h.n, st, h.n, st + needle.length);
      return `${v} ${JSON.stringify(h.n.data.slice(Math.max(0, st - 20), st + needle.length + 20))}`;
    },

    /** After typing: the new text must exist and the old text must be gone. */
    async changed(want, gone) {
      await sleep(300);
      const a = hits(want).length;
      const b = gone ? hits(gone).length : 0;
      if (a < 1 || b !== 0) throw new Error(`ge: edit did not apply (want=${a}, leftover=${b})`);
      return 'CHANGED OK';
    },

    /** Verified caret at the end of the post-body paragraph or heading that
     *  contains `ctx`. Next: press Return, type "/callout", wait 1s, menuOK(). */
    async caretAfter(ctx) {
      const m = mainRoot();
      const h = hits(ctx).filter((x) => x.r === m);
      if (h.length !== 1) throw new Error(`ge: expected 1 body match, got ${h.length} for ${JSON.stringify(ctx)} (captions cannot anchor a callout)`);
      const b = blockOf(h[0]);
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      let n, last;
      while ((n = w.nextNode())) last = n;
      const v = await setRange(m, last, last.data.length, last, last.data.length);
      return `${v} end of ${b.tagName} ${JSON.stringify(last.data.slice(-30))}`;
    },

    /** For a comment at the very end: after clicking the trailing empty
     *  paragraph, confirm the caret is really in it. Then type "/callout". */
    async caretInLastEmptyParagraph() {
      await sleep(300);
      const m = mainRoot();
      const ls = m.__lexicalEditor.getEditorState()._selection;
      if (!ls || !ls.anchor) throw new Error('ge: no range selection');
      const el = m.__lexicalEditor.getElementByKey(ls.anchor.key);
      if (el !== m.lastElementChild || el.tagName !== 'P' || el.innerText.trim() !== '')
        throw new Error('ge: caret is not in the trailing empty paragraph');
      return 'CARET IN LAST EMPTY P';
    },

    /** Where to click the trailing empty paragraph. */
    locateLastEmptyParagraph(frameW) {
      const b = mainRoot().lastElementChild;
      if (b.tagName !== 'P' || b.innerText.trim() !== '') throw new Error('ge: last block is not an empty paragraph');
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      const k = (frameW || innerWidth) / innerWidth;
      return JSON.stringify({ x: Math.round((r.left + 150) * k), y: Math.round((r.top + r.height / 2) * k), clicks: 1 });
    },

    /** The slash menu must have filtered down to Callout, selected, before
     *  Return. Pressing Return too early inserts an Image card instead. */
    menuOK() {
      const b = [...document.querySelectorAll('[data-kg-card-menu-item]')].filter((e) => e.getClientRects().length);
      if (b.length !== 1 || b[0].dataset.kgCardMenuItem !== 'Callout' || b[0].dataset.kgCardmenuSelected !== 'true')
        throw new Error('ge: slash menu not ready: ' + b.map((x) => x.dataset.kgCardMenuItem).join(','));
      return 'MENU OK';
    },

    /** After Return on the menu: focus must be inside a new, empty callout. */
    async inCallout() {
      await sleep(400);
      const a = document.activeElement;
      const c = a && a.closest('[data-kg-card]');
      if (!c || c.dataset.kgCard !== 'callout') throw new Error('ge: focus is not in a callout: ' + (c ? c.dataset.kgCard : a && a.className));
      if (a.innerText.trim() !== '') throw new Error('ge: callout is not empty');
      return 'IN EMPTY CALLOUT';
    },

    /** A few blocks starting at the one containing `ctx`, for eyeballing. */
    near(ctx, n = 3) {
      const k = [...mainRoot().children];
      const i = k.findIndex((c) => c.innerText.includes(ctx));
      if (i < 0) throw new Error('ge: no block contains ' + JSON.stringify(ctx));
      return k.slice(i, i + n)
        .map((c) => `${c.tagName}${cardType(c) ? '[' + cardType(c) + ']' : ''}: ${JSON.stringify(squash(c.innerText).slice(0, 40))}…${JSON.stringify(squash(c.innerText).slice(-30))}`)
        .join('\n');
    },

    /** Run after cmd+s AND a reload (then re-inject). "Draft - Saved" alone is
     *  not proof: check that every `gone` string is absent and every `have`
     *  string is present in what Ghost actually stored. Also reports what a
     *  pre-publish check cares about. */
    audit({ gone = [], have = [], marker = 'CLAUDE:' } = {}) {
      const m = mainRoot();
      const k = [...m.children];
      const T = m.innerText;
      const t = (c) => squash(c.innerText);
      const comments = k
        .map((c, i) => [c, i])
        .filter(([c]) => t(c).includes(marker))
        .map(([c, i]) => ({
          under: t(k[i - 1] || m).slice(0, 40),
          isCallout: cardType(c) === 'callout',
          text: t(c).slice(0, 60),
        }));
      return JSON.stringify({
        status: document.querySelector('[data-test-editor-post-status]')?.innerText,
        blocks: k.length,
        comments: comments.length,
        misplacedComments: comments.filter((c) => !c.isCallout),
        commentsUnder: comments.map((c) => c.under),
        stillPresent: gone.filter((s) => T.includes(s)),
        missing: have.filter((s) => !T.includes(s)),
        strayslash: k.filter((c) => /^\/[a-z]+/.test(t(c))).map(t),
        emptyImageCards: k.filter((c) => cardType(c) === 'image' && !c.querySelector('img')).length,
        emptyParagraphs: k.map((c, i) => [c, i]).filter(([c, i]) => c.tagName === 'P' && t(c) === '' && i > 0 && i < k.length - 1).map(([, i]) => i),
        imagesWithoutCaption: k.filter((c) => cardType(c) === 'image' && c.querySelector('img') && !t(c).replace(/Alt$/, '').replace(/Type caption for image \(optional\)/, '').trim()).length,
      });
    },
  };

  window.ge = ge;
  return 'ge ' + ge.version + ' installed';
})();
