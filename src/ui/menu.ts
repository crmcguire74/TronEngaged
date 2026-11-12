import type { Actions } from '../input/input';

export type Item =
  | { kind: 'button'; label: string; sub?: string; tag?: string; action: () => void; disabled?: boolean; primary?: boolean;
      /** Home screen: a large game card with campaign progress. */ card?: { done: number; total: number; next: string; glyph: 'disc' | 'cycle' };
      /** Home screen: a quiet secondary link. */ link?: boolean }
  | { kind: 'toggle'; label: string; sub?: string; get: () => boolean; set: (v: boolean) => void }
  | { kind: 'slider'; label: string; get: () => number; set: (v: number) => void; min: number; max: number; step: number; fmt?: (v: number) => string }
  | { kind: 'choice'; label: string; get: () => string; set: (v: string) => void; options: [string, string][] }
  | { kind: 'bind'; label: string; get: () => string; listen: (done: () => void) => void }
  | { kind: 'tile'; no: string; label: string; tag?: string; icon?: string; state: 'open' | 'done' | 'locked'; boss?: boolean; action: () => void }
  | { kind: 'row'; label: string; value: string; total?: boolean }
  | { kind: 'title'; label: string };
export interface Screen {
  id: string; kicker: string; title: string; text?: string; items: Item[]; tiles?: Item[];
  side?: { title: string; text?: string; rows: [string, string][] }; foot?: string; wide?: boolean; dim?: boolean;
  head?: { cls: string; text: string }; unlocks?: string[]; back?: () => void; noBack?: boolean;
  /** 'home' = two game cards over a row of links, instead of the standard list. */ layout?: 'home';
}
const selectable = (i: Item) => i.kind !== 'row' && i.kind !== 'title' && !(i.kind === 'button' && i.disabled) && !(i.kind === 'tile' && i.state === 'locked');

/** Device-independent menu state. The DOM renderer and the in-VR panel renderer both draw from this model. */
export class Menu {
  stack: Screen[] = []; focus = 0; listening = false; onChange: () => void = () => {}; onSound: (name: string) => void = () => {};
  /** Rebuilds a screen from live data when it is revisited or a value changes. */
  private builders = new Map<Screen, () => Screen>();
  get screen(): Screen | null { return this.stack[this.stack.length - 1] ?? null; }
  get all(): Item[] { const s = this.screen; return s ? [...s.items, ...(s.tiles ?? [])] : []; }

  open(build: () => Screen, replace = false) { const s = build(); this.builders.set(s, build); if (replace) this.stack.pop(); this.stack.push(s); this.focus = this.first(); this.onChange(); }
  reset(build: () => Screen) { this.stack = []; this.open(build); }
  close() { this.stack = []; this.onChange(); }
  back() { const s = this.screen; if (!s || s.noBack) return; this.onSound('uiBack'); if (s.back) { s.back(); return; } if (this.stack.length > 1) { this.stack.pop(); this.rebuild(); this.focus = this.first(); this.onChange(); } }
  rebuild() { const s = this.screen; if (!s) return; const b = this.builders.get(s); if (b) { const n = b(); this.builders.delete(s); this.builders.set(n, b); this.stack[this.stack.length - 1] = n; } }
  refresh() { const f = this.focus; this.rebuild(); this.focus = Math.min(f, this.all.length - 1); this.onChange(); }
  private first() { const i = this.all.findIndex(selectable); return Math.max(0, i); }
  setFocus(i: number) { if (i !== this.focus && this.all[i] && selectable(this.all[i])) { this.focus = i; this.onSound('uiMove'); this.onChange(); } }

