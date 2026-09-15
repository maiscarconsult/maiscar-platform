/**
 * MAISCAR_HOST_AVATAR (2026-09-11/12, MAISCAR_REFERENCE_FORMAT_LOCK_V1) —
 * replaces the earlier floating-head badge (REPROVADO: "aquilo NÃO conta
 * como personagem"). Same discipline as before — 100% code-drawn SVG, NOT a
 * copy of any reference-video character — but now a half-body explainer
 * character with a real torso and two arms that can point in 4 directions,
 * facepalm, hold a "R$" tag, etc. Same face system (eyes/brows/mouth +
 * talk-flap) reused from the previous version, now sitting on a body.
 */
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { MascotPose } from "./types";

export const BRAND_RED = "#C1272D";
export const BRAND_OFFWHITE = "#F6F4EF";
export const INK = "#1A1A1A";
export const SKIN = "#F0C8A0";

export interface FaceShape {
  leftEye: string;
  rightEye: string;
  leftBrow: string;
  rightBrow: string;
  mouth: string;
}

// Shoulders at (-48,-15) / (48,-15). Arms drawn as thick rounded strokes
// from shoulder to elbow to hand; handCx/handCy positions the palm circle.
export interface ArmShape {
  leftArm: string;
  rightArm: string;
  leftHand: [number, number];
  rightHand: [number, number];
  facepalm?: boolean; // right hand covers the face instead of showing at rightHand
  headTouch?: boolean; // right hand rests on top of the head
  cashTag?: boolean; // right hand holds a small "R$" tag
  whisper?: boolean; // hand cupped near the mouth (confidential/SUSSURRO)
}

const RESTING_ARMS: Pick<ArmShape, "leftArm" | "rightArm" | "leftHand" | "rightHand"> = {
  leftArm: "M -48,-15 Q -58,25 -50,65",
  rightArm: "M 48,-15 Q 58,25 50,65",
  leftHand: [-50, 68],
  rightHand: [50, 68],
};

