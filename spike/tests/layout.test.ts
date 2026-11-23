import { describe, expect, it } from 'vitest';
import { layout } from '../electron/layout';

describe('layout do experimento', () => {
  it('divide a área sem sobreposição mesmo com dimensões ímpares', () => {
    const result = layout(1001, 701, 4, null);
    expect(result).toEqual([{x:0,y:48,width:500,height:326},{x:500,y:48,width:501,height:326},{x:0,y:374,width:500,height:327},{x:500,y:374,width:501,height:327}]);
  });
  it('mostra somente a sessão focada sem destruir as demais', () => {
    expect(layout(800, 600, 2, 1)).toEqual([null,{x:0,y:48,width:800,height:552}]);
  });
  it('a lateral reduz a largura só na grade', () => {
    expect(layout(1400, 800, 4, null, 340)).toEqual([{x:0,y:48,width:530,height:376},{x:530,y:48,width:530,height:376},{x:0,y:424,width:530,height:376},{x:530,y:424,width:530,height:376}]);
    expect(layout(1400, 800, 1, null, 340)).toEqual([{x:0,y:48,width:1060,height:752}]);
    expect(layout(1400, 800, 2, 1, 340)).toEqual([null,{x:0,y:48,width:1400,height:752}]);
    expect(layout(1400, 800, 2, null, 0)).toEqual(layout(1400, 800, 2, null));
  });
  it('a lateral só ocupa espaço na grade e com janela larga', async () => {
    const { sideWidth, SIDE_PANEL } = await import('../electron/layout');
    expect(sideWidth(1400, true, null)).toBe(SIDE_PANEL);
    expect(sideWidth(1060, true, null)).toBe(SIDE_PANEL);
    expect(sideWidth(1059, true, null)).toBe(0);
    expect(sideWidth(1400, false, null)).toBe(0);
    expect(sideWidth(1400, true, 0)).toBe(0);
  });
  it('a largura escolhida vale de 280 a 520 px e cede espaço para a grade', async () => {
    const { sideWidth } = await import('../electron/layout');
    expect(sideWidth(1400, true, null, 280)).toBe(280);
    expect(sideWidth(1400, true, null, 520)).toBe(520);
    expect(sideWidth(1100, true, null, 520)).toBe(380); // 1100 - 720 da grade
    expect(sideWidth(1060, true, null, 280)).toBe(280);
    expect(sideWidth(1059, true, null, 280)).toBe(0);
    expect(sideWidth(1400, false, null, 520)).toBe(0);
    for (const panel of [279, 521, 300.5, NaN, Infinity, -340]) expect(() => sideWidth(1400, true, null, panel)).toThrow();
    expect(layout(1400, 800, 2, null, sideWidth(1400, true, null, 400))).toEqual([{x:0,y:48,width:500,height:752},{x:500,y:48,width:500,height:752}]);
  });
  it('rejeita lateral inválida', () => {
    for (const side of [-1, 1.5, NaN, 801]) expect(() => layout(800, 600, 2, null, side)).toThrow();
  });
  it('rejeita quantidade e foco inválidos', () => {
    expect(() => layout(800, 600, 5, null)).toThrow();
    expect(() => layout(800, 600, 2, 2)).toThrow();
  });
});

describe('layout em janela pequena', () => {
 it('usa foco temporário quando a grade não tem espaço útil', async () => {
  const { effectiveFocus } = await import('../electron/layout');
  expect(effectiveFocus(700,800,4,null)).toEqual({index:0,automatic:true});
  expect(effectiveFocus(1000,500,4,null)).toEqual({index:0,automatic:true});
  expect(effectiveFocus(1000,800,4,null)).toEqual({index:null,automatic:false});
 });
 it('respeita foco escolhido e não altera visualização de uma sessão', async () => {
  const { effectiveFocus } = await import('../electron/layout');
  expect(effectiveFocus(700,480,4,2)).toEqual({index:2,automatic:false});
  expect(effectiveFocus(700,480,1,null)).toEqual({index:null,automatic:false});
  expect(effectiveFocus(800,480,2,null)).toEqual({index:null,automatic:false});
 });
});

it('restaura foco inicial apenas quando há perfis e a preferência pede foco', async () => {
 const { initialFocus } = await import('../electron/layout');
 expect(initialFocus('grid',['a','b'])).toBeNull();
 expect(initialFocus('focus-first',['a','b'])).toBe('a');
 expect(initialFocus('focus-first',[])).toBeNull();
});