  move(d: number) { const all = this.all; let i = this.focus; for (let n = 0; n < all.length; n++) { i = (i + d + all.length) % all.length; if (selectable(all[i])) break; } if (i !== this.focus) { this.focus = i; this.onSound('uiMove'); this.onChange(); } }
  /** dir: 0 = confirm, ±1 = adjust. */
  activate(i = this.focus, dir = 0) {
    const it = this.all[i]; if (!it || !selectable(it)) return; this.focus = i;
    if (it.kind === 'button' || it.kind === 'tile') { this.onSound('uiSelect'); it.action(); return; }
    if (it.kind === 'toggle') it.set(!it.get());
    else if (it.kind === 'slider') { const d = dir || 1; let v = it.get() + d * it.step; if (dir === 0 && v > it.max + 1e-6) v = it.min; it.set(Math.round(Math.min(it.max, Math.max(it.min, v)) / it.step) * it.step); }
    else if (it.kind === 'choice') { const k = it.options.findIndex((o) => o[0] === it.get()); it.set(it.options[(k + (dir || 1) + it.options.length) % it.options.length][0]); }
    else if (it.kind === 'bind') { this.listening = true; this.onChange(); it.listen(() => { this.listening = false; this.refresh(); }); return; }
    this.onSound('uiMove'); this.refresh();
  }
  handle(a: Actions) {
    if (!this.screen || this.listening) return;
    const it = this.all[this.focus], grid = it?.kind === 'tile';
    if (this.screen.layout === 'home') {
      // cards sit side by side above the links: left/right walks the row, up/down switches row
      const cards = this.all.filter((x) => x.kind === 'button' && x.card).length;
      if (a.navX) this.move(a.navX); if (a.navY > 0 && this.focus < cards) this.setFocus(cards); else if (a.navY < 0 && this.focus >= cards) this.setFocus(0);
      if (a.confirm) this.activate(); return;
    }
    if (a.navY) { if (grid) this.moveGrid(a.navY * this.cols()); else this.move(a.navY); }
    if (a.navX) { if (grid) this.moveGrid(a.navX); else if (it && (it.kind === 'slider' || it.kind === 'choice' || it.kind === 'toggle')) this.activate(this.focus, a.navX); }
    if (a.confirm) this.activate(); else if (a.back) this.back();
  }
  gridCols = 6; private cols() { return this.gridCols; }
  private moveGrid(d: number) { const all = this.all, n = this.screen!.items.length; let i = this.focus + d; if (i < n) { for (let k = n - 1; k >= 0; k--) if (selectable(all[k])) { i = k; break; } } i = Math.min(all.length - 1, Math.max(0, i)); if (selectable(all[i]) && i !== this.focus) { this.focus = i; this.onSound('uiMove'); this.onChange(); } }
}

