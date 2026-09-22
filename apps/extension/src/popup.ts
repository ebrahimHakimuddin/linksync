import { ACTIVITY_KEY, CONNECTION_KEY, SETTINGS_KEY, type ActivityItem, type ConnectionStatus, displayHost, getSettings } from "./shared.js";

const connection = document.querySelector<HTMLElement>("#connection")!;
const paused = document.querySelector<HTMLInputElement>("#paused")!;
const activityList = document.querySelector<HTMLOListElement>("#activity")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settings")!;
const syncButton = document.querySelector<HTMLButtonElement>("#sync")!;

async function render(): Promise<void> {
  const settings = await getSettings();
  const storedConnection = await chrome.storage.local.get(CONNECTION_KEY);
  const connectionStatus = storedConnection[CONNECTION_KEY] as ConnectionStatus | undefined;
  if (!settings) connection.textContent = "Not paired";
  else if (connectionStatus?.state === "online") connection.textContent = `Connected to ${displayHost(settings.serverUrl)}`;
  else if (connectionStatus?.state === "connecting") connection.textContent = `Connecting to ${displayHost(settings.serverUrl)}…`;
  else connection.textContent = connectionStatus?.message || `Offline · ${displayHost(settings.serverUrl)}`;
  paused.checked = settings?.paused ?? false;
  paused.disabled = !settings;
  const stored = await chrome.storage.local.get(ACTIVITY_KEY);
  const activity = (stored[ACTIVITY_KEY] as ActivityItem[] | undefined) ?? [];
  activityList.replaceChildren();
  if (activity.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "No links received yet";
    activityList.append(item);
  } else {
    for (const event of activity.slice(0, 8)) {
      const item = document.createElement("li");
      item.title = event.url;
      item.textContent = `${event.outcome === "opened" ? "Opened" : event.outcome === "notified" ? "Received" : "Failed"} · ${displayHost(event.url)}`;
      activityList.append(item);
    }
  }
}

paused.addEventListener("change", () => {
  void (async () => {
    const settings = await getSettings();
    if (!settings) return;
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, paused: paused.checked } });
    await render();
  })();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[SETTINGS_KEY] || changes[CONNECTION_KEY])) void render();
});
settingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
syncButton.addEventListener("click", () => {
  void (async () => {
    syncButton.disabled = true;
    syncButton.textContent = "Checking…";
    const result = await chrome.runtime.sendMessage({ type: "sync-now" }) as { ok?: boolean; message?: string } | undefined;
    syncButton.disabled = false;
    syncButton.textContent = result?.ok === false ? "Retry check" : "Check for links";
    await render();
  })();
});
void chrome.runtime.sendMessage({ type: "sync-now" }).catch(() => undefined);
void render();
