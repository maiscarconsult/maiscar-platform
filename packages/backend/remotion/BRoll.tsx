/**
 * MOTION KIT — real B-roll clip (2026-09-11). Cover-cropped to 1080x1920,
 * with a subtle continuous push-in (dolly-in) so even a single shot never
 * reads as a totally static composition — cuts between clips (every
 * ~1-1.8s per the V3 spec) are handled by the caller's <Sequence> slicing.
 */
import React from "react";
import { AbsoluteFill, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export interface BRollProps {
  src: string;
  /** Where in the source clip to start reading from (loops handled by caller trimming). */
  startFromSec?: number;
  /** "PUSH_IN" (default) or "STATIC" for a rare deliberately still beat (e.g. under a big-number overlay). */
  camera?: "PUSH_IN" | "PUSH_OUT" | "STATIC";
}

export const BRoll: React.FC<BRollProps> = ({ src, startFromSec = 0, camera = "PUSH_IN" }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  let scale = 1;
  if (camera === "PUSH_IN") scale = interpolate(frame, [0, durationInFrames], [1, 1.12]);
  if (camera === "PUSH_OUT") scale = interpolate(frame, [0, durationInFrames], [1.12, 1]);

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <div style={{ width: "100%", height: "100%", transform: `scale(${scale})`, transformOrigin: "center" }}>
        <OffthreadVideo
          src={src}
          startFrom={Math.round(startFromSec * fps)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          muted
        />
      </div>
    </AbsoluteFill>
  );
};
