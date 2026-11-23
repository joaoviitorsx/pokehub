import { describe, expect, it } from 'vitest';
import { INITIAL_UPDATE, reduceUpdate, type UpdateEvent } from '../electron/update-status';
import type { UpdateStatus } from '../contracts/update';

const run = (events: UpdateEvent[], from: UpdateStatus = INITIAL_UPDATE) => events.reduce(reduceUpdate,from);

describe('estado da atualização', () => {
  it('segue o caminho verificar → disponível → baixar → pronto', () => {
    expect(run([{type:'checking'}])).toEqual({state:'checking'});
    expect(run([{type:'checking'},{type:'available',version:'0.2.0',notes:'Novidades'}])).toEqual({state:'available',version:'0.2.0',notes:'Novidades'});
    expect(run([{type:'available',version:'0.2.0'},{type:'start-download'},{type:'progress',percent:41.6}])).toEqual({state:'downloading',version:'0.2.0',percent:42});
    expect(run([{type:'available',version:'0.2.0'},{type:'start-download'},{type:'downloaded'}])).toEqual({state:'ready',version:'0.2.0'});
  });
  it('nenhuma atualização e erro de verificação', () => {
    expect(run([{type:'checking'},{type:'none'}])).toEqual({state:'none'});
    expect(run([{type:'checking'},{type:'error',message:'Falhou'}])).toEqual({state:'error',error:'Falhou'});
    expect(run([{type:'error',message:'  \u0000 '}])).toEqual({state:'error',error:'Falha na atualização.'});
  });
  it('erro ao baixar volta a "disponível" mantendo a versão para tentar de novo; erro repetido não a perde', () => {
    const failed = run([{type:'available',version:'0.2.0',notes:'n'},{type:'start-download'},{type:'progress',percent:10},{type:'error',message:'Sem rede'}]);
    expect(failed).toEqual({state:'available',version:'0.2.0',notes:'n',error:'Sem rede'});
    expect(reduceUpdate(failed,{type:'error',message:'Sem rede'})).toBe(failed);
    expect(reduceUpdate(failed,{type:'start-download'})).toMatchObject({state:'downloading',percent:0});
  });
  it('não regride enquanto baixa ou depois de baixar', () => {
    const downloading = run([{type:'available',version:'0.2.0'},{type:'start-download'}]);
    expect(reduceUpdate(downloading,{type:'checking'})).toBe(downloading);
    expect(reduceUpdate(downloading,{type:'none'})).toBe(downloading);
    expect(reduceUpdate(downloading,{type:'available',version:'0.3.0'})).toBe(downloading);
    const ready = reduceUpdate(downloading,{type:'downloaded'});
    expect(reduceUpdate(ready,{type:'checking'})).toBe(ready);
    expect(reduceUpdate(ready,{type:'progress',percent:5})).toBe(ready);
  });
  it('limita o progresso a 0–100, ignora eventos fora de ordem e sanitiza texto', () => {
    const downloading = run([{type:'available',version:'0.2.0'},{type:'start-download'}]);
    expect(reduceUpdate(downloading,{type:'progress',percent:250})).toMatchObject({percent:100});
    expect(reduceUpdate(downloading,{type:'progress',percent:-3})).toMatchObject({percent:0});
    expect(reduceUpdate(downloading,{type:'progress',percent:Number.NaN})).toMatchObject({percent:0});
    expect(reduceUpdate(INITIAL_UPDATE,{type:'progress',percent:50})).toBe(INITIAL_UPDATE);
    expect(reduceUpdate(INITIAL_UPDATE,{type:'start-download'})).toBe(INITIAL_UPDATE);
    expect(reduceUpdate(INITIAL_UPDATE,{type:'downloaded'})).toBe(INITIAL_UPDATE);
    expect(reduceUpdate(INITIAL_UPDATE,{type:'available',version:'0.2.0\n',notes:`a\nb${'x'.repeat(600)}`})).toMatchObject({version:'0.2.0',notes:expect.stringMatching(/^a bx+$/)});
    expect(reduceUpdate(INITIAL_UPDATE,{type:'available',version:''})).toEqual({state:'error',error:'Resposta de atualização inválida.'});
  });
  it('desativado fica desativado', () => {
    const disabled = run([{type:'disable'}]);
    expect(disabled).toEqual({state:'disabled'});
    expect(reduceUpdate(disabled,{type:'checking'})).toBe(disabled);
    expect(reduceUpdate(disabled,{type:'available',version:'1.0.0'})).toBe(disabled);
  });
});
