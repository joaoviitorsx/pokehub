import { describe, expect, it } from 'vitest';
import { COL_HEAD, COL_MIN, columns, effectiveFocus, gridShape, initialFocus, layout, MAX_PROFILES, SIDE_MAX, SIDE_MIN, SIDE_PANEL, sideWidth, TOP_BAR, type Bounds } from '../electron/layout';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
// Sem lacunas nem sobreposição: as colunas cobrem exatamente a área (largura × altura abaixo da barra) e nenhuma se cruza.
function expectExactCover(rects: (Bounds | null)[], width: number, height: number) {
  const list = rects.filter((rect): rect is Bounds => rect !== null);
  expect(sum(list.map(r => r.width * r.height))).toBe(width * (height - TOP_BAR));
  for (const [i, a] of list.entries()) {
    expect(a.x >= 0 && a.y >= TOP_BAR && a.x + a.width <= width && a.y + a.height <= height && a.width > 0 && a.height > 0).toBe(true);
    for (const b of list.slice(i + 1)) expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
  }
}

describe('layout em colunas', () => {
  it('1 a 4 contas lado a lado quando cada coluna tem COL_MIN', () => {
    expect(columns(1400, 800, 1, null)).toEqual([{x:0,y:48,width:1400,height:752}]);
    expect(columns(1400, 800, 2, null)).toEqual([{x:0,y:48,width:700,height:752},{x:700,y:48,width:700,height:752}]);
    expect(columns(1400, 800, 3, null).map(b => b?.width)).toEqual([466,466,468]);
    expect(columns(1400, 800, 4, null)).toEqual([0,350,700,1050].map(x => ({x,y:48,width:350,height:752})));
  });
  it('a view do jogo começa COL_HEAD abaixo do topo da coluna', () => {
    expect(COL_HEAD).toBe(30);
    expect(layout(1400, 800, 2, null)).toEqual([{x:0,y:78,width:700,height:722},{x:700,y:78,width:700,height:722}]);
    expect(layout(1400, 800, 1, null)).toEqual([{x:0,y:78,width:1400,height:722}]);
  });
  it('quebra em linhas quando a coluna ficaria abaixo de COL_MIN, sem desperdiçar largura', () => {
    expect(gridShape(1400, 4)).toEqual({cols:4,rows:1});
    expect(gridShape(1000, 4)).toEqual({cols:2,rows:2});
    expect(gridShape(1060, 4)).toEqual({cols:2,rows:2}); // 3+1 vira 2×2
    expect(gridShape(700, 3)).toEqual({cols:2,rows:2});
    expect(gridShape(339, 3)).toEqual({cols:1,rows:3});
    expect(gridShape(1100, 5)).toEqual({cols:3,rows:2});
    expect(columns(700, 800, 4, null)).toEqual([{x:0,y:48,width:350,height:376},{x:350,y:48,width:350,height:376},{x:0,y:424,width:350,height:376},{x:350,y:424,width:350,height:376}]);
  });
  it('a última linha, se menor, divide a largura inteira', () => {
    expect(columns(700, 800, 3, null)).toEqual([{x:0,y:48,width:350,height:376},{x:350,y:48,width:350,height:376},{x:0,y:424,width:700,height:376}]);
    const five = columns(1100, 800, 5, null) as Bounds[];
    expect(five.slice(0,3).map(b => b.width)).toEqual([366,366,368]);
    expect(five.slice(3).map(b => [b.x,b.width])).toEqual([[0,550],[550,550]]);
  });
  it('funciona para qualquer quantidade, sem teto em 4', () => {
    expect(MAX_PROFILES).toBe(4);
    const six = columns(1400, 800, 6, null);
    expect(six).toHaveLength(6);
    expectExactCover(six, 1400, 800);
  });
  it('não deixa lacunas nem sobreposição em nenhuma combinação, mesmo com medidas ímpares', () => {
    for (const width of [700, 701, 899, 1001, 1279, 1366, 1920]) for (const height of [480, 601, 701, 1080]) for (const count of [1, 2, 3, 4, 5, 6]) for (const side of [0, 340, 281]) {
      const rects = columns(width, height, count, null, side);
      expect(rects).toHaveLength(count);
      expectExactCover(rects, width - side, height); // a lateral ocupa a faixa à direita: as colunas cobrem só width - side
      for (const g of layout(width, height, count, null, side)) expect(g && g.y >= TOP_BAR + COL_HEAD && g.height >= 0).toBe(true);
    }
  });
  it('divide a largura com o resto na última coluna', () => {
    const rects = columns(1361, 701, 4, null) as Bounds[];
    expect(rects.map(r => r.width)).toEqual([340,340,340,341]);
    expect(rects.map(r => r.x)).toEqual([0,340,680,1020]);
    expect((columns(1001, 701, 2, null) as Bounds[]).map(r => r.width)).toEqual([500,501]);
  });
  it('divide a altura entre linhas com o resto na última', () => {
    const rects = columns(700, 701, 4, null) as Bounds[];
    expect(rects.map(r => r.height)).toEqual([326,326,327,327]);
    expect(rects.map(r => r.y)).toEqual([48,48,374,374]);
  });
  it('a lateral reduz a largura da grade e da coluna focada', () => {
    expect(columns(1400, 800, 4, null, 340).map(b => b?.width)).toEqual([530,530,530,530]);
    expect(columns(1400, 800, 2, null, 340).map(b => b?.width)).toEqual([530,530]);
    expect(columns(1400, 800, 1, null, 340)).toEqual([{x:0,y:48,width:1060,height:752}]);

    expect(columns(1400, 800, 2, null, 0)).toEqual(columns(1400, 800, 2, null));
  });
  it('mostra somente a sessão focada sem destruir as demais, com cabeçalho', () => {
    expect(columns(800, 600, 2, 1)).toEqual([null,{x:0,y:48,width:800,height:552}]);
    expect(layout(800, 600, 2, 1)).toEqual([null,{x:0,y:78,width:800,height:522}]);
  });
  it('rejeita entradas inválidas', () => {
    for (const side of [-1, 1.5, NaN, 801]) expect(() => layout(800, 600, 2, null, side)).toThrow();
    expect(() => layout(800, 600, 0, null)).toThrow();
    expect(() => layout(800, 600, 2, 2)).toThrow();
    expect(() => layout(800, 600, 2, -1)).toThrow();
    expect(() => layout(800.5, 600, 2, null)).toThrow();
    expect(() => layout(800, 40, 2, null)).toThrow();
  });
});

