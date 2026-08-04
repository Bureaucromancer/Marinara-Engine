import { logger } from "../lib/logger.js";

// sharp can fail to load on Android/Termux because it has no native Android
// prebuild. Lazy-load it so callers can degrade without blocking server startup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SharpFn = any;
let cachedSharp: SharpFn | null = null;
let sharpLoadFailed = false;
let sharpLoadPromise: Promise<SharpFn | null> | null = null;

/** Resolve the optional native `sharp` dependency, or null where it cannot load. */
export async function getSharp(): Promise<SharpFn | null> {
  if (cachedSharp) return cachedSharp;
  if (sharpLoadFailed) return null;
  if (sharpLoadPromise) return sharpLoadPromise;

  sharpLoadPromise = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - optional native dep, may not load on some platforms
      const mod = await import("sharp");
      cachedSharp = (mod.default ?? mod) as SharpFn;
      return cachedSharp;
    } catch (error) {
      sharpLoadFailed = true;
      logger.debug(error, "[image] sharp could not be loaded; image processing is unavailable");
      return null;
    } finally {
      sharpLoadPromise = null;
    }
  })();

  return sharpLoadPromise;
}
