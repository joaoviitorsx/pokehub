// Benchmark de recursos com 0/1/2/4 WebContentsView (docs/benchmarks/protocolo-etapa-0.md).
// Uso: node scripts/benchmark-sessions.cjs   (o mesmo arquivo roda como runner em Node e como app no Electron)
// Carrega a página pública deslogada; não faz login, cliques nem altera o user agent.
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, isAbsolute } = require('node:path');

const URL_ALVO = 'https://pokeidle.io/app';
const CENARIOS = [0, 1, 2, 4];
const ESTABILIZACAO_MS = Number(process.env.BENCH_SETTLE_MS ?? 30000);
const AMOSTRAS = Number(process.env.BENCH_SAMPLES ?? 15);
const INTERVALO_MS = 2000;
const LIMITE_CARGA_MS = 60000;
const MARCA = 'BENCH_RESULT ';

const quantil = (valores, q) => {
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)]; // nearest-rank
};

if (process.versions.electron) executarCenario(); else executarTodos();

function executarTodos() {
  const { spawnSync } = require('node:child_process');
  const electronCli = require.resolve('electron/cli.js');
  const linhas = [];
  let exitCode = 0;
  for (const n of CENARIOS) {
    // Um processo e um userData temporário por cenário: nada é herdado do cenário anterior nem do perfil real.
    const directory = mkdtempSync(join(tmpdir(), 'pokehub-bench-'));
    try {
      const result = spawnSync(process.execPath, [electronCli, __filename], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
        timeout: LIMITE_CARGA_MS + ESTABILIZACAO_MS + AMOSTRAS * INTERVALO_MS + 30000,
        env: { ...process.env, POKEHUB_BENCH_DIR: directory, POKEHUB_BENCH_VIEWS: String(n) },
      });
      const linha = result.stdout?.split('\n').find(l => l.startsWith(MARCA));
      if (result.error || result.status !== 0 || !linha) {
        console.error(`Cenário ${n} falhou${result.error ? `: ${result.error.message}` : ` (código ${result.status ?? 'sem código'})`}.`);
        exitCode = 1; continue;
      }
      linhas.push(JSON.parse(linha.slice(MARCA.length)));
    } finally {
      try { rmSync(directory, { recursive: true, force: true }); }
      catch { console.error('Não foi possível remover o diretório temporário:', directory); exitCode = 1; }
    }
  }
  console.log(JSON.stringify(linhas, null, 1));
  const mib = kb => (kb / 1024).toFixed(0);
  console.log('\n| Views | Carga por view (ms) | Processos | CPU % med | CPU % p95 | RSS MiB med | RSS p95 | PSS MiB med | PSS p95 | Privado MiB med |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of linhas) {
    const t = r.tipos.Total;
    console.log(`| ${r.views} | ${r.cargaMs.map(v => v ?? 'falhou').join(', ') || '—'} | ${r.processos} | ${t.cpu.med.toFixed(1)} | ${t.cpu.p95.toFixed(1)} | ${mib(t.rssKb.med)} | ${mib(t.rssKb.p95)} | ${mib(t.pssKb.med)} | ${mib(t.pssKb.p95)} | ${mib(t.privKb.med)} |`);
  }
  console.log('\n| Views | Tipo | Processos | CPU % med | CPU % p95 | RSS MiB med | PSS MiB med | Privado MiB med |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of linhas) for (const [tipo, t] of Object.entries(r.tipos)) if (tipo !== 'Total')
    console.log(`| ${r.views} | ${tipo} | ${t.n} | ${t.cpu.med.toFixed(1)} | ${t.cpu.p95.toFixed(1)} | ${mib(t.rssKb.med)} | ${mib(t.pssKb.med)} | ${mib(t.privKb.med)} |`);
  process.exitCode = exitCode;
}

function executarCenario() {
  const { app, BrowserWindow, WebContentsView } = require('electron');
  const dataDir = process.env.POKEHUB_BENCH_DIR;
  const n = Number(process.env.POKEHUB_BENCH_VIEWS);
  if (!dataDir || !isAbsolute(dataDir) || !CENARIOS.includes(n)) throw new Error('Configuração de benchmark inválida');
  app.setPath('userData', dataDir);
  const espera = ms => new Promise(resolve => setTimeout(resolve, ms));

  // PSS e memória privada vêm de /proc: no Linux o getAppMetrics não fornece privateBytes e o RSS conta páginas compartilhadas em cada processo.
  const smaps = pid => {
    try {
      const texto = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const campo = nome => Number(texto.match(new RegExp(`^${nome}:\\s+(\\d+)`, 'm'))?.[1] ?? NaN);
      return { pss: campo('Pss'), priv: campo('Private_Clean') + campo('Private_Dirty') };
    } catch { return { pss: NaN, priv: NaN }; }
  };

  app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 1280, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const [largura, altura] = window.getContentSize();
    const colunas = n > 1 ? 2 : 1, fileiras = n > 2 ? 2 : 1;
    const inicio = Date.now();
    const cargaMs = await Promise.all(Array.from({ length: n }, (_, index) => {
      // Partição sem "persist:" fica só em memória e é distinta por view.
      const view = new WebContentsView({ webPreferences: { partition: `bench-${index}`, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      window.contentView.addChildView(view);
      const w = Math.floor(largura / colunas), h = Math.floor(altura / fileiras);
      view.setBounds({ x: (index % 2) * w, y: Math.floor(index / 2) * h, width: w, height: h });
      return new Promise(resolve => {
        const fim = valor => { clearTimeout(limite); resolve(valor); };
        const limite = setTimeout(() => fim(null), LIMITE_CARGA_MS);
        view.webContents.once('did-finish-load', () => fim(Date.now() - inicio));
        view.webContents.once('did-fail-load', (_e, _codigo, _desc, _url, principal) => { if (principal) fim(null); });
        view.webContents.loadURL(URL_ALVO).catch(() => fim(null));
      });
    }));

    await espera(ESTABILIZACAO_MS);
    app.getAppMetrics(); // a primeira leitura de CPU não é uma medição; as seguintes cobrem o intervalo desde a anterior
    const amostras = [];
    for (let i = 0; i < AMOSTRAS; i++) {
      await espera(INTERVALO_MS);
      const porTipo = {};
      for (const m of app.getAppMetrics()) {
        const { pss, priv } = smaps(m.pid);
        for (const tipo of [m.type, 'Total']) {
          const t = porTipo[tipo] ??= { n: 0, cpu: 0, rssKb: 0, pssKb: 0, privKb: 0 };
          t.n++; t.cpu += m.cpu.percentCPUUsage; t.rssKb += m.memory.workingSetSize; t.pssKb += pss; t.privKb += priv;
        }
      }
      amostras.push(porTipo);
    }

    const tipos = {};
    for (const tipo of new Set(amostras.flatMap(a => Object.keys(a)))) {
      const serie = campo => amostras.map(a => a[tipo]?.[campo] ?? 0);
      const resumo = campo => ({ med: quantil(serie(campo), 0.5), p95: quantil(serie(campo), 0.95) });
      tipos[tipo] = { n: quantil(serie('n'), 0.5), cpu: resumo('cpu'), rssKb: resumo('rssKb'), pssKb: resumo('pssKb'), privKb: resumo('privKb') };
    }
    console.log(MARCA + JSON.stringify({ views: n, cargaMs, processos: tipos.Total.n, amostras: amostras.length, tipos }));
    app.exit(cargaMs.includes(null) ? 1 : 0);
  }).catch(error => { console.error('Benchmark falhou:', error?.message ?? error); app.exit(1); });
}