describe('layout em janela pequena', () => {
  it('usa foco temporário quando nem uma coluna cabe ou as linhas ficam baixas demais', () => {
    expect(effectiveFocus(339, 800, 2, null)).toEqual({index:0,automatic:true});
    expect(effectiveFocus(1000, 500, 4, null)).toEqual({index:0,automatic:true}); // 2 linhas × 270 > 452
    expect(effectiveFocus(700, 400, 3, null)).toEqual({index:0,automatic:true});
    expect(effectiveFocus(700, 800, 4, null)).toEqual({index:null,automatic:false});
    expect(effectiveFocus(1400, 400, 4, null)).toEqual({index:null,automatic:false}); // 1 linha de 352 px
    expect(effectiveFocus(1000, 800, 4, null)).toEqual({index:null,automatic:false});
  });
  it('respeita foco escolhido e não altera visualização de uma sessão', () => {
    expect(effectiveFocus(300, 300, 4, 2)).toEqual({index:2,automatic:false});
    expect(effectiveFocus(300, 300, 1, null)).toEqual({index:null,automatic:false});
    expect(effectiveFocus(800, 480, 2, null)).toEqual({index:null,automatic:false});
  });
});

describe('lateral "Onde caçar?" em todos os modos', () => {
  it('abre em qualquer largura de janela útil (mínima 700) e sempre deixa ao menos uma coluna ao lado', () => {
    expect(sideWidth(1400, true)).toBe(SIDE_PANEL);
    expect(sideWidth(1400, false)).toBe(0);
    expect(sideWidth(700, true)).toBe(SIDE_PANEL); // sobram 360 ≥ COL_MIN
    expect(sideWidth(700, true, SIDE_MIN)).toBe(SIDE_MIN);
    expect(sideWidth(700, true, SIDE_MAX)).toBe(360);
    expect(sideWidth(620, true)).toBe(SIDE_MIN); // 620 - 340 = 280
    expect(sideWidth(619, true)).toBe(0); // nem a lateral mínima cabe ao lado de uma coluna
    for (const width of [700, 701, 900, 1280, 1920]) for (const panel of [SIDE_MIN, SIDE_PANEL, SIDE_MAX]) expect(width - sideWidth(width, true, panel)).toBeGreaterThanOrEqual(COL_MIN);
  });
  it('a largura escolhida vale de 280 a 520 px e cede espaço para a coluna', () => {
    expect(sideWidth(1400, true, 280)).toBe(280);
    expect(sideWidth(1400, true, 520)).toBe(520);
    expect(sideWidth(800, true, 520)).toBe(460); // 800 - 340
    for (const panel of [279, 521, 300.5, NaN, Infinity, -340]) expect(() => sideWidth(1400, true, panel)).toThrow();
    expect(layout(1400, 800, 2, null, sideWidth(1400, true, 400))).toEqual([{x:0,y:78,width:500,height:722},{x:500,y:78,width:500,height:722}]);
  });
  it('no foco/expandido a conta ocupa a largura menos a lateral', () => {
    const side = sideWidth(1400, true);
    expect(columns(1400, 800, 3, 1, side)).toEqual([null,{x:0,y:48,width:1400 - side,height:752},null]);
    expect(layout(1400, 800, 3, 2, side)[2]).toEqual({x:0,y:78,width:1400 - side,height:722});
  });
  it('na grade a lateral quebra em menos colunas/linhas enquanto cada coluna tiver COL_MIN', () => {
    expect(gridShape(1400, 4)).toEqual({cols:4,rows:1});
    expect(gridShape(1400 - 340, 4)).toEqual({cols:2,rows:2}); // 1060: 3+1 vira 2×2
    expect(columns(1100, 800, 4, null, 340).map(b => b?.width)).toEqual([380,380,380,380]);
    expect(columns(1100, 800, 2, null, 340).map(b => b?.width)).toEqual([380,380]);
    expect(columns(700, 800, 2, null, 360).map(b => [b?.width,b?.y])).toEqual([[340,48],[340,424]]); // 1 coluna por linha
  });
  it('se nem uma coluna cabe ao lado da lateral, ou as linhas ficam baixas, mostra só a conta da lateral (foco automático)', () => {
    expect(effectiveFocus(700, 800, 3, null, 360)).toEqual({index:0,automatic:true}); // 340 de largura = 1 coluna × 3 linhas, baixo demais
    expect(effectiveFocus(1000, 600, 4, null, 340, 2)).toEqual({index:2,automatic:true}); // 660 → 1 coluna × 4 linhas: não cabe na altura
    expect(effectiveFocus(1000, 600, 4, null, 340)).toEqual({index:0,automatic:true});
    expect(effectiveFocus(1000, 600, 4, null, 340, 9)).toEqual({index:0,automatic:true}); // conta inválida volta à primeira
    expect(effectiveFocus(1000, 900, 2, null, 340, 1)).toEqual({index:null,automatic:false}); // 2 linhas de 1 coluna cabem em 852
    expect(effectiveFocus(600, 900, 2, null, 280, 1)).toEqual({index:1,automatic:true}); // 320 < COL_MIN
    expect(effectiveFocus(1400, 800, 4, 2, 340, 1)).toEqual({index:2,automatic:false}); // foco escolhido vence
    expect(effectiveFocus(1400, 800, 4, null, 0)).toEqual({index:null,automatic:false});
  });
});

it('restaura foco inicial apenas quando há perfis e a preferência pede foco', () => {
  expect(initialFocus('grid',['a','b'])).toBe(null);
  expect(initialFocus('focus-first',['a','b'])).toBe('a');
  expect(initialFocus('focus-first',[])).toBe(null);
});
