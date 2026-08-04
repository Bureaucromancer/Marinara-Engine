// ──────────────────────────────────────────────
// Avatar Crop Zod Schema
// ──────────────────────────────────────────────
import { z } from "zod";

/** Strict request-schema union for avatar crops: the current source-rectangle
 *  shape or the legacy zoom+offset shape. Both variants reject unknown keys
 *  (`.strict()`), and every numeric field must be finite with positive
 *  dimensions, so malformed shapes are rejected at the request boundary. */
export const avatarCropSchema = z.union([
  z
    .object({
      srcX: z.number().finite(),
      srcY: z.number().finite(),
      srcWidth: z.number().finite().positive(),
      srcHeight: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      zoom: z.number().finite().positive(),
      offsetX: z.number().finite(),
      offsetY: z.number().finite(),
      fullImage: z.boolean().optional(),
    })
    .strict(),
]);
