import { apiFetch, SETTINGS_KEY, getSettings, normalizeServerUrl, originPermission } from "./shared.js";
import { LEGACY_LIBRARY_KEY, getLibrary } from "./reading.js";

const form = document.querySelector<HTMLFormElement>("#pair-form")!;
const serverInput = document.querySelector<HTMLInputElement>("#server-url")!;
const codeInput = document.querySelector<HTMLInputElement>("#pairing-code")!;
const nameInput = document.querySelector<HTMLInputElement>("#device-name")!;
const autoOpenInput = document.querySelector<HTMLInputElement>("#auto-open")!;
const pairPanel = document.querySelector<HTMLElement>("#pair-panel")!;
const pairedSection = document.querySelector<HTMLElement>("#paired")!;
const pairedCopy = document.querySelector<HTMLElement>("#paired-copy")!;
const pairedAutoOpen = document.querySelector<HTMLInputElement>("#paired-auto-open")!;
const unpair = document.querySelector<HTMLButtonElement>("#unpair")!;
const status = document.querySelector<HTMLElement>("#status")!;
const versionsCopy = document.querySelector<HTMLElement>("#versions-copy")!;
const checkVersions = document.querySelector<HTMLButtonElement>("#check-versions")!;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function render(): Promise<void> {
  const settings = await getSettings();
  pairPanel.hidden = Boolean(settings);
  pairedSection.hidden = !settings;
  if (settings) {
    pairedCopy.textContent = `${settings.deviceName} is connected to ${settings.serverUrl}.`;
    pairedAutoOpen.checked = settings.autoOpen;
  } else {
    nameInput.value ||= `${navigator.platform || "Chrome"} browser`;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    button.disabled = true;
    try {
      const serverUrl = normalizeServerUrl(serverInput.value);
      const permission = originPermission(serverUrl);
      const granted = await chrome.permissions.request({ origins: [permission] });
      if (!granted) throw new Error("Server access permission was not granted.");
      const response = await fetch(new URL("/api/v1/pair", serverUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: codeInput.value.trim().toUpperCase(),
          name: nameInput.value.trim(),
          deviceKind: "chrome",
          autoOpen: autoOpenInput.checked
        })
      });
      const result = await response.json() as { deviceId?: string; token?: string; error?: string };
      if (!response.ok || !result.deviceId || !result.token) throw new Error(result.error ?? `Pairing failed (${response.status})`);
      await chrome.storage.local.set({
        [SETTINGS_KEY]: {
          serverUrl,
          token: result.token,
          deviceId: result.deviceId,
          deviceName: nameInput.value.trim(),
          autoOpen: autoOpenInput.checked,
          paused: false
        }
      });
      setStatus("Browser paired successfully.");
      await render();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pairing failed.", true);
    } finally {
      button.disabled = false;
    }
  })();
});

pairedAutoOpen.addEventListener("change", () => {
  void (async () => {
    const settings = await getSettings();
    if (!settings) return;
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, autoOpen: pairedAutoOpen.checked } });
    setStatus("Preference saved.");
  })();
});

unpair.addEventListener("click", () => {
  void (async () => {
    const settings = await getSettings();
    // Keep a not-yet-migrated reading library; only drop pairing state.
    await chrome.storage.local.remove(Object.keys(await chrome.storage.local.get(null)).filter((key) => key !== LEGACY_LIBRARY_KEY));
    if (settings) await chrome.permissions.remove({ origins: [originPermission(settings.serverUrl)] });
    setStatus("Local credentials removed. Revoke this browser in the server admin page as well.");
    await render();
  })();
});

checkVersions.addEventListener("click", () => {
  void (async () => {
    checkVersions.disabled = true;
    versionsCopy.textContent = "Checking…";
    try {
      const response = await apiFetch("/api/v1/version");
      if (!response.ok) throw new Error(`Version check failed (${response.status})`);
      const versions = await response.json() as { server: string; android: string; extension: string };
      const extension = chrome.runtime.getManifest().version;
      const health = extension === versions.extension && versions.extension === versions.android ? "All components match" : "A component update may be available";
      versionsCopy.textContent = `${health} · extension ${extension} · server ${versions.server} · Android ${versions.android}`;
    } catch (error) {
      versionsCopy.textContent = error instanceof Error ? error.message : "Version check failed.";
    } finally {
      checkVersions.disabled = false;
    }
  })();
});

async function renderLibrary(): Promise<void> {
  const { articles } = await getLibrary();
  const used = await chrome.storage.sync.getBytesInUse(null);
  const share = used / chrome.storage.sync.QUOTA_BYTES;
  document.querySelector("#library-count")!.textContent = `${articles.length} saved article${articles.length === 1 ? "" : "s"}`;
  document.querySelector("#library-usage")!.textContent = `${Math.round(share * 100)}% of Chrome sync storage used`;
  document.querySelector<HTMLElement>("#usage-bar")!.style.width = `${Math.max(2, Math.round(share * 100))}%`;
  const [command] = (await chrome.commands.getAll()).filter((c) => c.name === "save-position");
  document.querySelector("#shortcut")!.textContent = command?.shortcut || "Not set";
}

document.querySelector("#open-library")!.addEventListener("click", () => void chrome.tabs.create({ url: "library.html" }));
document.querySelector("#shortcuts")!.addEventListener("click", () => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync") void renderLibrary();
});
void render();
void renderLibrary();
