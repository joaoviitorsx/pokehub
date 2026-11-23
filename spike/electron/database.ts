import type { DatabaseSync as Database } from 'node:sqlite';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  try {
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8 && version !== 9 && version !== 10) throw new Error('Versão de banco incompatível');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON'); // as cascatas do Grindolino dependem das FKs em toda conexão
    if (version < 10) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (version === 0) db.exec('CREATE TABLE profiles (id TEXT PRIMARY KEY, label TEXT NOT NULL, emailLabel TEXT NOT NULL, characterName TEXT NOT NULL, colorToken TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)');
        if (version < 2) db.exec("CREATE TABLE workspace_settings (id INTEGER PRIMARY KEY CHECK (id = 1), startup_mode TEXT NOT NULL CHECK (startup_mode IN ('grid', 'focus-first'))); INSERT INTO workspace_settings VALUES (1, 'grid')");
        if (version < 3) db.exec(`CREATE TABLE grindolino_hunts (id TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL, required_trainer_level INTEGER, created_at TEXT NOT NULL);
          CREATE TABLE grindolino_forecasts (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, hunt_id TEXT NOT NULL REFERENCES grindolino_hunts(id) ON DELETE CASCADE, xp_per_hour INTEGER, coins_per_hour INTEGER, read_at TEXT NOT NULL);
          CREATE TABLE grindolino_measurements (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, hunt_id TEXT NOT NULL REFERENCES grindolino_hunts(id) ON DELETE CASCADE, minutes INTEGER NOT NULL, xp_gained INTEGER, coins_gained INTEGER, recorded_at TEXT NOT NULL);
          CREATE INDEX grindolino_forecasts_account_hunt ON grindolino_forecasts (account_id, hunt_id);
          CREATE INDEX grindolino_forecasts_hunt ON grindolino_forecasts (hunt_id);
          CREATE INDEX grindolino_measurements_account_hunt ON grindolino_measurements (account_id, hunt_id);
          CREATE INDEX grindolino_measurements_hunt ON grindolino_measurements (hunt_id);`);
        // v4: pasta da extensão /hunt instalada pelo usuário; NULL = desativada
        if (version < 4) db.exec('ALTER TABLE workspace_settings ADD COLUMN hunt_extension_path TEXT');
        // v5: abates, shinies e Pokémon em campo da medição ao vivo; NULL nas medições digitadas
        if (version < 5) db.exec('ALTER TABLE grindolino_measurements ADD COLUMN kill_count INTEGER; ALTER TABLE grindolino_measurements ADD COLUMN shiny_count INTEGER; ALTER TABLE grindolino_measurements ADD COLUMN pokemon_key TEXT; ALTER TABLE grindolino_measurements ADD COLUMN pokemon_name TEXT; ALTER TABLE grindolino_measurements ADD COLUMN pokemon_level INTEGER; ALTER TABLE grindolino_measurements ADD COLUMN pokemon_level_end INTEGER');
        // v6: histórico por conta e período (analytics) sem varrer a tabela
        if (version < 6) db.exec('CREATE INDEX grindolino_measurements_account_time ON grindolino_measurements (account_id, recorded_at)');
        // v7: várias extensões (a coluna hunt_extension_path fica, sem uso) e verificação automática de atualização
        if (version < 7) db.exec("CREATE TABLE extensions (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL, added_at TEXT NOT NULL); INSERT INTO extensions SELECT 'mhnplloljgchpfpcpbhmcokmnefodjnh', hunt_extension_path, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM workspace_settings WHERE id=1 AND hunt_extension_path IS NOT NULL AND hunt_extension_path<>''; ALTER TABLE workspace_settings ADD COLUMN auto_update_check INTEGER NOT NULL DEFAULT 1");
        // v8: sites externos que o usuário aprovou para cada extensão (JSON; NULL = nenhum)
        if (version < 8) db.exec('ALTER TABLE extensions ADD COLUMN approved_hosts TEXT');
        // v9: Modo leve e "som só na conta em foco" (0/1); só colunas novas com padrão 0, nada é reescrito
        if (version < 9) db.exec('ALTER TABLE workspace_settings ADD COLUMN lite_mode INTEGER NOT NULL DEFAULT 0; ALTER TABLE workspace_settings ADD COLUMN mute_unfocused INTEGER NOT NULL DEFAULT 0');
        // v10: bandeja do sistema (0/1): continuar ao fechar (padrão 1), ao minimizar (padrão 1) e aviso de primeira vez já mostrado (padrão 0)
        db.exec('ALTER TABLE workspace_settings ADD COLUMN tray_on_close INTEGER NOT NULL DEFAULT 1; ALTER TABLE workspace_settings ADD COLUMN tray_on_minimize INTEGER NOT NULL DEFAULT 1; ALTER TABLE workspace_settings ADD COLUMN tray_hint_shown INTEGER NOT NULL DEFAULT 0; PRAGMA user_version=10; COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    return db;
  } catch (error) { db.close(); throw error; }
}
