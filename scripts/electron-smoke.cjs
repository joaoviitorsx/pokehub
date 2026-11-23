const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView } = require('electron');

const dataDir = process.env.POKEHUB_SMOKE_DIR;
const phase = process.env.POKEHUB_SMOKE_PHASE;
if (!dataDir || !path.isAbsolute(dataDir) || !['write','read'].includes(phase)) throw new Error('Configuração de teste inválida');
app.setPath('userData', dataDir);

app.whenReady().then(async () => {
  const window = new BrowserWindow({show:false, width:800, height:600, webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false}});
  const views = Array.from({length:4}, (_, index) => new WebContentsView({webPreferences:{partition:`persist:smoke-${index}`, sandbox:true, contextIsolation:true, nodeIntegration:false}}));
  try {
    for (const [index, view] of views.entries()) {
      window.contentView.addChildView(view);
      view.setBounds({x:(index % 2)*400,y:Math.floor(index/2)*300,width:400,height:300});
    }
    const loadCounts = views.map(() => 0);
    views.forEach((view,index) => view.webContents.on('did-start-loading', () => { loadCounts[index]++; }));
    await Promise.all(views.map((view,index) => view.webContents.loadURL(`data:text/html,<title>Session ${index}</title>`)));
    const initialLoads = loadCounts.slice();
    const ids = views.map(view => view.webContents.id);
    assert.equal(new Set(ids).size,4);
    assert.equal(new Set(views.map(view => view.webContents.session)).size,4);
    const sessions = views.map(view => view.webContents.session);
    const first = sessions[0];
    assert.ok(first);
    if (phase === 'write') {
      await first.cookies.set({url:'https://pokehub-smoke.invalid/',name:'probe',value:'synthetic',expirationDate:Math.floor(Date.now()/1000)+3600});
      await first.cookies.flushStore();
    }
    for (const [index, session] of sessions.entries()) {
      const cookies = await session.cookies.get({url:'https://pokehub-smoke.invalid/',name:'probe'});
      assert.equal(cookies.length,index === 0 ? 1 : 0,`Isolamento da sessão ${index+1}`);
    }
    views.forEach((view,index) => { view.setVisible(index === 1); if (index === 1) view.setBounds({x:0,y:0,width:800,height:600}); });
    assert.deepEqual(views.map(view => view.webContents.id),ids);
    views.forEach(view => view.setVisible(true));
    assert.deepEqual(views.map(view => view.webContents.id),ids);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(loadCounts,initialLoads,'Alterar foco não deve recarregar as views');
    await assert.rejects(views[0].webContents.loadFile(path.join(dataDir,'arquivo-inexistente.html')));
    assert.equal(views[1].webContents.isDestroyed(),false,'Falha de uma view não deve encerrar outra');
    assert.equal(views[1].webContents.getTitle(),'Session 1');
    console.log(`Electron smoke ${phase}: quatro views, isolamento e foco aprovados.`);
  } finally {
    for (const view of views) if (!view.webContents.isDestroyed()) view.webContents.close();
    if (!window.isDestroyed()) window.destroy();
  }
  app.exit(0);
}).catch(error => { console.error('Falha no smoke test do Electron:', error.message); app.exit(1); });
