import DOMPurify from "dompurify";

/** Échappe une valeur pour insertion sûre dans du HTML (contexte élément/attribut). */
export function escapeHTML(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/`/g, "&#96;");
}

/**
 * Encode une valeur injectée dans un attribut onclick/inline :
 * encodeURIComponent neutralise tout sauf `'()!*-._~` — le replace du
 * guillemet est obligatoire pour empêcher la sortie de chaîne JS.
 * Le récepteur décode avec decodeURIComponent().
 * Préférer les closures/addEventListener pour tout nouveau code.
 */
export function safeJsArg(str: unknown): string {
  if (str === null || str === undefined) return "";
  return encodeURIComponent(String(str)).replace(/'/g, "%27");
}

/** Autorise uniquement http(s) et les data:image base64 — bloque javascript:, vbscript:, file:. */
export function sanitizeUrl(url: unknown, defaultUrl = ""): string {
  if (!url || typeof url !== "string") return defaultUrl;
  const trimmed = url.trim();
  if (!trimmed) return defaultUrl;
  if (/^(?:javascript|vbscript|file):/i.test(trimmed)) return defaultUrl;
  if (/^data:/i.test(trimmed) && !/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(trimmed)) {
    return defaultUrl;
  }
  return trimmed;
}

/** Strip de secours si DOMPurify est indisponible. */
function fallbackSanitize(html: unknown): string {
  if (!html) return "";
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .replace(/src\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'src=""');
}

const PURIFY_OPTIONS = {
  ADD_ATTR: ["target", "playsinline", "rel"],
  FORBID_TAGS: ["script", "iframe", "object", "embed"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange", "onsubmit"],
  USE_PROFILES: { html: true, svg: true }
} as const;

/** Sanitization HTML robuste via DOMPurify (npm, version épinglée). */
export function sanitizeHTML(dirty: unknown): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(String(dirty), PURIFY_OPTIONS);
}

/** innerHTML assaini. */
export function setSafeInnerHTML(element: HTMLElement | null, htmlContent: string): void {
  if (!element) return;
  element.innerHTML = sanitizeHTML(htmlContent) || fallbackSanitize(htmlContent);
}
