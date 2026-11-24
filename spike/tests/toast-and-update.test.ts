import { describe, expect, it } from 'vitest';
import { toastHtml } from '../electron/alert-toast';
import { INITIAL_UPDATE, reduceUpdate } from '../electron/update-status';

describe('aviso do RMT (janela por cima do jogo)', () => {
  const item = {conta:'Principal', cor:'#e5484d', nome:'Venusaur', detalhe:'Nv 61 · P4', preco:'13.000 Coins', moeda:'gold' as const, shiny:false};
  it('escapa todo texto e bloqueia scripts (CSP sem script)', () => {
    const html = toastHtml([{...item, nome:'<img src=x onerror=alert(1)>', conta:'"><script>x()</script>'}], 0);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x()');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain("default-src 'none'");
  });
  it('cor da conta só em hex; "+N outros" quando passa de 3', () => {
    expect(toastHtml([{...item, cor:'red;background:url(x)'}], 0)).toContain('--c:#ba5ad1');
    expect(toastHtml([item], 2)).toContain('+2 outros anúncios');
    expect(toastHtml([{...item, shiny:true, moeda:'orb'}], 0)).toMatch(/class="row sh"[\s\S]*preco orb/);
  });
  it('links só para ver/fechar', () => {
    expect([...toastHtml([item], 0).matchAll(/href="([^"]+)"/g)].map(m => m[1])).toEqual(['pokehub-toast:ver', 'pokehub-toast:fechar']);
  });
});

describe('atualização: progresso com tamanho e velocidade', () => {
  const downloading = reduceUpdate(reduceUpdate(INITIAL_UPDATE, {type:'available', version:'1.1.0'}), {type:'start-download'});
  it('guarda bytes baixados, total e velocidade', () => {
    expect(reduceUpdate(downloading, {type:'progress', percent:42.4, transferred:22e6, total:52e6, bps:1.1e7})).toEqual({state:'downloading', version:'1.1.0', percent:42, transferred:22e6, total:52e6, bps:1.1e7});
  });
  it('descarta números inválidos', () => {
    const next = reduceUpdate(downloading, {type:'progress', percent:10, transferred:-5, total:Number.NaN, bps:1e12});
    expect(next).toEqual({state:'downloading', version:'1.1.0', percent:10});
  });
  it('baixado vira pronto (sem resto de progresso)', () => {
    expect(reduceUpdate(reduceUpdate(downloading, {type:'progress', percent:99, total:5}), {type:'downloaded'})).toEqual({state:'ready', version:'1.1.0'});
  });
});

describe('instalação da atualização', () => {
  it('silenciosa e reabre o app (sem o assistente do instalador)', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('spike/electron/updater.ts', 'utf8');
    expect(code).toContain('autoUpdater.quitAndInstall(true,true)');
    expect(code).not.toContain('quitAndInstall(false');
  });
});

describe('sons do alerta', () => {
  it('os 3 sons da Kenney estão no app com a licença CC0 junto', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    for (const f of ['confirmation_001.wav', 'confirmation_003.wav', 'glass_001.wav']) {
      expect(existsSync(`spike/src/assets/sounds/${f}`)).toBe(true);
      expect(readFileSync(`spike/src/assets/sounds/${f}`).subarray(0, 4).toString()).toBe('RIFF');
    }
    expect(readFileSync('spike/src/assets/sounds/LICENSE-kenney-interface-sounds.txt', 'utf8')).toMatch(/CC0|Creative Commons Zero/i);
  });
});
