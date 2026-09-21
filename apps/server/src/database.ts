import Database from "better-sqlite3";

export type DeviceKind = "android" | "chrome";
export type DeliveryStatus = "queued" | "delivered" | "expired" | "failed";

export interface DeviceRow {
  id: string;
  name: string;
  kind: DeviceKind;
  auto_open: number;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

export interface DeliveryRow {
  id: string;
  url: string;
  source_device_id: string;
  target_device_id: string;
  status: DeliveryStatus;
  created_at: number;
  expires_at: number;
  delivered_at: number | null;
  failure_reason: string | null;
}

export class LinkSyncDatabase {
  readonly raw: Database.Database;

  constructor(path: string) {
    this.raw = new Database(path);
    this.raw.pragma("journal_mode = WAL");
    this.raw.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS owner (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pairing_grants (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        device_kind TEXT NOT NULL CHECK (device_kind IN ('android', 'chrome')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('android', 'chrome')),
        token_hash TEXT NOT NULL UNIQUE,
        auto_open INTEGER NOT NULL DEFAULT 0 CHECK (auto_open IN (0, 1)),
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS devices_token_hash_idx ON devices(token_hash);
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        url TEXT NOT NULL,
        source_device_id TEXT NOT NULL REFERENCES devices(id),
        target_device_id TEXT NOT NULL REFERENCES devices(id),
        status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'expired', 'failed')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        delivered_at INTEGER,
        failure_reason TEXT,
        UNIQUE(source_device_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS deliveries_target_status_idx
        ON deliveries(target_device_id, status, created_at);
    `);
  }

  close(): void {
    this.raw.close();
  }
}