export const FACE: Record<MascotPose, FaceShape> = {
  NORMAL: { leftEye: "M -18,-6 a5,5 0 1,0 0.1,0", rightEye: "M 18,-6 a5,5 0 1,0 0.1,0", leftBrow: "M -25,-18 L -11,-16", rightBrow: "M 11,-16 L 25,-18", mouth: "M -14,14 Q 0,20 14,14" },
  SURPRESO: { leftEye: "M -18,-8 a7,7 0 1,0 0.1,0", rightEye: "M 18,-8 a7,7 0 1,0 0.1,0", leftBrow: "M -26,-24 L -10,-20", rightBrow: "M 10,-20 L 26,-24", mouth: "M -8,14 a8,9 0 1,0 16,0 a8,9 0 1,0 -16,0" },
  DESCONFIADO: { leftEye: "M -20,-6 L -10,-6", rightEye: "M 10,-4 a5,5 0 1,0 0.1,0", leftBrow: "M -25,-14 L -9,-10", rightBrow: "M 9,-18 L 25,-16", mouth: "M -12,16 Q 0,12 14,15" },
  BRAVO: { leftEye: "M -18,-6 a5,5 0 1,0 0.1,0", rightEye: "M 18,-6 a5,5 0 1,0 0.1,0", leftBrow: "M -26,-10 L -8,-18", rightBrow: "M 8,-18 L 26,-10", mouth: "M -14,18 Q 0,10 14,18" },
  INDIGNADO: { leftEye: "M -20,-8 a6,6 0 1,0 0.1,0", rightEye: "M 20,-8 a6,6 0 1,0 0.1,0", leftBrow: "M -27,-8 L -8,-20", rightBrow: "M 8,-20 L 27,-8", mouth: "M -16,16 L 16,16 L 8,22 L -8,22 Z" },
  RINDO: { leftEye: "M -22,-8 Q -18,-14 -14,-8", rightEye: "M 14,-8 Q 18,-14 22,-8", leftBrow: "M -25,-18 L -11,-17", rightBrow: "M 11,-17 L 25,-18", mouth: "M -16,10 Q 0,26 16,10 Q 0,20 -16,10 Z" },
  IRONICO: { leftEye: "M -20,-6 L -10,-6", rightEye: "M 10,-8 a5,5 0 1,0 0.1,0", leftBrow: "M -25,-12 L -9,-12", rightBrow: "M 9,-20 L 25,-14", mouth: "M -14,15 Q -2,11 14,17" },
  FACEPALM: { leftEye: "M -20,-6 L -10,-6", rightEye: "M 10,-6 L 20,-6", leftBrow: "M -25,-12 L -9,-10", rightBrow: "M 9,-10 L 25,-12", mouth: "M -12,17 Q 0,13 12,17" },
  ASSUSTADO: { leftEye: "M -18,-8 a8,8 0 1,0 0.1,0", rightEye: "M 18,-8 a8,8 0 1,0 0.1,0", leftBrow: "M -27,-26 L -9,-20", rightBrow: "M 9,-20 L 27,-26", mouth: "M -6,16 a6,7 0 1,0 12,0 a6,7 0 1,0 -12,0" },
  APONTANDO: { leftEye: "M -18,-6 a5,5 0 1,0 0.1,0", rightEye: "M 18,-6 a5,5 0 1,0 0.1,0", leftBrow: "M -25,-18 L -11,-16", rightBrow: "M 11,-16 L 25,-18", mouth: "M -12,14 Q 0,18 12,14" },
  APONTANDO_DIREITA: { leftEye: "M -18,-6 a5,5 0 1,0 0.1,0", rightEye: "M 18,-6 a5,5 0 1,0 0.1,0", leftBrow: "M -25,-18 L -11,-16", rightBrow: "M 11,-16 L 25,-18", mouth: "M -12,14 Q 0,18 12,14" },
  APONTANDO_ESQUERDA: { leftEye: "M -18,-6 a5,5 0 1,0 0.1,0", rightEye: "M 18,-6 a5,5 0 1,0 0.1,0", leftBrow: "M -25,-18 L -11,-16", rightBrow: "M 11,-16 L 25,-18", mouth: "M -12,14 Q 0,18 12,14" },
  APONTANDO_CIMA: { leftEye: "M -18,-8 a5,5 0 1,0 0.1,0", rightEye: "M 18,-8 a5,5 0 1,0 0.1,0", leftBrow: "M -25,-20 L -11,-18", rightBrow: "M 11,-18 L 25,-20", mouth: "M -12,14 Q 0,18 12,14" },
  APONTANDO_BAIXO: { leftEye: "M -18,-6 a5,5 0 1,0 0.1,0", rightEye: "M 18,-6 a5,5 0 1,0 0.1,0", leftBrow: "M -25,-14 L -11,-16", rightBrow: "M 11,-16 L 25,-14", mouth: "M -12,15 Q 0,19 12,15" },
  EXPLICANDO: { leftEye: "M -18,-6 a5,5 0 1,0 0.1,0", rightEye: "M 18,-6 a5,5 0 1,0 0.1,0", leftBrow: "M -25,-16 L -11,-18", rightBrow: "M 11,-18 L 25,-16", mouth: "M -12,13 Q 0,22 12,13" },
  PENSANDO: { leftEye: "M -20,-6 L -10,-6", rightEye: "M 10,-6 L 20,-6", leftBrow: "M -25,-16 L -9,-14", rightBrow: "M 9,-20 L 25,-14", mouth: "M -10,16 Q 0,13 10,16" },
  MAO_NA_CABECA: { leftEye: "M -20,-6 L -10,-6", rightEye: "M 10,-6 L 20,-6", leftBrow: "M -25,-12 L -9,-10", rightBrow: "M 9,-10 L 25,-12", mouth: "M -12,17 Q 0,14 12,17" },
  DINHEIRO: { leftEye: "M -20,-8 Q -16,-13 -12,-8", rightEye: "M 12,-8 Q 16,-13 20,-8", leftBrow: "M -25,-18 L -11,-17", rightBrow: "M 11,-17 L 25,-18", mouth: "M -14,12 Q 0,20 14,12" },
  POSITIVO: { leftEye: "M -22,-8 Q -18,-14 -14,-8", rightEye: "M 14,-8 Q 18,-14 22,-8", leftBrow: "M -25,-18 L -11,-17", rightBrow: "M 11,-17 L 25,-18", mouth: "M -14,12 Q 0,22 14,12" },
  NEGATIVO: { leftEye: "M -20,-4 L -10,-8", rightEye: "M 10,-8 L 20,-4", leftBrow: "M -25,-10 L -9,-16", rightBrow: "M 9,-16 L 25,-10", mouth: "M -14,18 Q 0,10 14,18" },
  DINHEIRO_DOENDO: { leftEye: "M -22,-6 L -10,-10", rightEye: "M 10,-10 L 22,-6", leftBrow: "M -27,-16 L -9,-8", rightBrow: "M 9,-8 L 27,-16", mouth: "M -14,20 L 14,20 L 6,26 L -6,26 Z" },
  SUSSURRO: { leftEye: "M -20,-6 L -10,-6", rightEye: "M 10,-6 L 20,-6", leftBrow: "M -25,-14 L -9,-13", rightBrow: "M 9,-13 L 25,-14", mouth: "M -8,15 Q 0,17 8,15" },
  NEGANDO: { leftEye: "M -20,-6 L -10,-6", rightEye: "M 10,-6 L 20,-6", leftBrow: "M -25,-12 L -9,-14", rightBrow: "M 9,-14 L 25,-12", mouth: "M -12,17 Q 0,13 12,17" },
  CONCORDANDO: { leftEye: "M -22,-8 Q -18,-14 -14,-8", rightEye: "M 14,-8 Q 18,-14 22,-8", leftBrow: "M -25,-17 L -11,-16", rightBrow: "M 11,-16 L 25,-17", mouth: "M -13,13 Q 0,21 13,13" },
};

