import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { hash as hashPassword, verify as verifyPassword } from "@node-rs/argon2";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import QRCode from "qrcode";
import type { WebSocket } from "ws";
import type { Config } from "./config.js";
import { LinkSyncDatabase, type DeliveryRow, type DeviceKind, type DeviceRow } from "./database.js";
import { bearerToken, hashToken, pairingCode, randomToken, safeHashEquals } from "./security.js";
import { InvalidSharedUrl, validateSharedUrl } from "./url.js";

declare module "fastify" {
  interface FastifyRequest {
    device?: DeviceRow;
  }
}

interface BuildOptions {
  config: Config;
  database?: LinkSyncDatabase;
  logger?: boolean;
}

interface JsonBody {
  [key: string]: unknown;
}

const SESSION_COOKIE = "linksync_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const RELEASE_VERSIONS = {
  server: "0.2.0",
  android: "0.2.0",
  extension: "0.2.0"
} as const;

function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result.length >= 1 && result.length <= 80 ? result : undefined;
}

function isDeviceKind(value: unknown): value is DeviceKind {
  return value === "android" || value === "chrome";
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const db = options.database ?? new LinkSyncDatabase(options.config.databasePath);
  const sockets = new Map<string, Set<WebSocket>>();

  await app.register(cookie);
  await app.register(websocket);

  const publicDirectory = import.meta.url.includes("/dist/")
    ? new URL("./public/", import.meta.url)
    : new URL("../public/", import.meta.url);
  const [adminHtml, adminCss, adminJs] = await Promise.all([
    readFile(new URL("index.html", publicDirectory), "utf8"),
    readFile(new URL("admin.css", publicDirectory), "utf8"),
    readFile(new URL("admin.js", publicDirectory), "utf8")
  ]);

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (request.url === "/admin" || request.url.startsWith("/assets/")) {
      reply.header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    }
    return payload;
  });

  app.addHook("onClose", async () => {
    for (const clients of sockets.values()) {
      for (const socket of clients) socket.close(1001, "server shutdown");
    }
    db.close();
  });

  const accountExists = (): boolean =>
    Boolean(db.raw.prepare("SELECT 1 FROM owner WHERE id = 1").get());

  if (!accountExists()) {
    const setupToken = options.config.setupToken ?? randomToken();
    db.raw.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('setup_token_hash', ?)")
      .run(hashToken(setupToken));
    app.log.warn({ setupUrl: `${options.config.publicUrl}/setup#token=${setupToken}` }, "owner setup required");
  }

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const origin = request.headers.origin;
    const allowedOrigins = new Set([options.config.publicUrl, options.config.lanUrl].filter(Boolean));
    if (origin && !allowedOrigins.has(origin)) return void reply.code(403).send({ error: "invalid_origin" });
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return void reply.code(401).send({ error: "admin_auth_required" });
    const session = db.raw.prepare(
      "SELECT id FROM admin_sessions WHERE token_hash = ? AND expires_at > ?"
    ).get(hashToken(token), Date.now());
    if (!session) return void reply.code(401).send({ error: "admin_auth_required" });
  };

  const requireDevice = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearerToken(request.headers.authorization);
    if (!token) return void reply.code(401).send({ error: "device_auth_required" });
    const device = db.raw.prepare(
      "SELECT id, name, kind, auto_open, created_at, last_seen_at, revoked_at FROM devices WHERE token_hash = ? AND revoked_at IS NULL"
    ).get(hashToken(token)) as DeviceRow | undefined;
    if (!device) return void reply.code(401).send({ error: "invalid_device_credential" });
    request.device = device;
  };

  const notifyTarget = (deviceId: string, deliveryId: string): void => {
    for (const socket of sockets.get(deviceId) ?? []) {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "delivery_available", deliveryId }));
      }
    }
  };

  const expireDeliveries = (): void => {
    db.raw.prepare("UPDATE deliveries SET status = 'expired' WHERE status = 'queued' AND expires_at <= ?")
      .run(Date.now());
  };

  app.get("/health", async () => ({ status: "ok", setupRequired: !accountExists() }));
  app.get("/api/v1/version", { preHandler: requireDevice }, async () => RELEASE_VERSIONS);
  app.get("/", async (_request, reply) => reply.redirect("/admin"));
  app.get("/setup", async (_request, reply) => reply.redirect("/admin"));
  app.get("/admin", async (_request, reply) => reply.type("text/html; charset=utf-8").send(adminHtml));
  app.get("/assets/admin.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(adminCss));
  app.get("/assets/admin.js", async (_request, reply) => reply.type("text/javascript; charset=utf-8").send(adminJs));

  app.post<{ Body: JsonBody }>("/api/v1/setup", async (request, reply) => {
    if (accountExists()) return reply.code(409).send({ error: "setup_already_completed" });
    const token = typeof request.body?.token === "string" ? request.body.token : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const row = db.raw.prepare("SELECT value FROM metadata WHERE key = 'setup_token_hash'").get() as { value: string } | undefined;
    if (!row || !safeHashEquals(token, row.value)) return reply.code(403).send({ error: "invalid_setup_token" });
    if (password.length < 12 || password.length > 256) {
      return reply.code(400).send({ error: "password_must_be_12_to_256_characters" });
    }
    const passwordHash = await hashPassword(password);
    db.raw.transaction(() => {
      db.raw.prepare("INSERT INTO owner(id, password_hash, created_at) VALUES (1, ?, ?)").run(passwordHash, Date.now());
      db.raw.prepare("DELETE FROM metadata WHERE key = 'setup_token_hash'").run();
    })();
    return reply.code(201).send({ status: "configured" });
  });

  app.post<{ Body: JsonBody }>("/api/v1/admin/login", async (request, reply) => {
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const owner = db.raw.prepare("SELECT password_hash FROM owner WHERE id = 1").get() as { password_hash: string } | undefined;
    if (!owner || !(await verifyPassword(owner.password_hash, password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const sessionToken = randomToken();
    db.raw.prepare("INSERT INTO admin_sessions(id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(randomUUID(), hashToken(sessionToken), Date.now(), Date.now() + SESSION_TTL_MS);
    reply.setCookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: options.config.secureCookies,
      path: "/",
      maxAge: SESSION_TTL_MS / 1_000
    });
    return { status: "authenticated" };
  });

  app.post("/api/v1/admin/logout", { preHandler: requireAdmin }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) db.raw.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { status: "signed_out" };
  });

  app.post<{ Body: JsonBody }>("/api/v1/admin/pairings", { preHandler: requireAdmin }, async (request, reply) => {
    const kind = request.body?.deviceKind;
    if (!isDeviceKind(kind)) return reply.code(400).send({ error: "invalid_device_kind" });
    const code = pairingCode();
    const grantId = randomUUID();
    const expiresAt = Date.now() + options.config.pairingTtlMs;
    db.raw.prepare(
      "INSERT INTO pairing_grants(id, code_hash, device_kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).run(grantId, hashToken(code), kind, Date.now(), expiresAt);
    const endpoints = [options.config.lanUrl, options.config.publicUrl].filter((value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index
    );
    const payload = { version: 1, code, deviceKind: kind, endpoints, expiresAt };
    return reply.code(201).send({ ...payload, qrDataUrl: await QRCode.toDataURL(JSON.stringify(payload)) });
  });

  app.get("/api/v1/admin/devices", { preHandler: requireAdmin }, async () => {
    return db.raw.prepare(
      "SELECT id, name, kind, auto_open, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at DESC"
    ).all();
  });

  app.delete<{ Params: { id: string } }>("/api/v1/admin/devices/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const result = db.raw.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(Date.now(), request.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: "device_not_found" });
    for (const socket of sockets.get(request.params.id) ?? []) socket.close(4003, "device revoked");
    sockets.delete(request.params.id);
    return reply.code(204).send();
  });

  app.get("/api/v1/admin/deliveries", { preHandler: requireAdmin }, async () => {
    expireDeliveries();
    db.raw.prepare("DELETE FROM deliveries WHERE status != 'queued' AND created_at < ?")
      .run(Date.now() - options.config.historyTtlMs);
    return db.raw.prepare(`
      SELECT d.*, source.name AS source_device_name, target.name AS target_device_name
      FROM deliveries d
      JOIN devices source ON source.id = d.source_device_id
      JOIN devices target ON target.id = d.target_device_id
      ORDER BY d.created_at DESC LIMIT 250
    `).all();
  });

  app.delete("/api/v1/admin/deliveries", { preHandler: requireAdmin }, async (_request, reply) => {
    db.raw.prepare("DELETE FROM deliveries WHERE status != 'queued'").run();
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/api/v1/admin/deliveries/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const result = db.raw.prepare("DELETE FROM deliveries WHERE id = ?").run(request.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: "delivery_not_found" });
    return reply.code(204).send();
  });

  app.post<{ Body: JsonBody }>("/api/v1/pair", async (request, reply) => {
    const code = typeof request.body?.code === "string" ? request.body.code.toUpperCase().trim() : "";
    const name = cleanName(request.body?.name);
    const kind = request.body?.deviceKind;
    if (!code || !name || !isDeviceKind(kind)) return reply.code(400).send({ error: "invalid_pairing_request" });
    const grant = db.raw.prepare(`
      SELECT id, device_kind FROM pairing_grants
      WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
    `).get(hashToken(code), Date.now()) as { id: string; device_kind: DeviceKind } | undefined;
    if (!grant || grant.device_kind !== kind) return reply.code(403).send({ error: "invalid_or_expired_pairing_code" });

    const deviceId = randomUUID();
    const token = randomToken();
    const autoOpen = kind === "chrome" && request.body?.autoOpen === true ? 1 : 0;
    const consumed = db.raw.transaction(() => {
      const result = db.raw.prepare("UPDATE pairing_grants SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
        .run(Date.now(), grant.id);
      if (result.changes !== 1) return false;
      db.raw.prepare(`
        INSERT INTO devices(id, name, kind, token_hash, auto_open, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(deviceId, name, kind, hashToken(token), autoOpen, Date.now());
      return true;
    })();
    if (!consumed) return reply.code(409).send({ error: "pairing_code_already_used" });
    return reply.code(201).send({ deviceId, token, name, deviceKind: kind, autoOpen: Boolean(autoOpen) });
  });

  app.get("/api/v1/devices", { preHandler: requireDevice }, async () => {
    const onlineAfter = Date.now() - 90_000;
    return (db.raw.prepare(`
      SELECT id, name, last_seen_at FROM devices
      WHERE kind = 'chrome' AND revoked_at IS NULL ORDER BY name COLLATE NOCASE
    `).all() as Array<Pick<DeviceRow, "id" | "name" | "last_seen_at">>).map((device) => ({
      id: device.id,
      name: device.name,
      lastSeenAt: device.last_seen_at,
      online: (device.last_seen_at ?? 0) >= onlineAfter
    }));
  });

  app.post<{ Body: JsonBody }>("/api/v1/deliveries", { preHandler: requireDevice }, async (request, reply) => {
    if (request.device!.kind !== "android") return reply.code(403).send({ error: "android_device_required" });
    let url: string;
    try {
      url = validateSharedUrl(request.body?.url);
    } catch (error) {
      if (error instanceof InvalidSharedUrl) return reply.code(400).send({ error: "invalid_url", message: error.message });
      throw error;
    }
    const targetDeviceId = typeof request.body?.targetDeviceId === "string" ? request.body.targetDeviceId : "";
    const idempotencyKey = typeof request.body?.idempotencyKey === "string" ? request.body.idempotencyKey : "";
    if (!idempotencyKey || idempotencyKey.length > 128) return reply.code(400).send({ error: "invalid_idempotency_key" });
    const target = db.raw.prepare(
      "SELECT id FROM devices WHERE id = ? AND kind = 'chrome' AND revoked_at IS NULL"
    ).get(targetDeviceId);
    if (!target) return reply.code(404).send({ error: "target_device_not_found" });

    const existing = db.raw.prepare(
      "SELECT * FROM deliveries WHERE source_device_id = ? AND idempotency_key = ?"
    ).get(request.device!.id, idempotencyKey) as DeliveryRow | undefined;
    if (existing) return reply.code(200).send(existing);

    const delivery: DeliveryRow = {
      id: randomUUID(),
      url,
      source_device_id: request.device!.id,
      target_device_id: targetDeviceId,
      status: "queued",
      created_at: Date.now(),
      expires_at: Date.now() + options.config.deliveryTtlMs,
      delivered_at: null,
      failure_reason: null
    };
    db.raw.prepare(`
      INSERT INTO deliveries(id, idempotency_key, url, source_device_id, target_device_id, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
    `).run(delivery.id, idempotencyKey, delivery.url, delivery.source_device_id, delivery.target_device_id,
      delivery.created_at, delivery.expires_at);
    notifyTarget(targetDeviceId, delivery.id);
    return reply.code(201).send(delivery);
  });

  app.get("/api/v1/deliveries/next", { preHandler: requireDevice }, async (request, reply) => {
    if (request.device!.kind !== "chrome") return reply.code(403).send({ error: "chrome_device_required" });
    expireDeliveries();
    db.raw.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(Date.now(), request.device!.id);
    const delivery = db.raw.prepare(`
      SELECT id, url, status, created_at, expires_at FROM deliveries
      WHERE target_device_id = ? AND status = 'queued' ORDER BY created_at LIMIT 1
    `).get(request.device!.id);
    return delivery ?? null;
  });

  app.post<{ Params: { id: string }; Body: JsonBody }>(
    "/api/v1/deliveries/:id/ack",
    { preHandler: requireDevice },
    async (request, reply) => {
      if (request.device!.kind !== "chrome") return reply.code(403).send({ error: "chrome_device_required" });
      const status = request.body?.status;
      if (status !== "delivered" && status !== "failed") return reply.code(400).send({ error: "invalid_status" });
      const reason = status === "failed" && typeof request.body?.reason === "string"
        ? request.body.reason.slice(0, 500)
        : null;
      const result = db.raw.prepare(`
        UPDATE deliveries SET status = ?, delivered_at = ?, failure_reason = ?
        WHERE id = ? AND target_device_id = ? AND status = 'queued'
      `).run(status, Date.now(), reason, request.params.id, request.device!.id);
      if (result.changes === 0) {
        const existing = db.raw.prepare("SELECT status FROM deliveries WHERE id = ? AND target_device_id = ?")
          .get(request.params.id, request.device!.id) as { status: string } | undefined;
        if (!existing) return reply.code(404).send({ error: "delivery_not_found" });
        if (existing.status !== status) return reply.code(409).send({ error: "delivery_already_finalized", status: existing.status });
      }
      return { status };
    }
  );

  app.get("/api/v1/history", { preHandler: requireDevice }, async (request) => {
    expireDeliveries();
    const cutoff = Date.now() - options.config.historyTtlMs;
    db.raw.prepare("DELETE FROM deliveries WHERE created_at < ? AND status != 'queued'").run(cutoff);
    return db.raw.prepare(`
      SELECT id, url, target_device_id, status, created_at, expires_at, delivered_at, failure_reason
      FROM deliveries WHERE source_device_id = ? ORDER BY created_at DESC LIMIT 100
    `).all(request.device!.id);
  });

  app.get("/api/v1/live", { websocket: true }, (socket) => {
    let authenticatedDeviceId: string | undefined;
    const authTimer = setTimeout(() => socket.close(4001, "authentication timeout"), 5_000);

    socket.on("message", (raw) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        socket.close(4000, "invalid message");
        return;
      }
      if (!authenticatedDeviceId) {
        if (message.type !== "authenticate" || typeof message.token !== "string") {
          socket.close(4001, "authentication required");
          return;
        }
        const device = db.raw.prepare(`
          SELECT id FROM devices WHERE token_hash = ? AND kind = 'chrome' AND revoked_at IS NULL
        `).get(hashToken(message.token)) as { id: string } | undefined;
        if (!device) {
          socket.close(4003, "invalid credential");
          return;
        }
        authenticatedDeviceId = device.id;
        clearTimeout(authTimer);
        const clients = sockets.get(device.id) ?? new Set<WebSocket>();
        clients.add(socket);
        sockets.set(device.id, clients);
        db.raw.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(Date.now(), device.id);
        socket.send(JSON.stringify({ type: "authenticated" }));
        return;
      }
      if (message.type === "heartbeat") {
        db.raw.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(Date.now(), authenticatedDeviceId);
        socket.send(JSON.stringify({ type: "heartbeat_ack", at: Date.now() }));
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (!authenticatedDeviceId) return;
      const clients = sockets.get(authenticatedDeviceId);
      clients?.delete(socket);
      if (clients?.size === 0) sockets.delete(authenticatedDeviceId);
    });
  });

  return app;
}
