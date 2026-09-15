import fs from "node:fs";
import sharp from "sharp";

/**
 * MAIS.CAR — sistema visual fixo "Corte Diagonal".
 * Regra de marca (não alterar por post): texto no topo (menor), foto embaixo
 * (maior, protagonista), separadas por um corte diagonal. Vermelho de marca
 * (amostrado do logo oficial), Bebas Neue para manchete, Bahnschrift para
 * apoio. Ver platform/docs/design-system-diagonal.md para a especificação
 * completa — este módulo é a implementação de referência usada por todo post
 * novo (manual ou pelo pipeline automático).
 */

export const MAISCAR_RED = "#A00223";
export const INK = "#181614";
export const PANEL_BG = "#FFFFFF";

const W = 1080;
const H = 1350;

function esc(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface DiagonalSlideInput {
  photoPath: string | Buffer;
  kicker: string;
  headline: string[]; // pre-broken lines, 1-3 short lines
  subhead?: string;
  pageLabel?: string; // e.g. "01/06"
  /** panel height in px at x=0 and x=W — left taller than right by default */
  panelLeftY?: number;
  panelRightY?: number;
  /** sharp position hint for the cover crop of a portrait/landscape source photo */
  photoPosition?: string;
}

export async function renderDiagonalSlide(input: DiagonalSlideInput): Promise<Buffer> {
  const panelLeftY = input.panelLeftY ?? 470;
  const panelRightY = input.panelRightY ?? 310;

  const graded = await sharp(input.photoPath)
    .resize(W, H, { fit: "cover", position: input.photoPosition ?? "centre" })
    .modulate({ saturation: 0.88, brightness: 1.0 })
    .linear(1.08, -12) // brand grade: slightly desaturated, higher contrast — applied to every post
    .png()
    .toBuffer();

  const headlineSize = 92;
  const headlineLead = 86;
  const headlineStartY = 216;

  const headlineSvg = input.headline
    .map(
      (line, i) =>
        `<text x="76" y="${headlineStartY + i * headlineLead}" font-family="Bebas Neue" font-size="${headlineSize}" fill="${MAISCAR_RED}" letter-spacing="1">${esc(line.toUpperCase())}</text>`,
    )
    .join("\n");

  const subheadY = headlineStartY + input.headline.length * headlineLead + 2;

  // Safe width for the subhead at its y: the panel narrows as the diagonal
  // rises, so text that fits under the headline can still run past the
  // photo edge lower down. Auto-shrink (down to a floor) rather than let it
  // silently truncate against the clip path — the clip is a safety net, not
  // the fit strategy, since this template also drives the unattended daily
  // pipeline where nobody hand-trims the caption per slide.
  let subheadFontSize = 26;
  let subheadText = input.subhead ?? "";
  if (input.subhead) {
    const marginX = 76;
    const t = panelLeftY === panelRightY ? 1 : (subheadY - panelLeftY) / (panelRightY - panelLeftY);
    const boundaryXAtY = t * W; // x where the diagonal crosses y=subheadY
    const safeWidth = Math.max(200, boundaryXAtY - marginX - 24);
    const avgCharFactor = 0.5; // Bahnschrift SemiBold approx width/height ratio
    let projected = input.subhead.length * subheadFontSize * avgCharFactor;
    while (projected > safeWidth && subheadFontSize > 18) {
      subheadFontSize -= 1;
      projected = input.subhead.length * subheadFontSize * avgCharFactor;
    }
    if (projected > safeWidth) {
      const maxChars = Math.max(8, Math.floor(safeWidth / (subheadFontSize * avgCharFactor)) - 1);
      subheadText = input.subhead.slice(0, maxChars).trimEnd() + "…";
    }
  }

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="wmHalo" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5"/></filter>
      <clipPath id="panelClip">
        <polygon points="0,0 ${W},0 ${W},${panelRightY} 0,${panelLeftY}" />
      </clipPath>
    </defs>

    <!-- text panel: white, diagonal bottom edge (taller left, shorter right) -->
    <polygon points="0,0 ${W},0 ${W},${panelRightY} 0,${panelLeftY}" fill="${PANEL_BG}" />
    <!-- seam accent: thin red pinstripe tracing the diagonal -->
    <line x1="0" y1="${panelLeftY}" x2="${W}" y2="${panelRightY}" stroke="${MAISCAR_RED}" stroke-width="4" />
    <line x1="0" y1="${panelLeftY + 12}" x2="${W}" y2="${panelRightY + 12}" stroke="${MAISCAR_RED}" stroke-width="1.5" stroke-opacity="0.55" />

    <!-- all panel text clipped to the panel shape so it can never bleed onto the photo -->
    <g clip-path="url(#panelClip)">
      <text x="76" y="108" font-family="Bahnschrift SemiBold" font-weight="600" font-size="22" letter-spacing="5" fill="${INK}">${esc(input.kicker.toUpperCase())}</text>
      <line x1="76" y1="128" x2="146" y2="128" stroke="${MAISCAR_RED}" stroke-width="3" />
      ${headlineSvg}
      ${input.subhead ? `<text x="76" y="${subheadY}" font-family="Bahnschrift SemiBold" font-weight="500" font-size="${subheadFontSize}" fill="${INK}" fill-opacity="0.72">${esc(subheadText)}</text>` : ""}
    </g>

    <!-- outer frame: slim brand rule, automotive pinstripe -->
    <rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="${MAISCAR_RED}" stroke-width="3" />
    <rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="${MAISCAR_RED}" stroke-width="1" stroke-opacity="0.5" />

    <!-- brand signature over photo, bottom -->
    <text x="76" y="${H - 56}" font-family="Bebas Neue" font-size="30" letter-spacing="3" fill="#FFFFFF" filter="url(#wmHalo)" fill-opacity="0.9">MAIS.CAR</text>
    <text x="76" y="${H - 56}" font-family="Bebas Neue" font-size="30" letter-spacing="3" fill="#FFFFFF">MAIS.CAR</text>
    ${
      input.pageLabel
        ? `<text x="${W - 76}" y="${H - 56}" font-family="Bahnschrift SemiBold" font-weight="600" font-size="18" letter-spacing="2" fill="#FFFFFF" text-anchor="end" filter="url(#wmHalo)">${esc(input.pageLabel)}</text>
           <text x="${W - 76}" y="${H - 56}" font-family="Bahnschrift SemiBold" font-weight="600" font-size="18" letter-spacing="2" fill="#FFFFFF" text-anchor="end">${esc(input.pageLabel)}</text>`
        : ""
    }
  </svg>`;

  return sharp(graded).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

export async function renderDiagonalSlideToFile(input: DiagonalSlideInput, outPath: string) {
  const buf = await renderDiagonalSlide(input);
  fs.writeFileSync(outPath, buf);
  return outPath;
}
