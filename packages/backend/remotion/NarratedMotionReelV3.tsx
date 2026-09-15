/**
 * MAISCAR_NARRATED_MOTION_REEL_V3 root composition (2026-09-11). Reads a
 * TIMED_SCRIPT (built deterministically by narratedMotionReelV3Cycle.ts from
 * real TTS durations — 0 LLM here) and lays out B-roll + kinetic text +
 * mascot + pattern interrupts + narration/music/SFX audio per block.
 */
import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { BRoll } from "./BRoll";
import { ScreenEvidence } from "./ScreenEvidence";
import { KineticText } from "./KineticText";
import { TalkingHost } from "./TalkingHost";
import { NarratedReelV3Props, MascotPosition } from "./types";
import { CSSProperties } from "react";

// HOST_SAFE_ZONE (owner-approved hardening, 2026-09-15): CENTER_SCREEN_AVATAR
// = FORBIDDEN, ALWAYS. Only the four corners are legal for the mascot in
// a Reel. CENTER and FOREGROUND_LEFT/RIGHT are ALIASED here to a corner
// so any legacy TimedBlock still on disk renders in a legal zone instead
// of drifting toward the middle of frame. The center of frame belongs to
// the CONTENT (car / part / document / big number / real evidence),
// never to the host. Pattern interrupt is a visual event (new B-roll,
// big number, macro, freeze, crop) — not an avatar promotion.
const CORNER_STYLE = {
  BOTTOM_RIGHT: { justifyContent: "flex-end", alignItems: "flex-end", padding: 48 } as CSSProperties,
  BOTTOM_LEFT: { justifyContent: "flex-start", alignItems: "flex-end", padding: 48 } as CSSProperties,
  TOP_RIGHT: { justifyContent: "flex-end", alignItems: "flex-start", padding: 48 } as CSSProperties,
  TOP_LEFT: { justifyContent: "flex-start", alignItems: "flex-start", padding: 48 } as CSSProperties,
};
const MASCOT_POSITION_STYLE: Record<MascotPosition, CSSProperties> = {
  BOTTOM_RIGHT: CORNER_STYLE.BOTTOM_RIGHT,
  BOTTOM_LEFT: CORNER_STYLE.BOTTOM_LEFT,
  TOP_RIGHT: CORNER_STYLE.TOP_RIGHT,
  TOP_LEFT: CORNER_STYLE.TOP_LEFT,
  // Illegal-in-a-Reel positions — the Record<MascotPosition,...> type
  // forces all keys; runtime coerceCorner() below ensures none of these
  // ever actually reach the DOM.
  CENTER: CORNER_STYLE.BOTTOM_RIGHT,
  FOREGROUND_LEFT: CORNER_STYLE.BOTTOM_LEFT,
  FOREGROUND_RIGHT: CORNER_STYLE.BOTTOM_RIGHT,
};
const CORNER_KEYS: readonly MascotPosition[] = ["BOTTOM_RIGHT", "BOTTOM_LEFT", "TOP_RIGHT", "TOP_LEFT"];
function coerceCorner(p: MascotPosition | undefined): MascotPosition {
  return p && (CORNER_KEYS as readonly string[]).includes(p) ? p : "BOTTOM_RIGHT";
}
// AVATAR_SIZE_CEILING (owner-approved, 2026-09-15): a reaction beat may
// grow the mascot to at most 1.35× the base size (~28% of the 1920px
// canonical height, still inside the 25-32% target). No pattern-interrupt
// beat is ever allowed to lift the mascot past this — a bigger visual
// event uses B-roll or text, not a bigger avatar.
const MAX_MASCOT_SCALE = 1.35;

// CONTENT_SAFE_ZONE = central 55-65% stays free. ~21% of the 1920px-tall
// canonical canvas at mascotScale=1 (15-25% target range), ~28% at
// mascotScale=1.35 (reaction beats, within the 25-32% target) — scaled by
// Remotion's own render `scale` option for a low-quality preview, so
// these px values stay correct either way.
const BASE_HOST_SIZE = 300;

const PatternInterruptFlash: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 2, 6], [0.85, 0.4, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ backgroundColor: "white", opacity }} />;
};

