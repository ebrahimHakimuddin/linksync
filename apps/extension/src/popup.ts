import { getLibrary, restoreUrl, saveTab } from "./reading.js";
import { ACTIVITY_KEY, CONNECTION_KEY, SETTINGS_KEY, type ActivityItem, type ConnectionStatus, displayHost, getSettings, icon } from "./shared.js";

const connection = document.querySelector<HTMLElement>("#connection")!;
const paused = document.querySelector<HTMLInputElement>("#paused")!;
const activityList = document.querySelector<HTMLOListElement>("#activity")!;
const continueList = document.querySelector<HTMLOListElement>("#continue")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settings")!;
const syncButton = document.querySelector<HTMLButtonElement>("#sync")!;
const saveList = document.querySelector<HTMLSelectElement>("#save-list")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save")!;
const saveStatus = document.querySelector<HTMLElement>("#save-status")!;
const libraryButton = document.querySelector<HTMLButtonElement>("#library")!;

function emptyItem(text: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "empty";
  item.textContent = text;
  return item;
}

async function render(): Promise<void> {
  const settings = await getSettings();
  const storedConnection = await chrome.storage.local.get(CONNECTION_KEY);
  const connectionStatus = storedConnection[CONNECTION_KEY] as ConnectionStatus | undefined;
  connection.dataset.state = settings && !settings.paused ? connectionStatus?.state ?? "offline" : "";
  if (!settings) connection.textContent = "Not paired";
  else if (settings.paused) connection.textContent = "Paused";
  else if (connectionStatus?.state === "online") connection.textContent = "Connected";
  else if (connectionStatus?.state === "connecting") connection.textContent = "Connecting…";
  else connection.textContent = "Offline";
  connection.title = connectionStatus?.message ?? (settings ? displayHost(settings.serverUrl) : "Pair in Settings to receive links");
  paused.checked = settings?.paused ?? false;
  paused.disabled = !settings;
  syncButton.hidden = !settings;
  const stored = await chrome.storage.local.get(ACTIVITY_KEY);
  const activity = (stored[ACTIVITY_KEY] as ActivityItem[] | undefined) ?? [];
  activityList.replaceChildren(...activity.slice(0, 3).map((event) => {
    const item = document.createElement("li");
    item.className = "line";
    item.title = event.url;
    item.textContent = `${event.outcome === "opened" ? "Opened" : event.outcome === "notified" ? "Received" : "Failed"} · ${displayHost(event.url)}`;
    return item;
  }));
  if (activity.length === 0) activityList.append(emptyItem(settings ? "No links received yet" : "Pair your phone in Settings"));
}

async function renderLibrary(): Promise<void> {
  const library = await getLibrary();
  const selected = saveList.value;
  saveList.replaceChildren(...library.lists.map((name) => new Option(name, name, false, name === selected)));
  const unread = library.articles.filter((article) => !article.readAt).slice(0, 3);
  continueList.replaceChildren(...unread.map((article) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = restoreUrl(article);
    link.target = "_blank";
    link.rel = "noreferrer";
    const title = document.createElement("strong");
    title.textContent = article.title;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${displayHost(article.url)} · ${article.snippet ? `${Math.round(article.progress * 100)}%` : article.list}`;
    const bar = document.createElement("div");
    bar.className = "progress";
    const fill = document.createElement("span");
    fill.style.width = `${Math.round(article.progress * 100)}%`;
    bar.append(fill);
    link.append(title, meta, bar);
    item.append(link);
    return item;
  }));
  if (unread.length === 0) continueList.append(emptyItem("You're all caught up"));
}

paused.addEventListener("change", () => {
  void (async () => {
    const settings = await getSettings();
    if (!settings) return;
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, paused: paused.checked } });
  })();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") void renderLibrary();
  else if (area === "local" && (changes[SETTINGS_KEY] || changes[CONNECTION_KEY] || changes[ACTIVITY_KEY])) void render();
});
settingsButton.append(icon("gear"));
settingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
libraryButton.addEventListener("click", () => void chrome.tabs.create({ url: "library.html" }));
syncButton.addEventListener("click", () => {
  void (async () => {
    syncButton.disabled = true;
    syncButton.textContent = "Checking…";
    await chrome.runtime.sendMessage({ type: "sync-now" }).catch(() => undefined);
    syncButton.disabled = false;
    syncButton.textContent = "Check now";
  })();
});
saveButton.addEventListener("click", () => {
  void (async () => {
    saveButton.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const article = await saveTab(tab, saveList.value);
      saveStatus.textContent = article.snippet
        ? `Saved at ${Math.round(article.progress * 100)}% to ${article.list}`
        : `Saved to ${article.list} (position unavailable on this page)`;
    } catch (error) {
      saveStatus.textContent = error instanceof Error ? error.message : "Could not save this page.";
    } finally {
      saveButton.disabled = false;
    }
  })();
});
void chrome.runtime.sendMessage({ type: "sync-now" }).catch(() => undefined);
void render();
void renderLibrary();
