export interface SavedArticle {
  id: string;
  url: string;
  title: string;
  list: string;
  snippet: string;
  progress: number;
  savedAt: number;
  readAt?: number;
}

export interface Library {
  lists: string[];
  articles: SavedArticle[];
}

// Library lives in chrome.storage.sync so it follows the user's Chrome profile across
// computers. One key per article keeps each item under the 8 KB per-item quota and lets
// edits from two machines merge instead of overwriting each other.
// ponytail: sync quota is 100 KB (~250 articles); move to the CrossLinks server if people outgrow it.
export const LISTS_KEY = "lists";
export const ARTICLE_PREFIX = "a:";
export const LEGACY_LIBRARY_KEY = "library";
export const DEFAULT_LIST = "Reading list";

export function stripTextDirective(url: string): string {
  const hash = url.indexOf("#");
  if (hash < 0) return url;
  const directive = url.indexOf(":~:", hash);
  if (directive < 0) return url;
  return url.slice(0, directive === hash + 1 ? hash : directive);
}

// Chrome's native text fragments scroll to (and briefly highlight) the saved passage.
export function restoreUrl(article: Pick<SavedArticle, "url" | "snippet">): string {
  if (!article.snippet) return article.url;
  const text = encodeURIComponent(article.snippet).replace(/-/g, "%2D");
  return `${article.url}${article.url.includes("#") ? "" : "#"}:~:text=${text}`;
}

export function snippetFrom(text: string): string {
  return text.trim().split(/\s+/).slice(0, 8).join(" ");
}

export function toLibrary(stored: Record<string, unknown>): Library {
  const articles = Object.entries(stored)
    .filter(([key]) => key.startsWith(ARTICLE_PREFIX))
    .map(([, value]) => value as SavedArticle)
    .sort((a, b) => b.savedAt - a.savedAt);
  // Lists referenced by articles are always shown, even if another device's list edit won.
  const lists = [...new Set([...((stored[LISTS_KEY] as string[] | undefined) ?? [DEFAULT_LIST]), ...articles.map((a) => a.list)])];
  return { lists, articles };
}

async function write(items: Record<string, unknown>): Promise<void> {
  try {
    await chrome.storage.sync.set(items);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new Error(/QUOTA/i.test(message) ? "Sync storage is full. Remove some saved articles and try again." : message || "Could not save.");
  }
}

async function migrateLocalLibrary(): Promise<void> {
  const local = await chrome.storage.local.get(LEGACY_LIBRARY_KEY);
  const legacy = local[LEGACY_LIBRARY_KEY] as Library | undefined;
  if (!legacy) return;
  const current = toLibrary(await chrome.storage.sync.get(null));
  await write({
    [LISTS_KEY]: [...new Set([...current.lists, ...legacy.lists])],
    ...Object.fromEntries(legacy.articles.map((article) => [ARTICLE_PREFIX + article.id, article]))
  });
  await chrome.storage.local.remove(LEGACY_LIBRARY_KEY);
}

export async function getLibrary(): Promise<Library> {
  await migrateLocalLibrary();
  return toLibrary(await chrome.storage.sync.get(null));
}

export async function updateArticle(id: string, patch: Partial<SavedArticle>): Promise<void> {
  const key = ARTICLE_PREFIX + id;
  const stored = await chrome.storage.sync.get(key);
  if (stored[key]) await write({ [key]: { ...(stored[key] as SavedArticle), ...patch } });
}

export async function removeArticle(id: string): Promise<void> {
  await chrome.storage.sync.remove(ARTICLE_PREFIX + id);
}

export async function addList(name: string): Promise<void> {
  const { lists } = await getLibrary();
  if (!lists.includes(name)) await write({ [LISTS_KEY]: [...lists, name] });
}

export async function renameList(from: string, to: string): Promise<void> {
  const library = await getLibrary();
  await write({
    [LISTS_KEY]: [...new Set(library.lists.map((list) => list === from ? to : list))],
    ...Object.fromEntries(library.articles.filter((a) => a.list === from).map((a) => [ARTICLE_PREFIX + a.id, { ...a, list: to }]))
  });
}

export async function deleteList(name: string): Promise<void> {
  const library = await getLibrary();
  await chrome.storage.sync.remove(library.articles.filter((a) => a.list === name).map((a) => ARTICLE_PREFIX + a.id));
  await write({ [LISTS_KEY]: library.lists.filter((list) => list !== name) });
}

// Runs inside the page, so it must stay self-contained.
function capturePosition(): { snippet: string; progress: number } {
  const scroller = document.scrollingElement ?? document.documentElement;
  const range = scroller.scrollHeight - window.innerHeight;
  const progress = range > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / range)) : 0;
  const pinned = (node: Element | null): boolean => {
    for (; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return true;
    }
    return false;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const probe = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const words = node.textContent?.trim().split(/\s+/) ?? [];
    if (words.length < 4 || node.parentElement?.closest("script, style, noscript, textarea")) continue;
    probe.selectNodeContents(node);
    const rect = probe.getBoundingClientRect();
    if (rect.width === 0 || rect.bottom <= 0) continue;
    if (rect.top >= window.innerHeight) break;
    if (pinned(node.parentElement)) continue;
    return { snippet: words.slice(0, 8).join(" "), progress };
  }
  return { snippet: "", progress };
}

// `selection` (from the context menu) pins the position to exactly what the user highlighted.
export async function saveTab(tab: chrome.tabs.Tab | undefined, list: string, selection?: string): Promise<SavedArticle> {
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error("Only web pages can be saved.");
  let position = { snippet: "", progress: 0 };
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePosition });
    if (injection?.result) position = injection.result;
  } catch {
    // Restricted pages (PDF viewer, Web Store) are saved without a position.
  }
  if (selection?.trim()) position.snippet = snippetFrom(selection);
  const url = stripTextDirective(tab.url);
  const library = await getLibrary();
  const article: SavedArticle = {
    id: library.articles.find((saved) => saved.url === url)?.id ?? crypto.randomUUID(),
    url,
    title: (tab.title || url).slice(0, 300),
    list,
    ...position,
    savedAt: Date.now()
  };
  await write({
    [ARTICLE_PREFIX + article.id]: article,
    ...(library.lists.includes(list) ? {} : { [LISTS_KEY]: [...library.lists, list] })
  });
  return article;
}
