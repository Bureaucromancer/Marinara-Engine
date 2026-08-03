import { useChatStore } from "../stores/chat.store";

export const CARD_ASSET_INSERT_EVENT = "marinara:insert-card-asset";

export interface CardAssetInsertDetail {
  markdown: string;
  chatId?: string;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(decodeSegment(segment));
}

function encodePath(segments: string[]): string {
  return segments.filter(Boolean).map(encodeSegment).join("/");
}

function activeChatId(): string | null {
  return useChatStore.getState().activeChatId ?? null;
}

export function normalizeCardAssetImageSyntax(text: string): string {
  return text.replace(/\(([^)\n]*)\)\[(card:\/\/[^\]\s]+)\]/g, (_match, alt: string, url: string) => {
    const safeAlt = alt.replace(/[\]\r\n]/g, " ").trim();
    return `![${safeAlt}](${url})`;
  });
}

/**
 * Rewrite portable `card://self/gallery/<file>` references to the speaking
 * character's absolute card URL. Applied to message text BEFORE markdown
 * rendering so the shared renderers keep their current signatures.
 *
 * With no speaker (user/system messages, unknown speaker) the text is returned
 * untouched: `resolveCardAssetUrl` then falls through on the unknown `self`
 * scope and the browser shows a broken image — the same visible failure any
 * other unresolvable card:// link produces.
 */
const SELF_GALLERY_PREFIX_RE = /card:\/\/self\/gallery\//gi;

export function resolveSelfCardAssets(text: string, characterId?: string | null): string {
  if (!text || !characterId) return text;
  const prefix = `card://characters/${encodeURIComponent(characterId)}/gallery/`;
  // Function replacer so `$`-sequences in the id can never be interpreted as
  // replacement patterns. Filenames after the prefix are never touched.
  return text.replace(SELF_GALLERY_PREFIX_RE, () => prefix);
}

export function resolveCardAssetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed.toLowerCase().startsWith("card://")) return rawUrl;

  const withoutProtocol = trimmed.slice("card://".length);
  const [withoutHash] = withoutProtocol.split("#");
  const [pathOnly] = (withoutHash ?? "").split("?");
  const rawParts = (pathOnly ?? "").split("/").filter(Boolean);
  if (rawParts.length === 0) return rawUrl;

  const scope = rawParts[0]!.toLowerCase();
  const parts = rawParts.slice(1);

  if (scope === "gallery") {
    if (parts.length >= 2) {
      return `/api/gallery/file/${encodePath([parts[0]!, parts.slice(1).join("/")])}`;
    }
    const chatId = activeChatId();
    if (chatId && parts[0]) {
      return `/api/gallery/asset/${encodeSegment(chatId)}/gallery/${encodePath(parts)}`;
    }
  }

  if (scope === "characters" && parts.length >= 3 && parts[1] === "gallery") {
    return `/api/characters/${encodeSegment(parts[0]!)}/gallery/file/${encodePath(parts.slice(2))}`;
  }

  if (scope === "personas" && parts.length >= 3 && parts[1] === "gallery") {
    return `/api/characters/personas/${encodeSegment(parts[0]!)}/gallery/file/${encodePath(parts.slice(2))}`;
  }

  // `self` is resolved before render by resolveSelfCardAssets(). Reaching here
  // means there was no speaker context (user/system message, unknown speaker) —
  // fall through to rawUrl like any other unresolvable scope. Do NOT wire the
  // active chat's character in here: that would silently resolve `self` inside
  // user messages to an arbitrary participant.
  if (scope === "self") return rawUrl;

  if (scope === "sprites") {
    const first = parts[0]?.toLowerCase();
    if ((first === "facial" || first === "fullbody") && parts.length >= 2) {
      const chatId = activeChatId();
      if (chatId) {
        return `/api/gallery/asset/${encodeSegment(chatId)}/sprites/${encodePath(parts)}`;
      }
    }
    if (parts.length >= 2) {
      return `/api/sprites/${encodeSegment(parts[0]!)}/file/${encodePath(parts.slice(1))}`;
    }
  }

  return rawUrl;
}

export function buildCardAssetMarkdown(label: string, cardUrl: string): string {
  const alt = label.replace(/[\]\r\n]/g, " ").trim() || "image";
  return `![${alt}](${cardUrl})`;
}

export function dispatchCardAssetInsert(markdown: string, chatId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CardAssetInsertDetail>(CARD_ASSET_INSERT_EVENT, { detail: { markdown, chatId } }));
}
