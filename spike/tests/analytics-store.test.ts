import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrindolinoStore } from '../electron/grindolino-store';
import { GrindolinoError } from '../domain/grindolino';
import { ProfileStore } from '../electron/profile-store';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

it('consulta séries e exporta pelo banco sem expor e-mail nem identificadores', () => {
  const dir = mkdtempSync(join(tmpdir(),'pokehub-analytics-'));
  try {
    const path = join(dir,'app.sqlite');
    const profiles = new ProfileStore(path); const store = new GrindolinoStore(path);
    const main = profiles.create({label:'Main',emailLabel:'segredo@example.com',characterName:'Ash',colorToken:'#d4a65f'});
    const alt = profiles.create({label:'Alt',emailLabel:'outro@example.com',characterName:'',colorToken:'#3fa7d6'});
    const hunt = store.createHunt({name:'Caverna',region:'',requiredTrainerLevel:null});
    const old = store.addMeasurement({accountId:main.id,huntId:hunt.id,minutes:60,xpGained:100,coinsGained:null});
    store.addMeasurement({accountId:main.id,huntId:hunt.id,minutes:30,xpGained:1000,coinsGained:40,killCount:20,shinyCount:0});
    store.addMeasurement({accountId:alt.id,huntId:hunt.id,minutes:60,xpGained:500,coinsGained:null});
    store.addForecast({accountId:main.id,huntId:hunt.id,xpPerHour:4000,coinsPerHour:null});
    const now = new Date();
    const raw = new DatabaseSync(path); raw.prepare('UPDATE grindolino_measurements SET recorded_at=? WHERE id=?').run(new Date(now.getTime() - 40 * 86_400_000).toISOString(),old.id); raw.close();

    const week = store.series({accountId:null,huntId:hunt.id,metric:'xp',range:'7d'},now);
    expect(week.series.map(series => [series.accountId,series.summary.perHour,series.summary.forecastPerHour])).toEqual([[main.id,2000,4000],[alt.id,500,null]]);
    expect(store.series({accountId:main.id,huntId:null,metric:'xp',range:'all'},now).series).toEqual([expect.objectContaining({accountId:main.id,summary:expect.objectContaining({samples:2,minutes:90})})]);
    expect(store.series({accountId:alt.id,huntId:null,metric:'kills',range:'30d'},now).series[0]?.points).toEqual([]);
    expect(() => store.series({accountId:null,huntId:null,metric:'dps',range:'7d'})).toThrow(GrindolinoError);

    const csv = store.exportFile({format:'csv',scope:{accountId:null,huntId:null,range:'all'}},now);
    expect(csv.rows).toBe(4);
    expect(csv.content.startsWith('\uFEFFtipo;data;conta;hunt')).toBe(true);
    const json = store.exportFile({format:'json',scope:{accountId:main.id,huntId:null,range:'7d'}},now);
    expect(JSON.parse(json.content)).toMatchObject({measurements:[{account:'Main',hunt:'Caverna',xpGained:1000}],forecasts:[{account:'Main',xpPerHour:4000}],daily:[{account:'Main',killsPerHour:40}]});
    for (const content of [csv.content,json.content]) for (const secret of ['segredo','example.com','Ash',main.id,alt.id,hunt.id,dir]) expect(content).not.toContain(secret);
    expect(() => store.exportFile({format:'pdf',scope:{accountId:null,huntId:null,range:'all'}})).toThrow(GrindolinoError);
    store.close(); profiles.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
