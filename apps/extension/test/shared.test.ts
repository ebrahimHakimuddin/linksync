import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeServerUrl, originPermission, websocketUrl } from "../src/shared.js";
import { restoreUrl, snippetFrom, stripTextDirective, toLibrary } from "../src/reading.js";

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

describe("reading positions", () => {
  it("builds text fragment URLs that survive special characters", () => {
    assert.equal(restoreUrl({ url: "https://a.test/post", snippet: "well-known, a & b" }),
      "https://a.test/post#:~:text=well%2Dknown%2C%20a%20%26%20b");
    assert.equal(restoreUrl({ url: "https://a.test/post#intro", snippet: "hello" }), "https://a.test/post#intro:~:text=hello");
    assert.equal(restoreUrl({ url: "https://a.test/post", snippet: "" }), "https://a.test/post");
  });

  it("strips a previous position before saving again", () => {
    assert.equal(stripTextDirective("https://a.test/post#:~:text=hello"), "https://a.test/post");
    assert.equal(stripTextDirective("https://a.test/post#intro:~:text=hello"), "https://a.test/post#intro");
    assert.equal(stripTextDirective("https://a.test/post?q=:~:#x"), "https://a.test/post?q=:~:#x");
  });

  it("builds the library from per-article sync keys", () => {
    const base = { url: "https://a.test", title: "t", snippet: "", progress: 0 };
    const library = toLibrary({
      lists: ["Reading list"],
      "a:1": { ...base, id: "1", list: "Reading list", savedAt: 1 },
      "a:2": { ...base, id: "2", list: "Work", savedAt: 2 },
      settings: { unrelated: true }
    });
    assert.deepEqual(library.lists, ["Reading list", "Work"]);
    assert.deepEqual(library.articles.map((a) => a.id), ["2", "1"]);
    assert.deepEqual(toLibrary({}).lists, ["Reading list"]);
  });

  it("turns a highlighted selection into a short anchor", () => {
    assert.equal(snippetFrom("  one two\nthree four five six seven eight nine ten "), "one two three four five six seven eight");
  });
});
