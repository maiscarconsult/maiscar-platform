/**
 * Plain data contract between the backend pipeline (src/) and the Remotion
 * project (../../../remotion/, outside `rootDir`, so it can't be imported
 * directly here without breaking the backend's own tsconfig). Kept
 * structurally identical to remotion/types.ts on purpose — Remotion's
 * renderer receives this as untyped JSON props anyway (see
 * remotionRenderer.ts), so duplicating the shape here is cheaper than
 * fighting rootDir/project-boundary config for a one-way data handoff.
 */
export type MascotPose =
  | "NORMAL" | "SURPRESO" | "DESCONFIADO" | "BRAVO" | "RINDO" | "IRONICO" | "INDIGNADO"
  | "APONTANDO" | "APONTANDO_ESQUERDA" | "APONTANDO_DIREITA" | "APONTANDO_CIMA" | "APONTANDO_BAIXO"
  | "EXPLICANDO" | "PENSANDO" | "MAO_NA_CABECA" | "DINHEIRO" | "POSITIVO" | "NEGATIVO"
  | "FACEPALM" | "ASSUSTADO" | "DINHEIRO_DOENDO" | "SUSSURRO" | "NEGANDO" | "CONCORDANDO";

export type MascotPosition = "BOTTOM_RIGHT" | "BOTTOM_LEFT" | "TOP_RIGHT" | "TOP_LEFT" | "CENTER" | "FOREGROUND_LEFT" | "FOREGROUND_RIGHT";
export type MascotEnterFrom = "LEFT" | "RIGHT" | "NONE";

export interface VideoCut {
  src: string;
  startFromSec?: number;
  camera?: "PUSH_IN" | "PUSH_OUT" | "STATIC";
}

export interface TimedSfx {
  type: "WHOOSH" | "POP" | "CLICK" | "IMPACT" | "RISER";
  src: string;
  offsetSec?: number;
}

export type VisualRegister =
  | "PRESENTER_FACE" | "SCREEN_EVIDENCE" | "PRODUCT_MACRO"
  | "DOCUMENT" | "LOCATION_BROLL" | "BIG_NUMBER" | "MONEY_STACK";

export type ScreenEvidenceTemplate =
  | "FINANCING_QUOTE" | "LISTING_PAGE" | "WHATSAPP_THREAD"
  | "PIX_RECEIPT" | "INVOICE";

export interface ScreenEvidenceProps {
  template: ScreenEvidenceTemplate;
  values: Record<string, string>;
  highlight?: string[];
}

export interface HookBlock {
  firstOnScreenText: string;
  firstShotRegister: "PRESENTER_FACE" | "SCREEN_EVIDENCE" | "PRODUCT_MACRO";
  voiceStartOffsetMs?: number;
}

export interface TimedBlock {
  id: string;
  startSec: number;
  durationSec: number;
  videoCuts: VideoCut[];
  keyword?: string;
  keywordVariant?: "NORMAL" | "BIG_NUMBER";
  keywordOffsetSec?: number;
  keywordTextPosition?: "TOP" | "CENTER" | "BOTTOM";
  mascotPose?: MascotPose;
  mascotPunchIn?: boolean;
  mascotPosition?: MascotPosition;
  mascotEnterFrom?: MascotEnterFrom;
  mascotScale?: number;
  patternInterrupt?: boolean;
  sfx?: TimedSfx;
  visualRegister?: VisualRegister;
  screenEvidence?: ScreenEvidenceProps;
  hookBlock?: HookBlock;
}

export interface NarratedReelV3Props {
  blocks: TimedBlock[];
  /** MAISCAR_VOICE_LOCK: ONE narration file for the whole Reel. */
  narrationSrc: string;
  musicSrc?: string;
  fps: number;
}
