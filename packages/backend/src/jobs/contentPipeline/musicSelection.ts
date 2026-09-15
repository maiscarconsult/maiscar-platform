/**
 * Music state machine (2026-09-09, corrected twice same day) —
 * MUSIC_SELECTED and MUSIC_ATTACHED are always distinct fields, never
 * conflated. See AI_DECISIONS.md "ROUTE 3 — Visual Storytelling +
 * Explicação + Música" for the full policy.
 *
 * Instagram DOES support adding music manually to feed PHOTO/CAROUSEL
 * posts in the app — the real limitation is narrower: this project's Graph
 * API automation cannot select/attach Instagram-library music
 * programmatically for any format, and no real trending-audio data source
 * is integrated (WebSearch only exists in an interactive session, not the
 * headless scheduler). So MUSIC_SELECTED must still always be true — never
 * "nenhuma música selecionada" — but for the unattended scheduler that
 * selection has to come from a track a human already curated ahead of
 * time; a real, specific recommendation (track + artist + why it fits)
 * requires a human/interactive pass, same as rich comparison facts do.
 */
export type MusicStatus = "ATTACHED" | "MANUAL_FINALIZATION_REQUIRED";

export interface MusicDecision {
  musicSelected: boolean;
  musicAttached: boolean;
  status: MusicStatus;
  track: string;
  artist: string;
  whyItFits: string;
  reason: string;
}

/**
 * Call with a real, specific track curated for this piece (WebSearch or
 * manual knowledge of a real current/appropriate song) — never a
 * placeholder. `attached` stays false until a human confirms it was
 * actually added in the Instagram app.
 */
export function curateMusic(track: string, artist: string, whyItFits: string, contentType: "PHOTO" | "CAROUSEL" | "REEL"): MusicDecision {
  return {
    musicSelected: true,
    musicAttached: false,
    status: "MANUAL_FINALIZATION_REQUIRED",
    track,
    artist,
    whyItFits,
    reason: `Instagram suporta música em ${contentType}, mas a automação via Graph API deste projeto não consegue selecionar/anexar áudio da biblioteca do Instagram — finalização manual no app é obrigatória antes de publicar.`,
  };
}

/**
 * Honest placeholder for the UNATTENDED scheduler only (daily-cycle-and-
 * publish.ts) — it has no web-search tool, so it cannot curate a real
 * track. musicSelected stays false here on purpose (a fabricated track
 * name would violate "não invente"); the piece is left in REVIEW status so
 * a human picks a real track via curateMusic() before finalizing.
 */
export function noAutomaticSelectionAvailable(contentType: "PHOTO" | "CAROUSEL" | "REEL"): MusicDecision {
  return {
    musicSelected: false,
    musicAttached: false,
    status: "MANUAL_FINALIZATION_REQUIRED",
    track: "",
    artist: "",
    whyItFits: "",
    reason: `${contentType} preparado automaticamente, mas nenhuma música foi selecionada — o scheduler headless não tem busca real de áudio em alta. Precisa de curadoria manual (curateMusic) antes da finalização no app.`,
  };
}
