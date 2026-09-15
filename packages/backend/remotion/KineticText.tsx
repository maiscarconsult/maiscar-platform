/**
 * MOTION KIT — kinetic text (2026-09-11). A short keyword/number pops in
 * synced to the spoken word (tolerance ~0.3s is enforced by the caller
 * placing this inside a tightly-timed <Sequence>, not by this component).
 * Pure spring/interpolate animation, 0 LLM.
 */
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export interface KineticTextProps {
  text: string;
  /** "BIG_NUMBER" gets an oversized treatment for pattern-interrupt beats. */
  variant?: "NORMAL" | "BIG_NUMBER";
  /** KINETIC_TEXT_SAFE_ZONE (buyer-pain-v2): vertical anchor, chosen by the
   *  caller to avoid the host's real position/size for this beat — never
   *  left to overlap by chance. Defaults match the pre-existing behavior. */
  position?: "TOP" | "CENTER" | "BOTTOM";
}

const POSITION_TOP: Record<"TOP" | "CENTER" | "BOTTOM", string> = { TOP: "12%", CENTER: "38%", BOTTOM: "62%" };

export const KineticText: React.FC<KineticTextProps> = ({ text, variant = "NORMAL", position }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 180, mass: 0.6 } });
  const scale = interpolate(pop, [0, 1], [0.4, 1]);
  const opacity = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: "clamp" });
  const fontSize = variant === "BIG_NUMBER" ? 160 : 96;
  const top = position ? POSITION_TOP[position] : variant === "BIG_NUMBER" ? "38%" : "62%";

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        display: "flex",
        justifyContent: "center",
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: "Impact, 'Arial Black', sans-serif",
          fontSize,
          color: "white",
          WebkitTextStroke: "5px black",
          paintOrder: "stroke fill",
          textAlign: "center",
          padding: "0 40px",
          lineHeight: 1,
        }}
      >
        {text.toUpperCase()}
      </div>
    </div>
  );
};