export const ARMS: Record<MascotPose, ArmShape> = {
  NORMAL: { ...RESTING_ARMS },
  SURPRESO: { leftArm: "M -48,-15 Q -70,10 -55,45", rightArm: "M 48,-15 Q 70,10 55,45", leftHand: [-56, 48], rightHand: [56, 48] },
  DESCONFIADO: { ...RESTING_ARMS },
  BRAVO: { leftArm: "M -48,-15 Q -60,15 -45,50", rightArm: "M 48,-15 Q 60,15 45,50", leftHand: [-46, 53], rightHand: [46, 53] },
  INDIGNADO: { leftArm: "M -48,-15 Q -65,10 -58,45", rightArm: "M 48,-15 Q 65,10 58,45", leftHand: [-59, 48], rightHand: [59, 48] },
  RINDO: { ...RESTING_ARMS },
  IRONICO: { ...RESTING_ARMS },
  FACEPALM: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 40,-45 5,-58", leftHand: [-50, 68], rightHand: [5, -58], facepalm: true },
  ASSUSTADO: { leftArm: "M -48,-15 Q -55,-55 -20,-75", rightArm: "M 48,-15 Q 55,-55 20,-75", leftHand: [-20, -78], rightHand: [20, -78] },
  APONTANDO: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 90,-25 140,-40", leftHand: [-50, 68], rightHand: [140, -40] },
  APONTANDO_DIREITA: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 90,-25 140,-40", leftHand: [-50, 68], rightHand: [140, -40] },
  APONTANDO_ESQUERDA: { leftArm: "M -48,-15 Q -90,-25 -140,-40", rightArm: "M 48,-15 Q 58,25 50,65", leftHand: [-140, -40], rightHand: [50, 68] },
  APONTANDO_CIMA: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 58,-70 40,-135", leftHand: [-50, 68], rightHand: [40, -135] },
  APONTANDO_BAIXO: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 75,45 65,100", leftHand: [-50, 68], rightHand: [65, 100] },
  EXPLICANDO: { leftArm: "M -48,-15 Q -85,10 -80,45", rightArm: "M 48,-15 Q 85,10 80,45", leftHand: [-82, 48], rightHand: [82, 48] },
  PENSANDO: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 45,-40 18,-48", leftHand: [-50, 68], rightHand: [18, -48] },
  MAO_NA_CABECA: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 35,-70 10,-108", leftHand: [-50, 68], rightHand: [10, -108], headTouch: true },
  DINHEIRO: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 70,-35 78,-58", leftHand: [-50, 68], rightHand: [78, -58], cashTag: true },
  POSITIVO: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 72,-15 68,-45", leftHand: [-50, 68], rightHand: [68, -45] },
  NEGATIVO: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 78,5 72,20", leftHand: [-50, 68], rightHand: [72, 20] },
  DINHEIRO_DOENDO: { leftArm: "M -48,-15 Q -35,-70 -10,-108", rightArm: "M 48,-15 Q 70,-35 78,-58", leftHand: [-10, -108], rightHand: [78, -58], headTouch: true, cashTag: true },
  SUSSURRO: { leftArm: "M -48,-15 Q 40,-40 25,-65", rightArm: "M 48,-15 Q 40,-40 25,-65", leftHand: [-50, 68], rightHand: [25, -65], whisper: true },
  NEGANDO: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 60,-30 20,-35", leftHand: [-50, 68], rightHand: [20, -35] },
  CONCORDANDO: { leftArm: "M -48,-15 Q -58,25 -50,65", rightArm: "M 48,-15 Q 72,-15 68,-45", leftHand: [-50, 68], rightHand: [68, -45] },
};

