import { parse as parseHtml } from "node-html-parser";

const REMOVE_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "iframe",
  "svg",
]);

/**
 * Extract normalized article text from an official HTML page.
 * Strips nav/footer/scripts and collapses whitespace for stable hashing.
 */
export function extractOfficialContentText(html: string): string {
  const root = parseHtml(html, {
    blockTextElements: {
      script: true,
      style: true,
      noscript: true,
    },
  });

  for (const tag of REMOVE_TAGS) {
    for (const el of root.querySelectorAll(tag)) {
      el.remove();
    }
  }

  const article =
    root.querySelector("article") ??
    root.querySelector("#article") ??
    root.querySelector(".article") ??
    root.querySelector("#content") ??
    root.querySelector("main") ??
    root.querySelector("#main") ??
    root.querySelector(".col-md-8") ??
    root.querySelector("body");

  const text = (article?.text ?? root.text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text;
}