export const NarratedMotionReelV3: React.FC<NarratedReelV3Props> = ({ blocks, narrationSrc, musicSrc, fps }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* MAISCAR_VOICE_LOCK: ONE narration file spans the whole timeline —
          never a per-block Audio element, so a second/different voice
          config physically cannot appear mid-video. */}
      <Audio src={staticFile(narrationSrc)} />
      {musicSrc && <Audio src={staticFile(musicSrc)} volume={0.12} />}
      {blocks.map((block) => {
        const startFrame = Math.round(block.startSec * fps);
        const durationInFrames = Math.max(1, Math.round(block.durationSec * fps));
        const keywordOffsetFrames = Math.round((block.keywordOffsetSec ?? 0.15) * fps);
        const keywordDurationFrames = Math.min(durationInFrames - keywordOffsetFrames, Math.round(1.1 * fps));

        const cutFrames = Math.max(1, Math.floor(durationInFrames / block.videoCuts.length));

        // P0-2/P0-3 (2026-09-15) — if the beat carries screenEvidence, render
        // the phone-frame in place of the Pexels B-roll cuts. If beat 0
        // carries hookBlock, slam its firstOnScreenText onto the first 15
        // frames as full-width text and skip the mascot for that window.
        const hookSlamFrames = block.hookBlock ? Math.min(15, durationInFrames) : 0;
        return (
          <Sequence key={block.id} from={startFrame} durationInFrames={durationInFrames} name={block.id}>
            {block.screenEvidence ? (
              <ScreenEvidence
                template={block.screenEvidence.template}
                values={block.screenEvidence.values}
                highlight={block.screenEvidence.highlight}
              />
            ) : (
              block.videoCuts.map((cut, cutIndex) => {
                const cutFrom = cutIndex * cutFrames;
                const cutDuration = cutIndex === block.videoCuts.length - 1 ? durationInFrames - cutFrom : cutFrames;
                return (
                  <Sequence key={cutIndex} from={cutFrom} durationInFrames={cutDuration}>
                    <BRoll src={staticFile(cut.src)} startFromSec={cut.startFromSec} camera={cut.camera} />
                  </Sequence>
                );
              })
            )}
            {block.hookBlock && hookSlamFrames > 0 && (
              <Sequence from={0} durationInFrames={hookSlamFrames}>
                <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 60, background: "rgba(0,0,0,0.35)" }}>
                  <div style={{ color: "#fff", fontFamily: "Bebas Neue, Impact, system-ui, sans-serif", fontSize: 128, fontWeight: 900, textAlign: "center", lineHeight: 1.05, textShadow: "0 6px 20px rgba(0,0,0,0.7)" }}>
                    {block.hookBlock.firstOnScreenText}
                  </div>
                </AbsoluteFill>
              </Sequence>
            )}
            {block.sfx && (
              <Sequence from={Math.round((block.sfx.offsetSec ?? 0) * fps)} durationInFrames={Math.round(0.6 * fps)}>
                <Audio src={staticFile(block.sfx.src)} volume={0.5} />
              </Sequence>
            )}
            {block.patternInterrupt && <PatternInterruptFlash />}
            {block.keyword && keywordDurationFrames > 0 && (
              <Sequence from={keywordOffsetFrames} durationInFrames={keywordDurationFrames}>
                <KineticText text={block.keyword} variant={block.keywordVariant} position={block.keywordTextPosition} />
              </Sequence>
            )}
            {block.mascotPose && (
              <Sequence from={hookSlamFrames} durationInFrames={Math.max(1, durationInFrames - hookSlamFrames)}>
                <AbsoluteFill style={MASCOT_POSITION_STYLE[coerceCorner(block.mascotPosition)]}>
                  <TalkingHost
                    pose={block.mascotPose}
                    punchIn={block.mascotPunchIn}
                    enterFrom={block.mascotEnterFrom}
                    size={BASE_HOST_SIZE * Math.min(MAX_MASCOT_SCALE, block.mascotScale ?? 1)}
                  />
                </AbsoluteFill>
              </Sequence>
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
