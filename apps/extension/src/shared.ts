export interface ExtensionSettings {
  serverUrl: string;
  token: string;
  deviceId: string;
  deviceName: string;
  autoOpen: boolean;
  paused: boolean;
}

export interface Delivery {
  id: string;
  url: string;
  status: "queued";
  created_at: number;
  expires_at: number;
}

export interface ActivityItem {
  deliveryId: string;
  url: string;
  outcome: "opened" | "notified" | "failed";
  at: number;
}

export interface DeliveryState {
  phase: "opening" | "handled";
  url: string;
  at: number;
}

export const SETTINGS_KEY = "settings";
export const ACTIVITY_KEY = "activity";
export const DELIVERY_STATES_KEY = "deliveryStates";
export const CONNECTION_KEY = "connection";

export type ConnectionStatus = {
  state: "connecting" | "online" | "offline";
  message?: string;
  at: number;
};

export function normalizeServerUrl(raw: string): string {
  const url = new URL(raw.trim());
  const loopback = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !loopback) throw new Error("Use HTTPS. HTTP is allowed only for local development.");
  if (url.username || url.password || url.search || url.hash) throw new Error("Enter the server origin without credentials, a query, or a fragment.");
  return url.origin;
}

export function originPermission(serverUrl: string): string {
  return `${new URL(serverUrl).origin}/*`;
}

export function websocketUrl(serverUrl: string): string {
  const url = new URL("/api/v1/live", serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function getSettings(): Promise<ExtensionSettings | undefined> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return result[SETTINGS_KEY] as ExtensionSettings | undefined;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = await getSettings();
  if (!settings) throw new Error("LinkSync is not paired");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${settings.token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(new URL(path, settings.serverUrl), { ...init, headers });
}

export function displayHost(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}
