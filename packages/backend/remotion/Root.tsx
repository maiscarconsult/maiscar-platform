import React from "react";
import { Composition } from "remotion";
import { NarratedMotionReelV3 } from "./NarratedMotionReelV3";
import { MascotStill, MascotStillProps } from "./MascotStill";
import { NarratedReelV3Props } from "./types";

const DEFAULT_PROPS: NarratedReelV3Props = { blocks: [], fps: 30 };
const DEFAULT_MASCOT_STILL_PROPS: MascotStillProps = { pose: "INDIGNADO", size: 700 };

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="NarratedMotionReelV3"
        component={NarratedMotionReelV3}
        durationInFrames={30 * 30}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_PROPS}
        calculateMetadata={async ({ props }) => {
          const fps = props.fps ?? 30;
          const totalSec = props.blocks.reduce((sum, b) => Math.max(sum, b.startSec + b.durationSec), 0);
          return { durationInFrames: Math.max(1, Math.round(totalSec * fps)), fps };
        }}
      />
      {/* MASCOT_STILL — renders one transparent-background avatar frame for
          REEL_COVER compositing (see remotionRenderer.renderMascotStillPng). */}
      {/* durationInFrames > 1 on purpose: Mascot.tsx's own entrance
          animation (entranceProgress = interpolate(frame, [0,8], [0,1]))
          means frame 0 renders fully invisible/scaled-to-zero — a real bug
          that shipped a blank cover once already. renderMascotStillPng()
          renders a later frame (past the 8-frame entrance ramp) instead. */}
      <Composition
        id="MascotStill"
        component={MascotStill}
        durationInFrames={20}
        fps={30}
        width={900}
        height={1215}
        defaultProps={DEFAULT_MASCOT_STILL_PROPS}
      />
    </>
  );
};