export interface MascotProps {
  pose: MascotPose;
  /** 0-1: scale up briefly for a punch-in reaction beat. */
  punchIn?: boolean;
  size?: number;
  /** enters the scene from a side instead of just fading/scaling in place. */
  enterFrom?: "LEFT" | "RIGHT" | "NONE";
  /** the avatar IS the narrator, so its mouth flaps open/closed while its
   *  beat's narration plays — not real phoneme lip-sync, just a fast
   *  open/close cycle. Default true since it only appears during its own
   *  beat's narration. */
  talking?: boolean;
}

/** MAISCAR_HOST_AVATAR — a half-body explainer character (head+torso+arms) that slides in, points, reacts, and talks. Not an icon. */
export const Mascot: React.FC<MascotProps> = ({ pose, punchIn, size = 260, enterFrom = "NONE", talking = true }) => {
  const frame = useCurrentFrame();
  const face = FACE[pose];
  const arms = ARMS[pose];
  const entranceProgress = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const punch = punchIn ? interpolate(frame, [0, 4, 10], [1, 1.18, 1], { extrapolateRight: "clamp" }) : 1;
  const scale = entranceProgress * punch;
  const slideDistance = enterFrom === "NONE" ? 0 : size * 1.3;
  const slideX = enterFrom === "LEFT" ? -slideDistance * (1 - entranceProgress) : enterFrom === "RIGHT" ? slideDistance * (1 - entranceProgress) : 0;
  const talkScale = talking ? (Math.floor(frame / 4) % 2 === 0 ? 0.7 : 1.6) : 1;

  return (
    <div style={{ width: size, height: size * 1.35, transform: `translateX(${slideX}px) scale(${scale})`, transformOrigin: "bottom center" }}>
      <svg viewBox="-100 -145 200 250" width={size} height={size * 1.35}>
        {/* torso */}
        <path d="M -48,-15 Q -55,45 -42,95 L 42,95 Q 55,45 48,-15 Q 48,-45 0,-50 Q -48,-45 -48,-15 Z" fill={BRAND_RED} stroke={BRAND_OFFWHITE} strokeWidth={5} />
        {/* collar */}
        <path d="M -16,-42 L 0,-18 L 16,-42" stroke={BRAND_OFFWHITE} strokeWidth={7} strokeLinecap="round" fill="none" />
        {/* arms (behind hands, drawn before head so hands can overlap face for facepalm/headTouch) */}
        <path d={arms.leftArm} stroke={BRAND_RED} strokeWidth={18} strokeLinecap="round" fill="none" />
        <path d={arms.rightArm} stroke={BRAND_RED} strokeWidth={18} strokeLinecap="round" fill="none" />
        <circle cx={arms.leftHand[0]} cy={arms.leftHand[1]} r={13} fill={SKIN} stroke={INK} strokeWidth={1.5} />
        {!arms.facepalm && <circle cx={arms.rightHand[0]} cy={arms.rightHand[1]} r={13} fill={SKIN} stroke={INK} strokeWidth={1.5} />}
        {arms.cashTag && <text x={arms.rightHand[0] + 2} y={arms.rightHand[1] - 18} fontSize={20} fontWeight="bold" fill={BRAND_OFFWHITE} stroke={INK} strokeWidth={0.5} textAnchor="middle">R$</text>}

        {/* head */}
        <g transform="translate(0, -78)">
          <circle cx={0} cy={0} r={52} fill={SKIN} stroke={BRAND_OFFWHITE} strokeWidth={5} />
          {!arms.facepalm && (
            <>
              <path d={face.leftBrow} stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill="none" />
              <path d={face.rightBrow} stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill="none" />
              <path d={face.leftEye} stroke={INK} strokeWidth={4} strokeLinecap="round" fill={INK} />
              <path d={face.rightEye} stroke={INK} strokeWidth={4} strokeLinecap="round" fill={INK} />
              <g transform={`translate(0, 15) scale(1, ${talkScale}) translate(0, -15)`}>
                <path d={face.mouth} stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill="none" />
              </g>
            </>
          )}
          {arms.facepalm && <circle cx={5} cy={-4} r={14} fill={SKIN} stroke={INK} strokeWidth={1.5} />}
        </g>
      </svg>
    </div>
  );
};
