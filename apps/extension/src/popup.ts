import { ACTIVITY_KEY, SETTINGS_KEY, type ActivityItem, displayHost, getSettings } from "./shared.js";

const connection = document.querySelector<HTMLElement>("#connection")!;
const paused = document.querySelector<HTMLInputElement>("#paused")!;
const activityList = document.querySelector<HTMLOListElement>("#activity")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settings")!;

async function render(): Promise<void> {
  const settings = await getSettings();
  connection.textContent = settings ? `Paired with ${displayHost(settings.serverUrl)}` : "Not paired";
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
settingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
void render();