const GLYPH = {
  disc: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"/><circle cx="24" cy="24" r="12.5"/><circle cx="24" cy="24" r="3.2" class="fill"/></svg>',
  cycle: '<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><circle cx="10" cy="31" r="7"/><circle cx="38" cy="31" r="7"/><path d="M10 31 L19 17 H33 L38 31 M19 17 L27 31 H10"/></svg>',
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export function itemValue(it: Item): string {
  if (it.kind === 'toggle') return it.get() ? 'ON' : 'OFF';
  if (it.kind === 'slider') return it.fmt ? it.fmt(it.get()) : String(Math.round(it.get() * 100) / 100);
  if (it.kind === 'choice') return it.options.find((o) => o[0] === it.get())?.[1] ?? it.get();
  if (it.kind === 'bind') return it.get();
  return '';
}

/** DOM renderer for the desktop command-centre menus. */
export class MenuDom {
  /** Supplied logo image; when set it replaces the lettered wordmark. */ logoUrl: string | null = null;
  private logo() { return this.logoUrl ? `<div class="logo"><img src="${this.logoUrl}" alt="VANTA ARC"></div>` : '<div class="logo">VANTA<span>ARC</span><small>LATTICE PROTOCOL</small></div>'; }
  readonly root = document.createElement('div'); topRight: () => string = () => ''; onTop: (id: string) => void = () => {};
  constructor(private menu: Menu, parent: HTMLElement) { this.root.className = 'menu'; this.root.style.display = 'none'; parent.appendChild(this.root); menu.onChange = () => this.render(); }
  render() {
    const m = this.menu, s = m.screen, r = this.root; if (!s) { r.style.display = 'none'; r.innerHTML = ''; return; }
    r.style.display = ''; r.className = 'menu' + (s.wide ? ' wide' : '') + (s.dim ? ' dim' : '');
    const scroll = r.querySelector('.m-items')?.scrollTop ?? 0, sameScreen = r.dataset.id === s.id; r.dataset.id = s.id;
    let idx = 0, n = 0;
    const one = (it: Item) => {
      const i = idx++, f = i === m.focus ? ' focus' : '';
      if (it.kind === 'title') return `<div class="m-title">${esc(it.label)}</div>`;
      if (it.kind === 'row') return `<div class="m-row${it.total ? ' total' : ''}"><span>${esc(it.label)}</span><b>${esc(it.value)}</b></div>`;
      if (it.kind === 'tile') return `<button class="tile ${it.state}${it.boss ? ' boss' : ''}${f}" data-i="${i}"><b>${esc(it.no)}</b><span>${esc(it.label)}</span><em>${esc(it.tag ?? '')}</em><i>${esc(it.icon ?? '')}</i></button>`;
      n++; const no = String(n).padStart(2, '0');
      if (it.kind === 'button') return `<button class="m-item${it.primary ? ' primary' : ''}${it.disabled ? ' disabled' : ''}${f}" data-i="${i}"><i class="idx">${no}</i><span class="lbl">${esc(it.label)}${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</span><span class="tag">${esc(it.tag ?? '')}</span></button>`;
      const v = it.kind === 'bind' && m.listening && i === m.focus ? 'PRESS A KEY…' : itemValue(it);
      const track = it.kind === 'slider' ? `<span class="track"><i style="width:${(((it.get() - it.min) / (it.max - it.min)) * 100).toFixed(0)}%"></i></span>` : '';
      const arrows = it.kind === 'bind' ? `<b>${esc(v)}</b>` : `<button data-i="${i}" data-d="-1" aria-label="decrease">‹</button>${track}<b>${esc(v)}</b><button data-i="${i}" data-d="1" aria-label="increase">›</button>`;
      return `<div class="m-item ctl${f}" data-i="${i}" role="group"><i class="idx">${no}</i><span class="lbl">${esc(it.label)}${'sub' in it && it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</span><span class="val">${arrows}</span></div>`;
    };
    const items = s.items.map(one).join(''), tiles = s.tiles ? `<div class="m-items grid">${s.tiles.map(one).join('')}</div>` : '';
    const side = s.side ? `<aside class="m-side"><h3>${esc(s.side.title)}</h3>${s.side.text ? `<p>${esc(s.side.text)}</p>` : ''}${s.side.rows.map((x) => `<div class="m-row"><span>${esc(x[0])}</span><b>${esc(x[1])}</b></div>`).join('')}</aside>` : '';
    if (s.layout === 'home') {
      // each element carries its item's real position in the screen, whatever order the layout draws them in
      const card = (it: Item) => { const i = s.items.indexOf(it); if (it.kind !== 'button' || !it.card) return ''; const c = it.card; return `<button class="card${i === m.focus ? ' focus' : ''}" data-i="${i}">${GLYPH[c.glyph]}<span class="card-count">${c.done} / ${c.total}</span><h2>${esc(it.label)}</h2><span class="card-sub">${esc(it.sub ?? '')}</span><span class="card-meter"><i style="width:${Math.max(1.5, (c.done / c.total) * 100).toFixed(1)}%"></i></span><span class="card-next"><span>Next</span><b>${esc(c.next)}</b><em>Play</em></span></button>`; };
      const link = (it: Item) => { const i = s.items.indexOf(it); return it.kind === 'button' ? `<button class="link${i === m.focus ? ' focus' : ''}" data-i="${i}">${esc(it.label)}</button>` : ''; };
      const cards = s.items.filter((x) => x.kind === 'button' && x.card), links = s.items.filter((x) => !(x.kind === 'button' && x.card));
      r.className = 'menu home';
      r.innerHTML = `<header class="m-brand">${this.logo()}<div class="m-top">${this.topRight()}</div></header>
        <section class="home-body"><div class="home-cards">${cards.map(card).join('')}</div><nav class="home-links">${links.map(link).join('')}</nav></section>
        <footer class="m-foot">${s.foot ?? ''}</footer>`;
      this.bind(); return;
    }
    r.innerHTML = `<header class="m-brand">${this.logo()}<div class="m-top">${this.topRight()}</div></header>
      <section class="m-panel"><div class="m-head"><span class="m-kicker">${esc(s.kicker)}</span>${s.head ? `<div class="result-head ${s.head.cls}">${esc(s.head.text)}</div>` : ''}<h1>${esc(s.title)}</h1>${s.text ? `<p>${esc(s.text)}</p>` : ''}${(s.unlocks ?? []).map((u) => `<span class="unlock">◈ ${esc(u)}</span>`).join('')}</div>
      <div class="m-items">${items}${tiles}</div></section>${side}
      <footer class="m-foot">${s.foot ?? '<span><kbd>↑↓</kbd> Navigate</span><span><kbd>←→</kbd> Adjust</span><span><kbd>Enter</kbd> Select</span>' + (s.noBack || m.stack.length < 2 && !s.back ? '' : '<span><kbd>Esc</kbd> Back</span>')}</footer>`;
    const list = r.querySelector<HTMLElement>('.m-items'); if (list && sameScreen) list.scrollTop = scroll;
    const grid = r.querySelector<HTMLElement>('.m-items.grid'); if (grid) m.gridCols = Math.max(1, Math.round(grid.clientWidth / 126));
    r.querySelector<HTMLElement>('.focus')?.scrollIntoView({ block: 'nearest' });
    this.bind();
  }
  private bind() {
    const m = this.menu, r = this.root;
    r.querySelectorAll<HTMLElement>('[data-i]').forEach((e) => {
      const i = Number(e.dataset.i);
      if (e.dataset.d) e.addEventListener('click', (ev) => { ev.stopPropagation(); m.activate(i, Number(e.dataset.d)); });
      else { e.addEventListener('mouseenter', () => { if (m.focus !== i && !m.listening) { m.focus = i; r.querySelectorAll('.focus').forEach((x) => x.classList.remove('focus')); e.classList.add('focus'); } }); e.addEventListener('click', () => m.activate(i)); }
    });
    r.querySelectorAll<HTMLElement>('[data-top]').forEach((e) => e.addEventListener('click', () => this.onTop(e.dataset.top!)));
  }
}
