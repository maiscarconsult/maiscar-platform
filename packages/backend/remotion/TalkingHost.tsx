/**
 * MAISCAR_TALKING_HOST_MASTER (2026-09-13, format-lock) — the permanent
 * host character, redrawn from the account owner's own reference image
 * (curly dark hair, round white-framed glasses, dark beard/mustache, grey
 * t-shirt with a small MAIS CAR red accent). 100% code-drawn SVG, same
 * discipline as the previous Mascot.tsx — never a raster copy of the
 * reference photo. Reuses Mascot.tsx's FACE/ARMS gesture tables verbatim
 * (the pose *shapes* are identity-independent — only the head rendering
 * and color palette changed), so every existing pose/gesture keeps
 * working unchanged.
 *
 * Talking mouth: real per-word phoneme-accurate lip-sync isn't attempted
 * (explicitly not required — "não precisa lip-sync cinematográfico
 * perfeito"). Instead of the old constant-rate 2-frame square wave, mouth
 * state cycles through CLOSED/SMALL_OPEN/MEDIUM_OPEN/WIDE_OPEN using a
 * deterministic pseudo-random function of the frame number, with brief
 * closed-mouth "breath" pauses every ~20-30 frames — reads as continuous,
 * varied speech instead of a metronome, entirely code/frame-driven, 0 LLM.
 */
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { MascotPose } from "./types";
import { FACE, ARMS, BRAND_RED, INK } from "./Mascot";

const HOST_SKIN = "#D9A876";
const HOST_SHIRT = "#4A4A4D";
const HOST_SHIRT_DARK = "#3A3A3D";
const HOST_HAIR = "#1C1712";
const HOST_BEARD = "#231B14";
const GLASSES_WHITE = "#F4F2ED";

// Deterministic pseudo-random in [0,1) from an integer seed — no Math.random
// (must stay frame-reproducible across re-renders).
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

type MouthState = 0 | 1 | 2 | 3; // CLOSED, SMALL_OPEN, MEDIUM_OPEN, WIDE_OPEN
const MOUTH_SCALE: Record<MouthState, number> = { 0: 0.15, 1: 0.55, 2: 1, 3: 1.45 };

/** Procedural talk-scale: varies mouth openness on a ~3-frame cadence with
 *  occasional longer closed "breath" gaps, all deterministic in `frame`. */
function talkingMouthScale(frame: number): number {
  const syllableIndex = Math.floor(frame / 3);
  // ~1 in 9 syllables is a brief closed-mouth beat (breath/consonant pause).
  if (pseudoRandom(syllableIndex * 7.31) < 0.11) return MOUTH_SCALE[0];
  const state = Math.floor(pseudoRandom(syllableIndex) * 4) as MouthState;
  // Smooth the transition within the syllable window instead of a hard cut.
  const withinSyllable = (frame % 3) / 3;
  const nextState = Math.floor(pseudoRandom(syllableIndex + 1) * 4) as MouthState;
  return interpolate(withinSyllable, [0, 1], [MOUTH_SCALE[state], MOUTH_SCALE[nextState]]);
}

export interface TalkingHostProps {
  pose: MascotPose;
  punchIn?: boolean;
  size?: number;
  enterFrom?: "LEFT" | "RIGHT" | "NONE";
  talking?: boolean;
}

/** MAISCAR_TALKING_HOST_MASTER — half-body host (head+torso+arms), same
 *  gesture system as the previous generic Mascot, redrawn with the locked
 *  personal identity (hair/glasses/beard/outfit) and a more natural
 *  procedural talk animation plus blinking and a subtle head bob. */
