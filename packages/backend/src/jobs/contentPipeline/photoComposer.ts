import sharp from "sharp";

/**
 * Dual-vehicle cover compositor (2026-09-09) — makes "os dois carros juntos
 * na capa" possible WITHOUT touching diagonalTemplateV4.ts at all. renderHero
 * already accepts any `photoPath: string | Buffer` and treats it as one
 * photo — it grades/crops/frames it exactly the same whether that buffer
 * came from one real photo or, as here, two real photos already merged
 * side-by-side into a single image before it ever reaches renderHero. Every
 * Golden Master invariant (frame, logo, diagonal, photo ratio, frozen type
 * scale) is enforced completely unchanged, because renderHero never knows
 * the difference.
 */
const CANVAS_W = 1080;
const CANVAS_H = 1350;

export async function composeSideBySide(photoPathA: string, photoPathB: string): Promise<Buffer> {
  const halfW = Math.round(CANVAS_W / 2);
  const [left, right] = await Promise.all([
    sharp(photoPathA).resize(halfW, CANVAS_H, { fit: "cover" }).toBuffer(),
    sharp(photoPathB).resize(CANVAS_W - halfW, CANVAS_H, { fit: "cover" }).toBuffer(),
  ]);
  return sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 3, background: { r: 20, g: 20, b: 20 } } })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: halfW, top: 0 },
    ])
    .png()
    .toBuffer();
}
