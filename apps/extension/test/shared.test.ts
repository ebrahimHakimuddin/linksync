import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeServerUrl, originPermission, websocketUrl } from "../src/shared.js";

describe("extension server URL handling", () => {
  it("normalizes trusted origins", () => {
    assert.equal(normalizeServerUrl("https://links.example.com/path"), "https://links.example.com");
    assert.equal(normalizeServerUrl("http://localhost:8787"), "http://localhost:8787");
  });

  it("rejects insecure remote origins and credentials", () => {
    assert.throws(() => normalizeServerUrl("http://192.168.1.3:8787"), /HTTPS/);
    assert.throws(() => normalizeServerUrl("https://user:secret@example.com"), /credentials/);
  });

  it("derives minimum origin and websocket endpoints", () => {
    assert.equal(originPermission("https://links.example.com"), "https://links.example.com/*");
    assert.equal(websocketUrl("https://links.example.com"), "wss://links.example.com/api/v1/live");
  });
});
