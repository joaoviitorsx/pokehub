// Desenha retângulos no lugar das WebContentsViews do Electron, com a mesma geometria de arrange() em spike/electron/main.ts.
import { effectiveFocus, layout, sideWidth, TOP_BAR } from '../electron/layout';
import { emit, layoutState, mockProfiles, onLayoutChange } from './mock-pokehub';

const layer = document.createElement('div');
layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50';
let lastAuto: string | null = null;
function arrange() {
  layer.replaceChildren();
  const profiles = mockProfiles();
  if (!profiles.length) return;
  const width = window.innerWidth, height = Math.max(window.innerHeight, TOP_BAR);
  const {id, hide, side: sideOpen, panel, account} = layoutState;
  const index = id === null ? -1 : profiles.findIndex(p => p.id === id);
  const side = sideWidth(width, sideOpen, panel);
  const preferred = sideOpen && account ? profiles.findIndex(p => p.id === account) : -1;
  const eff = effectiveFocus(width, height, profiles.length, index >= 0 ? index : null, side, Math.max(preferred, 0));
  const auto = eff.automatic ? profiles[eff.index ?? 0]?.id ?? null : null;
  if (auto !== lastAuto) { lastAuto = auto; emit('auto-focus', auto); }
  if (hide) return; // editor aberto: as views somem
  layout(width, height, profiles.length, eff.index, side).forEach((b, i) => {
    if (!b) return;
    const el = document.createElement('div');
    el.textContent = `Jogo — ${profiles[i]!.label}`;
    el.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;box-sizing:border-box;display:grid;place-items:center;font:600 14px system-ui;color:#9aa3b5;border:1px solid #2a3040;background:repeating-conic-gradient(#171b25 0 25%,#1b2030 0 50%) 0 0/24px 24px`;
    layer.append(el);
  });
}
onLayoutChange(arrange);
window.addEventListener('resize', arrange);
document.body.append(layer);
arrange();
