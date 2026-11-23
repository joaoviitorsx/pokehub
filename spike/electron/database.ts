import type { DatabaseSync as Database } from 'node:sqlite';
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  try {
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8 && version !== 9 && version !== 10 && version !== 11 && version !== 12 && version !== 13 && version !== 14 && version !== 15) throw new Error('Versão de banco incompatível');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON'); // as cascatas do Grindolino dependem das FKs em toda conexão
    if (version < 15) {
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
        if (version < 10) db.exec('ALTER TABLE workspace_settings ADD COLUMN tray_on_close INTEGER NOT NULL DEFAULT 1; ALTER TABLE workspace_settings ADD COLUMN tray_on_minimize INTEGER NOT NULL DEFAULT 1; ALTER TABLE workspace_settings ADD COLUMN tray_hint_shown INTEGER NOT NULL DEFAULT 0');
        // v11: acesso remoto pelo celular (desligado por padrão), aparelhos pareados (só o hash do token) e auditoria; só colunas/tabelas novas
        if (version < 11) db.exec("ALTER TABLE workspace_settings ADD COLUMN remote_enabled INTEGER NOT NULL DEFAULT 0; ALTER TABLE workspace_settings ADD COLUMN remote_port INTEGER NOT NULL DEFAULT 47321; ALTER TABLE workspace_settings ADD COLUMN remote_pin_hash TEXT; ALTER TABLE workspace_settings ADD COLUMN remote_daily_cap_gold INTEGER NOT NULL DEFAULT 200000; CREATE TABLE remote_spend (day TEXT NOT NULL, profile_id TEXT NOT NULL, gold INTEGER NOT NULL, PRIMARY KEY (day, profile_id)); CREATE TABLE remote_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen TEXT, can_act INTEGER NOT NULL DEFAULT 0); CREATE TABLE remote_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, device_id TEXT, action TEXT NOT NULL, detail TEXT); ");
        // v12: validade/rotação do token (hash anterior vale 5 min), pino da rede, ações remotas desligadas e contadores persistentes do PIN
        if (version < 12) db.exec("ALTER TABLE remote_devices ADD COLUMN prev_token_hash TEXT; ALTER TABLE remote_devices ADD COLUMN prev_valid_until INTEGER NOT NULL DEFAULT 0; ALTER TABLE remote_devices ADD COLUMN rotated_at INTEGER NOT NULL DEFAULT 0; ALTER TABLE workspace_settings ADD COLUMN remote_net_pin TEXT; ALTER TABLE workspace_settings ADD COLUMN remote_net_label TEXT; ALTER TABLE workspace_settings ADD COLUMN remote_actions_disabled INTEGER NOT NULL DEFAULT 0; CREATE TABLE remote_pin_state (key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, day TEXT);");
        // v13 (R3): Web Push (assinaturas ligadas ao aparelho, apagadas em cascata ao revogar/expirar), preferências de alerta por aparelho e histórico de alertas (7 dias, ≤1000)
        if (version < 13) db.exec("CREATE TABLE remote_push (id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES remote_devices(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL, last_ok TEXT, fail_count INTEGER NOT NULL DEFAULT 0); CREATE INDEX remote_push_device ON remote_push (device_id); CREATE TABLE remote_alert_prefs (device_id TEXT PRIMARY KEY REFERENCES remote_devices(id) ON DELETE CASCADE, json TEXT NOT NULL); CREATE TABLE remote_alerts (id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, profile_id TEXT NOT NULL, label TEXT NOT NULL, text TEXT NOT NULL); CREATE INDEX remote_alerts_at ON remote_alerts (at);");
        // v14 (R4): confirmações de compra emitidas pelo servidor (uso único, 60 s), histórico de compras do celular (NUNCA podado) e fuso do teto diário
        if (!db.prepare("SELECT 1 FROM pragma_table_info('remote_spend') WHERE name='tz'").get()) db.exec('ALTER TABLE remote_spend ADD COLUMN tz TEXT'); // reentrante: um banco reaberto no meio da migração não falha
        db.exec("CREATE TABLE IF NOT EXISTS remote_confirms (id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES remote_devices(id) ON DELETE CASCADE, plan_hash TEXT NOT NULL, plan_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, idem_key TEXT, result_json TEXT); CREATE INDEX IF NOT EXISTS remote_confirms_device ON remote_confirms (device_id, idem_key); CREATE TABLE IF NOT EXISTS remote_purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, device_id TEXT, device_name TEXT, profile_id TEXT NOT NULL, confirm_id TEXT, plan_hash TEXT, item TEXT NOT NULL, qty INTEGER NOT NULL, unit_price INTEGER NOT NULL, total INTEGER NOT NULL, result TEXT NOT NULL); CREATE INDEX IF NOT EXISTS remote_purchases_at ON remote_purchases (at); ");
        // v15 (R5): permissão SEPARADA de controlar a tela (Controlar = controle total da conta; não é o 'pode agir' da Loja). Não destrutiva, padrão 0; reentrante
        if (!db.prepare("SELECT 1 FROM pragma_table_info('remote_devices') WHERE name='can_control'").get()) db.exec('ALTER TABLE remote_devices ADD COLUMN can_control INTEGER NOT NULL DEFAULT 0');
        db.exec('PRAGMA user_version=15; COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    return db;
  } catch (error) { db.close(); throw error; }
}
