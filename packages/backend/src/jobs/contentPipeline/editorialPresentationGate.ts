/**
 * EDITORIAL_PRESENTATION_GATE (2026-09-09, permanent rule) — deterministic
 * checklist that catches the "technically rendered but amateur" failure
 * mode: same photo repeated across slides, bare questions instead of
 * explanation, slides with no clear function. Runs AFTER every slide's
 * photo/copy is assembled, BEFORE render. If it fails, the piece is
 * `HELD_FOR_FIX` — never delivered as-is, never silently patched with a
 * worse fallback.
 */
export interface PresentationSlideInput {
  name: string;
  photoSource: string; // identity of the photo actually used (URL or "COMPOSITE:a,b") — used to detect repeats
  headline: string[];
  explanation?: string; // the caption paragraph explaining THIS slide's comparison — required for DATA slides
  isCover: boolean;
  isConclusion: boolean;
}

export interface PresentationGateResult {
  pass: boolean;
  failures: string[];
}

const BARE_QUESTION_RE = /^[^.!]*\?\s*$/; // whole headline/explanation is just one question, nothing else

export function evaluatePresentationGate(slides: PresentationSlideInput[]): PresentationGateResult {
  const failures: string[] = [];

  const cover = slides.find((s) => s.isCover);
  if (!cover) {
    failures.push("sem slide de capa identificado");
  } else {
    const namedTokens = cover.headline.join(" ").split(/\s+/).filter((w) => w.length > 3);
    if (namedTokens.length < 2) failures.push("capa não parece nomear modelos específicos (headline curta demais pra conter 2 nomes)");
  }

  // No two DATA slides (non-cover, non-conclusion) may share the exact same photo source.
  const dataSlides = slides.filter((s) => !s.isCover && !s.isConclusion);
  const seenPhotos = new Map<string, string>();
  for (const s of dataSlides) {
    const prior = seenPhotos.get(s.photoSource);
    if (prior) failures.push(`foto repetida entre "${prior}" e "${s.name}" (${s.photoSource})`);
    seenPhotos.set(s.photoSource, s.name);
  }

  for (const s of dataSlides) {
    if (!s.explanation || s.explanation.trim().length < 20) {
      failures.push(`slide "${s.name}" sem explicação real (mínimo ~20 caracteres de prosa, não só uma pergunta)`);
    } else if (BARE_QUESTION_RE.test(s.explanation.trim())) {
      failures.push(`slide "${s.name}" é só uma pergunta solta, sem explicar a diferença primeiro`);
    }
  }

  return { pass: failures.length === 0, failures };
}
