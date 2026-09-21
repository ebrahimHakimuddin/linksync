export class InvalidSharedUrl extends Error {}

export function validateSharedUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 16_384) {
    throw new InvalidSharedUrl("URL must be a non-empty string no longer than 16,384 characters");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidSharedUrl("URL is invalid");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidSharedUrl("Only HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password) {
    throw new InvalidSharedUrl("URLs containing embedded credentials are not supported");
  }
  if (!url.hostname) {
    throw new InvalidSharedUrl("URL must include a hostname");
  }

  return raw;
}

