import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { closeContents } from '../electron/close-contents';
class Contents extends EventEmitter {
 destroyed = false;
 close() {}
 isDestroyed() {return this.destroyed;}
 finish() {this.destroyed=true;this.emit('destroyed');}
}
describe('encerramento da view', () => {
 it('aguarda o evento de destruição', async () => {
  const contents = new Contents(); let finished = false;
  const pending = closeContents(contents,100).then(()=>{finished=true;});
  await Promise.resolve(); expect(finished).toBe(false);
  contents.finish(); await pending; expect(finished).toBe(true); expect(contents.listenerCount('destroyed')).toBe(0);
 });
 it('sinaliza tempo esgotado e remove o listener', async () => {
  const contents = new Contents();
  await expect(closeContents(contents,5)).rejects.toThrow();
  expect(contents.listenerCount('destroyed')).toBe(0);
 });
 it('aceita uma view já destruída', async () => {
  const contents = new Contents(); contents.destroyed=true;
  await expect(closeContents(contents,100)).resolves.toBeUndefined();
 });
});
