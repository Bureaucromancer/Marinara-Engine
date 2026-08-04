// Locked NoodleR posts must show a blurred teaser rather than a grey frame — and that blur
// has to be server-side, because shipping the original bytes and blurring in CSS discloses
// protected media to anyone who opens devtools. This asserts the derivative is genuinely
// destructive, not just visually softened.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNoodlerLockedTeaser } from "../../packages/server/src/services/noodle/noodle-noodler-media.js";
import { getSharp } from "../../packages/server/src/utils/sharp.js";

const workDir = mkdtempSync(join(tmpdir(), "marinara-noodle-locked-teaser-"));

try {
  const sharp = await getSharp();
  // sharp has no Android/Termux prebuild. Where it cannot load the route fails closed and
  // serves nothing, which is the behaviour the null branch below pins.
  if (!sharp) {
    assert.equal(await readNoodlerLockedTeaser(join(workDir, "missing.png")), null);
    console.log("noodle-locked-teaser: sharp unavailable, verified fail-closed only");
  } else {
    // A hard-edged two-colour source: any surviving structure is easy to detect.
    const originalPath = join(workDir, "post.png");
    await sharp({
      create: { width: 256, height: 192, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 128, height: 192, channels: 3, background: { r: 0, g: 0, b: 255 } },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toFile(originalPath);
    const original = readFileSync(originalPath);

    const teaser = await readNoodlerLockedTeaser(originalPath);
    assert.ok(teaser, "a decodable source must yield a teaser");
    assert.notEqual(teaser.toString("base64"), original.toString("base64"), "teaser must not be the original bytes");

    const meta = await sharp(teaser).metadata();
    assert.ok(meta.width !== undefined && meta.width <= 24, "teaser must be downscaled past recoverability");
    assert.ok(teaser.length < original.length / 4, "teaser must be far smaller than the protected original");

    const teaserPath = `${originalPath}.teaser.jpg`;
    assert.ok(existsSync(teaserPath), "teaser must be cached next to its source");
    const cachedMtime = statSync(teaserPath).mtimeMs;
    const second = await readNoodlerLockedTeaser(originalPath);
    assert.equal(second?.toString("base64"), teaser.toString("base64"), "cached teaser must be reused verbatim");
    assert.equal(statSync(teaserPath).mtimeMs, cachedMtime, "a cache hit must not rebuild the teaser");

    // An unreadable source must fail closed rather than surface anything.
    assert.equal(await readNoodlerLockedTeaser(join(workDir, "absent.png")), null);
    console.log("noodle-locked-teaser: OK");
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