export const TalkingHost: React.FC<TalkingHostProps> = ({ pose, punchIn, size = 260, enterFrom = "NONE", talking = true }) => {
  const frame = useCurrentFrame();
  const face = FACE[pose];
  const arms = ARMS[pose];
  const entranceProgress = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const punch = punchIn ? interpolate(frame, [0, 4, 10], [1, 1.18, 1], { extrapolateRight: "clamp" }) : 1;
  const scale = entranceProgress * punch;
  const slideDistance = enterFrom === "NONE" ? 0 : size * 1.3;
  const slideX = enterFrom === "LEFT" ? -slideDistance * (1 - entranceProgress) : enterFrom === "RIGHT" ? slideDistance * (1 - entranceProgress) : 0;
  const talkScale = talking ? talkingMouthScale(frame) : 1;

  // Subtle head bob (never during facepalm, where the head is covered anyway).
  const headBobY = Math.sin(frame / 9) * 1.6;
  const headBobRotate = Math.sin(frame / 14) * 1.4;

  // Blink: quick eyelid-close every ~90 frames (~3s at 30fps), 3-frame close.
  const blinkCycle = frame % 90;
  const isBlinking = blinkCycle < 3 && !arms.facepalm;

  return (
    <div style={{ width: size, height: size * 1.35, transform: `translateX(${slideX}px) scale(${scale})`, transformOrigin: "bottom center" }}>
      <svg viewBox="-100 -145 200 250" width={size} height={size * 1.35}>
        {/* torso — grey tee with a small red MAIS CAR collar accent */}
        <path d="M -48,-15 Q -55,45 -42,95 L 42,95 Q 55,45 48,-15 Q 48,-45 0,-50 Q -48,-45 -48,-15 Z" fill={HOST_SHIRT} stroke={HOST_SHIRT_DARK} strokeWidth={3} />
        <path d="M -16,-42 L 0,-18 L 16,-42" stroke={BRAND_RED} strokeWidth={6} strokeLinecap="round" fill="none" />

        {/* arms (behind hands, drawn before head so hands can overlap face for facepalm/headTouch) */}
        <path d={arms.leftArm} stroke={HOST_SHIRT} strokeWidth={18} strokeLinecap="round" fill="none" />
        <path d={arms.rightArm} stroke={HOST_SHIRT} strokeWidth={18} strokeLinecap="round" fill="none" />
        <circle cx={arms.leftHand[0]} cy={arms.leftHand[1]} r={13} fill={HOST_SKIN} stroke={INK} strokeWidth={1.5} />
        {!arms.facepalm && <circle cx={arms.rightHand[0]} cy={arms.rightHand[1]} r={13} fill={HOST_SKIN} stroke={INK} strokeWidth={1.5} />}
        {arms.cashTag && <text x={arms.rightHand[0] + 2} y={arms.rightHand[1] - 18} fontSize={20} fontWeight="bold" fill={BRAND_RED} stroke={INK} strokeWidth={0.5} textAnchor="middle">R$</text>}

        {/* head */}
        <g transform={`translate(${headBobY * 0.3}, ${-78 + headBobY}) rotate(${headBobRotate})`}>
          {/* hair — curly cluster behind/around the head silhouette */}
          <path
            d="M -50,-8 Q -58,-48 -30,-62 Q -34,-74 -12,-78 Q 4,-88 22,-78 Q 44,-76 48,-56 Q 60,-46 50,-16 Q 54,-2 46,10 Q 50,-30 34,-42 Q 30,-30 16,-38 Q 6,-46 -2,-38 Q -12,-44 -20,-36 Q -32,-40 -36,-28 Q -46,-22 -44,-6 Q -50,2 -50,-8 Z"
            fill={HOST_HAIR}
          />
          {/* curl texture bumps along the hairline */}
          {[-40, -26, -10, 6, 22, 38].map((cx, i) => (
            <circle key={i} cx={cx} cy={i % 2 === 0 ? -58 : -64} r={9} fill={HOST_HAIR} />
          ))}

          <circle cx={0} cy={0} r={52} fill={HOST_SKIN} stroke={HOST_HAIR} strokeWidth={2} />

          {!arms.facepalm && (
            <>
              {/* beard: jaw shadow + mustache, mouth area cut out so mouth animation stays visible */}
              <path d="M -40,10 Q -44,38 -20,48 Q 0,54 20,48 Q 44,38 40,10 Q 44,26 30,34 Q 16,42 0,42 Q -16,42 -30,34 Q -44,26 -40,10 Z" fill={HOST_BEARD} />
              <path d="M -18,6 Q -8,2 0,6 Q 8,2 18,6 Q 10,10 0,9 Q -10,10 -18,6 Z" fill={HOST_BEARD} />

              <path d={face.leftBrow} stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill="none" />
              <path d={face.rightBrow} stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill="none" />

              {/* round glasses */}
              <circle cx={-18} cy={-6} r={15} fill="none" stroke={GLASSES_WHITE} strokeWidth={4} />
              <circle cx={18} cy={-6} r={15} fill="none" stroke={GLASSES_WHITE} strokeWidth={4} />
              <line x1={-3} y1={-6} x2={3} y2={-6} stroke={GLASSES_WHITE} strokeWidth={4} />
              <line x1={-33} y1={-8} x2={-42} y2={-10} stroke={GLASSES_WHITE} strokeWidth={3} strokeLinecap="round" />
              <line x1={33} y1={-8} x2={42} y2={-10} stroke={GLASSES_WHITE} strokeWidth={3} strokeLinecap="round" />

              {isBlinking ? (
                <>
                  <line x1={-25} y1={-6} x2={-11} y2={-6} stroke={INK} strokeWidth={3} strokeLinecap="round" />
                  <line x1={11} y1={-6} x2={25} y2={-6} stroke={INK} strokeWidth={3} strokeLinecap="round" />
                </>
              ) : (
                <>
                  <path d={face.leftEye} stroke={INK} strokeWidth={4} strokeLinecap="round" fill={INK} />
                  <path d={face.rightEye} stroke={INK} strokeWidth={4} strokeLinecap="round" fill={INK} />
                </>
              )}

              <g transform={`translate(0, 22) scale(1, ${talkScale}) translate(0, -22)`}>
                <path d={face.mouth} stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill={pose === "RINDO" ? INK : "none"} />
              </g>
            </>
          )}
          {arms.facepalm && <circle cx={5} cy={-4} r={14} fill={HOST_SKIN} stroke={INK} strokeWidth={1.5} />}
        </g>
      </svg>
    </div>
  );
};
