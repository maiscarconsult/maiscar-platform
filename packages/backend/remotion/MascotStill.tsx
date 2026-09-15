/**
 * MASCOT_STILL (MAISCAR_AVATAR_NARRATED_REEL_MASTER) — a single-frame,
 * transparent-background composition used only to render the avatar as a
 * standalone PNG for compositing onto the REEL_COVER image (via sharp) —
 * the video timeline never uses this, only remotionRenderer's
 * renderMascotStillPng(). Same Mascot.tsx component as the video, so the
 * cover avatar and the in-video avatar are always visually identical.
 */
import React from "react";
import { AbsoluteFill } from "remotion";
import { TalkingHost } from "./TalkingHost";
import { MascotPose } from "./types";

export interface MascotStillProps {
  pose: MascotPose;
  size: number;
}

export const MascotStill: React.FC<MascotStillProps> = ({ pose, size }) => {
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <TalkingHost pose={pose} size={size} talking={false} />
    </AbsoluteFill>
  );
};
