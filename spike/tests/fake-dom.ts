// DOM mínimo para executar os scripts da página (Loja) em testes: só o que eles usam. Seletores: tag, #id, .classe (compostos), vírgula e descendente.
type Attrs = Record<string, string>;
export class FakeEl {
  parentElement: FakeEl | null = null;
  children: FakeEl[] = [];
  className = '';
  id = '';
  disabled = false;
  visible = true;
  clicks = 0;
  onclick: (() => void) | undefined;
  attrs: Attrs = {};
  constructor(public tag: string, public text = '') {}
  get tagName() { return this.tag.toUpperCase(); }
  get classList() {
    const self = this, list = () => self.className.split(/\s+/).filter(Boolean);
    return { contains: (c: string) => list().includes(c), add: (c: string) => { if (!list().includes(c)) self.className = [...list(), c].join(' '); }, remove: (c: string) => { self.className = list().filter(x => x !== c).join(' '); } };
  }
  get textContent(): string { return this.text + this.children.map(c => c.textContent).join(' '); }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  getClientRects() { return this.visible ? [{}] : []; }
  dispatchEvent() { return true; }
  click() { this.clicks++; this.onclick?.(); }
  append(...kids: FakeEl[]) { for (const k of kids) { k.parentElement = this; this.children.push(k); } return this; }
  all(): FakeEl[] { return this.children.flatMap(c => [c, ...c.all()]); }
  root(): FakeEl { return this.parentElement ? this.parentElement.root() : this; }
  contains(other: FakeEl): boolean { return other === this || this.all().includes(other); }
  compareDocumentPosition(other: FakeEl) { const order = this.root().all(), a = order.indexOf(this), b = order.indexOf(other); return b < a ? 2 : b > a ? 4 : 0; }
  private is(simple: string): boolean {
    const tokens = simple.match(/[#.]?[\w-]+/g) ?? [];
    return tokens.length > 0 && tokens.join('') === simple && tokens.every(t => t[0] === '#' ? t.slice(1) === this.id : t[0] === '.' ? this.classList.contains(t.slice(1)) : t.toLowerCase() === this.tag);
  }
  private matches(selector: string): boolean {
    return selector.split(',').some(group => {
      const parts = group.trim().split(/\s+/);
      let node: FakeEl | null = this;
      if (!node.is(parts[parts.length - 1]!)) return false;
      for (let i = parts.length - 2; i >= 0; i--) { node = node.parentElement; while (node && !node.is(parts[i]!)) node = node.parentElement; if (!node) return false; }
      return true;
    });
  }
  querySelectorAll(selector: string): FakeEl[] { return selector === '*' ? this.all() : this.all().filter(e => e.matches(selector)); }
  querySelector(selector: string): FakeEl | null { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): FakeEl | null { for (let n: FakeEl | null = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
}
export class FakeInput extends FakeEl {
  declare value: string;
  constructor() { super('input'); }
}
Object.defineProperty(FakeInput.prototype, 'value', { get(this: { _v?: string }) { return this._v ?? ''; }, set(this: { _v?: string }, v: string) { this._v = v; }, configurable: true });
export function el(tag: string, cls = '', text = '', attrs: Attrs = {}, kids: FakeEl[] = []): FakeEl {
  const e = tag === 'input' ? new FakeInput() : new FakeEl(tag, text);
  e.className = cls; e.attrs = attrs; e.append(...kids);
  return e;
}
/** `document` com um corpo; `.querySelector` procura no corpo todo. */
export function fakeDocument(body: FakeEl) {
  return { querySelector: (s: string) => body.querySelector(s), querySelectorAll: (s: string) => body.querySelectorAll(s), dispatchEvent: () => true };
}
