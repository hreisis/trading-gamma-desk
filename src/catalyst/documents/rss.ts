/**
 * Minimal RSS 2.0 / Atom parser for official government feeds.
 * Handles namespaces, CDATA, and common HTML entities — no external XML deps.
 */

export interface ParsedFeedItem {
  readonly title: string;
  readonly link: string;
  readonly publishedAtRaw: string;
  readonly description?: string;
  readonly guid?: string;
  readonly itemName?: string;
  readonly category?: string;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
      const code = Number.parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&amp;/g, "&")
    .trim();
}

function stripTags(html: string): string {
  return decodeXmlEntities(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localName(tag: string): string {
  const bare = tag.replace(/^<\/?/, "").replace(/\/?>$/, "").split(/\s/, 1)[0] ?? "";
  const parts = bare.split(":");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function extractTag(block: string, names: readonly string[]): string | undefined {
  const want = new Set(names.map((n) => n.toLowerCase()));
  const re =
    /<([A-Za-z0-9:_-]+)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>|<([A-Za-z0-9:_-]+)(\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const open = m[1] ?? m[4];
    if (!open) continue;
    if (!want.has(localName(open))) continue;
    if (m[4]) return "";
    return decodeXmlEntities(m[3] ?? "");
  }
  return undefined;
}

function extractAttr(tagOpen: string, attr: string): string | undefined {
  const re = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i");
  const m = tagOpen.match(re);
  return m?.[1] !== undefined ? decodeXmlEntities(m[1]) : undefined;
}

function parseRssItems(body: string): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];
  const itemRe = /<item\b([^>]*)>([\s\S]*?)<\/item\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(body)) !== null) {
    const attrs = m[1] ?? "";
    const block = m[2] ?? "";
    const title = extractTag(block, ["title"]);
    const link =
      extractTag(block, ["link"]) ??
      extractTag(block, ["guid"]);
    const pub =
      extractTag(block, ["pubDate", "pubdate"]) ??
      extractTag(block, ["dc:date", "date"]);
    const description = extractTag(block, ["description", "summary", "content"]);
    const guid = extractTag(block, ["guid"]);
    const category = extractTag(block, ["category"]);
    const itemName = extractAttr(`<item ${attrs}>`, "name");
    if (!title || !link || !pub) continue;
    items.push({
      title: stripTags(title),
      link: stripTags(link),
      publishedAtRaw: stripTags(pub),
      description: description ? stripTags(description) : undefined,
      guid: guid ? stripTags(guid) : undefined,
      itemName,
      category: category ? stripTags(category) : undefined,
    });
  }
  return items;
}

function parseAtomEntries(body: string): ParsedFeedItem[] {
  const items: ParsedFeedItem[] = [];
  const entryRe = /<entry\b([^>]*)>([\s\S]*?)<\/entry\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    const block = m[2] ?? "";
    const title = extractTag(block, ["title"]);
    const linkHrefMatch = block.match(
      /<link\b[^>]*\bhref\s*=\s*"([^"]+)"[^>]*>/i,
    );
    const link =
      linkHrefMatch?.[1] ??
      extractTag(block, ["link"]) ??
      extractTag(block, ["id"]);
    const pub =
      extractTag(block, ["published", "updated"]) ??
      extractTag(block, ["dc:date"]);
    const description =
      extractTag(block, ["summary", "content", "description"]);
    const guid = extractTag(block, ["id"]);
    if (!title || !link || !pub) continue;
    items.push({
      title: stripTags(title),
      link: stripTags(link),
      publishedAtRaw: stripTags(pub),
      description: description ? stripTags(description) : undefined,
      guid: guid ? stripTags(guid) : undefined,
    });
  }
  return items;
}

/**
 * Parse RSS 2.0 or Atom. Throws on empty / non-XML-like bodies.
 */
export function parseRssOrAtom(body: string): {
  readonly items: ParsedFeedItem[];
  readonly format: "rss" | "atom";
} {
  const trimmed = body.trim();
  if (!trimmed.startsWith("<") && !trimmed.includes("<rss") && !trimmed.includes("<feed")) {
    throw new Error("feed body is not XML (missing root element)");
  }
  if (/<rss\b/i.test(trimmed) || /<channel\b/i.test(trimmed)) {
    const items = parseRssItems(trimmed);
    return { items, format: "rss" };
  }
  if (/<feed\b/i.test(trimmed) || /<entry\b/i.test(trimmed)) {
    const items = parseAtomEntries(trimmed);
    return { items, format: "atom" };
  }
  // Fallback: try RSS item extraction anyway (namespaced roots).
  const rssItems = parseRssItems(trimmed);
  if (rssItems.length > 0) return { items: rssItems, format: "rss" };
  const atomItems = parseAtomEntries(trimmed);
  if (atomItems.length > 0) return { items: atomItems, format: "atom" };
  throw new Error("feed body has no RSS <item> or Atom <entry> elements");
}

export function decodeXmlText(raw: string): string {
  return decodeXmlEntities(raw);
}
