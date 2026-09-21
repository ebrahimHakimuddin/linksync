import { SETTINGS_KEY, getSettings, normalizeServerUrl, originPermission } from "./shared.js";

const form = document.querySelector<HTMLFormElement>("#pair-form")!;
const serverInput = document.querySelector<HTMLInputElement>("#server-url")!;
const codeInput = document.querySelector<HTMLInputElement>("#pairing-code")!;
const nameInput = document.querySelector<HTMLInputElement>("#device-name")!;
const autoOpenInput = document.querySelector<HTMLInputElement>("#auto-open")!;
const pairedSection = document.querySelector<HTMLElement>("#paired")!;
const pairedCopy = document.querySelector<HTMLElement>("#paired-copy")!;
const pairedAutoOpen = document.querySelector<HTMLInputElement>("#paired-auto-open")!;
const unpair = document.querySelector<HTMLButtonElement>("#unpair")!;
const status = document.querySelector<HTMLElement>("#status")!;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function render(): Promise<void> {
  const settings = await getSettings();
  form.hidden = Boolean(settings);
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
    await chrome.storage.local.clear();
    if (settings) await chrome.permissions.remove({ origins: [originPermission(settings.serverUrl)] });
    setStatus("Local credentials removed. Revoke this browser in the server admin page as well.");
    await render();
  })();
});

void render();
