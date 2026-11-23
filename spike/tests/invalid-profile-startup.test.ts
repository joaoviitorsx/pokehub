import { afterAll, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore } from '../electron/profile-store';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const directory=mkdtempSync(join(tmpdir(),'pokehub-invalid-id-'));
const path=join(directory,'pokehub.sqlite');
const handlers=new Map<string,(...args:unknown[])=>unknown>();
const createView=vi.fn(); let shell: FakeWindow;
class FakeContents extends EventEmitter {
 mainFrame={};
 setWindowOpenHandler() {}
 send() {}
 loadFile() {return Promise.resolve();}
}
class FakeWindow extends EventEmitter {
 webContents=new FakeContents();
 contentView={addChildView(){},removeChildView(){}};
 constructor(){super();shell=this;}
 getContentSize(){return [1280,800];}
 removeMenu(){}
 isDestroyed(){return false;}
 isMinimized(){return false;}
 focus(){}
 loadFile(){return Promise.resolve();}
}
const app=Object.assign(new EventEmitter(),{requestSingleInstanceLock:()=>true,commandLine:{getSwitchValue:()=>'',appendSwitch:vi.fn()},setAppUserModelId:vi.fn(),whenReady:()=>Promise.resolve(),getPath:()=>directory,quit:vi.fn()});
vi.doMock('electron',()=>({app,BrowserWindow:FakeWindow,WebContentsView:createView,ipcMain:{handle:(name:string,handler:(...args:unknown[])=>unknown)=>handlers.set(name,handler)},dialog:{showErrorBox(){}}}));
afterAll(()=>{shell?.emit('closed');vi.doUnmock('electron');rmSync(directory,{recursive:true,force:true});});

it('isola identificador inválido e permite remover o perfil sem abrir a view', async () => {
 const store=new ProfileStore(path);store.close();
 const db=new DatabaseSync(path);
 const id='../../unauthorized';
 db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?, ?, ?)').run(id,'Inválido','a@example.com','','#d4a65f','2026','2026');db.close();
 await import('../electron/main');
 await vi.waitFor(()=>expect(handlers.has('session:states')).toBe(true));
 const sender={sender:shell.webContents,senderFrame:shell.webContents.mainFrame};
 expect(createView).not.toHaveBeenCalled();
 expect(handlers.get('session:states')?.(sender)).toEqual({ok:true,data:{[id]:'error'}});
 expect((await handlers.get('session:restart')?.(sender,id) as {ok:boolean}).ok).toBe(false);
 expect(createView).not.toHaveBeenCalled();
 expect((await handlers.get('profiles:remove')?.(sender,id) as {ok:boolean}).ok).toBe(true);
 expect(handlers.get('profiles:list')?.(sender)).toEqual({ok:true,data:[]});
});
