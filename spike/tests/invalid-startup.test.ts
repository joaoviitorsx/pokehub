import { afterAll, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore } from '../electron/profile-store';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const directory=mkdtempSync(join(tmpdir(),'pokehub-invalid-start-'));
const path=join(directory,'pokehub.sqlite');
const app=Object.assign(new EventEmitter(),{requestSingleInstanceLock:()=>true,commandLine:{getSwitchValue:()=>'',appendSwitch:vi.fn()},setAppUserModelId:vi.fn(),whenReady:()=>Promise.resolve(),getPath:()=>directory,quit:vi.fn()});
const showErrorBox=vi.fn(); const createWindow=vi.fn(); const createView=vi.fn();
vi.doMock('electron',()=>({app,BrowserWindow:createWindow,WebContentsView:createView,ipcMain:{handle(){}},dialog:{showErrorBox}}));
afterAll(()=>{vi.doUnmock('electron');rmSync(directory,{recursive:true,force:true});});

it('não abre nenhuma view se o banco contiver mais de quatro perfis', async () => {
 const errorLog=vi.spyOn(console,'error').mockImplementation(()=>{});
 const store=new ProfileStore(path);
 const input={label:'Conta',emailLabel:'a@example.com',characterName:'',colorToken:'#d4a65f'};
 for(let i=0;i<4;i++) store.create(input);
 store.close();
 const db=new DatabaseSync(path);
 db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?, ?, ?)').run('550e8400-e29b-41d4-a716-446655440000','Quinto','a@example.com','','#d4a65f','2026','2026'); db.close();
 await import('../electron/main');
 await vi.waitFor(()=>expect(showErrorBox).toHaveBeenCalled());
 expect(createWindow).not.toHaveBeenCalled();expect(createView).not.toHaveBeenCalled();
 expect(showErrorBox.mock.calls[0]?.[1]).toContain('mais de quatro perfis');
 expect(errorLog).toHaveBeenCalled();errorLog.mockRestore();
 const check=new DatabaseSync(path);expect(check.prepare('SELECT COUNT(*) AS count FROM profiles').get()).toMatchObject({count:5});check.close();
});
