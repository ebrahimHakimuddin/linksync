import {
  ACTIVITY_KEY,
  CONNECTION_KEY,
  DELIVERY_STATES_KEY,
  type ActivityItem,
  type Delivery,
  type DeliveryState,
  apiFetch,
  getSettings,
  websocketUrl
} from "./shared.js";
import type { ConnectionStatus } from "./shared.js";

const POLL_ALARM = "poll-deliveries";
const NOTIFICATION_PREFIX = "linksync:";
let liveSocket: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let draining = false;

async function setConnection(state: ConnectionStatus["state"], message?: string): Promise<void> {
  await chrome.storage.local.set({ [CONNECTION_KEY]: { state, ...(message ? { message } : {}), at: Date.now() } satisfies ConnectionStatus });
}

async function addActivity(item: ActivityItem): Promise<void> {
  const stored = await chrome.storage.local.get(ACTIVITY_KEY);
  const activity = (stored[ACTIVITY_KEY] as ActivityItem[] | undefined) ?? [];
  await chrome.storage.local.set({ [ACTIVITY_KEY]: [item, ...activity].slice(0, 25) });
}

async function deliveryStates(): Promise<Record<string, DeliveryState>> {
  const stored = await chrome.storage.local.get(DELIVERY_STATES_KEY);
  return (stored[DELIVERY_STATES_KEY] as Record<string, DeliveryState> | undefined) ?? {};
}

async function setDeliveryState(id: string, state: DeliveryState): Promise<void> {
  const states = await deliveryStates();
  states[id] = state;
  const entries = Object.entries(states).sort((a, b) => b[1].at - a[1].at).slice(0, 500);
  await chrome.storage.local.set({ [DELIVERY_STATES_KEY]: Object.fromEntries(entries) });
}

async function acknowledge(id: string, status: "delivered" | "failed", reason?: string): Promise<void> {
  const response = await apiFetch(`/api/v1/deliveries/${encodeURIComponent(id)}/ack`, {
    method: "POST",
    body: JSON.stringify({ status, ...(reason ? { reason } : {}) })
  });
  if (!response.ok && response.status !== 409) throw new Error(`Acknowledgement failed (${response.status})`);
}

async function handleDelivery(delivery: Delivery): Promise<void> {
  const settings = await getSettings();
  if (!settings || settings.paused) return;
  const states = await deliveryStates();
  const known = states[delivery.id];
  if (known?.phase === "handled") {
    await acknowledge(delivery.id, "delivered");
    return;
  }
  if (known?.phase === "opening") {
    await acknowledge(delivery.id, "failed", "Browser restarted while tab creation was in progress");
    await setDeliveryState(delivery.id, { phase: "handled", url: delivery.url, at: Date.now() });
    return;
  }

  await setDeliveryState(delivery.id, { phase: "opening", url: delivery.url, at: Date.now() });
  try {
    if (settings.autoOpen) {
      await chrome.tabs.create({ url: delivery.url, active: true });
      await addActivity({ deliveryId: delivery.id, url: delivery.url, outcome: "opened", at: Date.now() });
    } else {
      await chrome.notifications.create(`${NOTIFICATION_PREFIX}${delivery.id}`, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: "Link received",
        message: delivery.url,
        contextMessage: "Click to open in a new tab",
        priority: 1
      });
      await chrome.storage.local.set({ [`pending:${delivery.id}`]: delivery.url });
      await addActivity({ deliveryId: delivery.id, url: delivery.url, outcome: "notified", at: Date.now() });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown browser error";
    await addActivity({ deliveryId: delivery.id, url: delivery.url, outcome: "failed", at: Date.now() });
    await setDeliveryState(delivery.id, { phase: "handled", url: delivery.url, at: Date.now() });
    await acknowledge(delivery.id, "failed", message);
    return;
  }
  // Outside the try: a network error here must not report an opened tab as failed.
  await setDeliveryState(delivery.id, { phase: "handled", url: delivery.url, at: Date.now() });
  await acknowledge(delivery.id, "delivered");
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const settings = await getSettings();
    if (!settings || settings.paused) return;
    for (let count = 0; count < 50; count += 1) {
      const response = await apiFetch("/api/v1/deliveries/next");
      if (!response.ok) throw new Error(`Queue fetch failed (${response.status})`);
      const delivery = await response.json() as Delivery | null;
      if (!delivery) break;
      await handleDelivery(delivery);
    }
  } catch (error) {
    await setConnection("offline", error instanceof Error ? error.message : "Server is unavailable");
  } finally {
    draining = false;
  }
}

function closeLiveSocket(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  reconnectTimer = undefined;
  heartbeatTimer = undefined;
  liveSocket?.close();
  liveSocket = undefined;
}

async function connectLive(): Promise<void> {
  closeLiveSocket();
  const settings = await getSettings();
  if (!settings || settings.paused) return;
  await setConnection("connecting");
  const socket = new WebSocket(websocketUrl(settings.serverUrl));
  liveSocket = socket;
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "authenticate", token: settings.token })));
  socket.addEventListener("message", (event) => {
    let message: { type?: string };
    try { message = JSON.parse(String(event.data)) as { type?: string }; } catch { return; }
    if (message.type === "authenticated") {
      void setConnection("online");
      void drainQueue();
    } else if (message.type === "delivery_available") void drainQueue();
  });
  socket.addEventListener("error", () => void setConnection("offline", "Could not reach the CrossLinks server"));
  socket.addEventListener("close", () => {
    if (liveSocket !== socket) return;
    liveSocket = undefined;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    void setConnection("offline", "Server connection lost — retrying");
    reconnectTimer = setTimeout(() => void connectLive(), 5_000);
  });
  heartbeatTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "heartbeat" }));
  }, 20_000);
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  void connectLive();
});
chrome.runtime.onStartup.addListener(() => void connectLive());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void drainQueue();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) void connectLive();
});
chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message.type !== "sync-now") return;
  void drainQueue().then(() => sendResponse({ ok: true })).catch((error: unknown) => {
    sendResponse({ ok: false, message: error instanceof Error ? error.message : "Could not check for links" });
  });
  return true;
});
chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
  const deliveryId = notificationId.slice(NOTIFICATION_PREFIX.length);
  void (async () => {
    const key = `pending:${deliveryId}`;
    const stored = await chrome.storage.local.get(key);
    const url = stored[key] as string | undefined;
    if (url) await chrome.tabs.create({ url, active: true });
    await chrome.storage.local.remove(key);
    await chrome.notifications.clear(notificationId);
  })();
});

void chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
void connectLive();
