import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import type { AgentState } from "../domain/status";

const assetVersion = "20260630-standby-scale-1";

const frame = (state: AgentState, index: number) =>
  `/assets/pet-frames/${state}-${String(index).padStart(2, "0")}.png?v=${assetVersion}`;

const petFrames: Record<AgentState, string[]> = {
  standby: [1, 2, 3, 4, 5, 6, 7, 8].map((index) => frame("standby", index)),
  working: [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 4, 4, 3, 3, 2, 2].map((index) =>
    frame("working", index),
  ),
  completed: [1, 2, 3, 4, 5, 6].map((index) => frame("completed", index)),
  attention: [1, 1, 2, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2].map((index) =>
    frame("attention", index),
  ),
};

const frameDelay: Record<AgentState, number> = {
  standby: 165,
  working: 420,
  completed: 190,
  attention: 420,
};

const hardwareBlocks: Record<AgentState, string> = {
  standby: `/assets/hardware-cube-standby.png?v=${assetVersion}`,
  working: `/assets/hardware-cube-working.png?v=${assetVersion}`,
  completed: `/assets/hardware-cube-completed.png?v=${assetVersion}`,
  attention: `/assets/hardware-cube-attention.png?v=${assetVersion}`,
};

let preloadStarted = false;

function preloadPetAssets() {
  if (preloadStarted) {
    return;
  }
  preloadStarted = true;

  const urls = new Set<string>();
  for (const state of Object.keys(petFrames) as AgentState[]) {
    for (const src of petFrames[state]) {
      urls.add(src);
    }
    urls.add(hardwareBlocks[state]);
  }

  for (const src of urls) {
    const image = new Image();
    image.decoding = "async";
    image.src = src;
  }
}

interface AgentPetProps {
  state: AgentState;
  speed: number;
  onOpenSettings: () => void;
  onAcknowledge: () => void;
  onStartWindowDrag: () => void;
  onWindowMoveEnd: () => void;
  showHardwareBlock: boolean;
}

export const AgentPet = memo(function AgentPet({
  state,
  speed,
  onOpenSettings,
  onAcknowledge,
  onStartWindowDrag,
  onWindowMoveEnd,
  showHardwareBlock,
}: AgentPetProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    moved: boolean;
    dragRequested: boolean;
  } | null>(null);
  const currentFrames = petFrames[state];

  useEffect(() => {
    preloadPetAssets();
  }, []);

  useEffect(() => {
    setFrameIndex(0);
    const delay = Math.max(110, Math.round((frameDelay[state] * speed) / 760));
    let frameId = 0;
    let lastTick = performance.now();

    const tick = (now: number) => {
      if (now - lastTick >= delay) {
        lastTick = now;
        setFrameIndex((currentIndex) => (currentIndex + 1) % currentFrames.length);
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [currentFrames.length, speed, state]);

  return (
    <div className="pet-stage">
      <button
        className={`pet pet--${state} ${showHardwareBlock ? "" : "pet--top-docked"}`}
        style={
          {
            "--motion-speed": `${speed}ms`,
          } as CSSProperties
        }
        type="button"
        aria-label={state === "completed" ? "确认已完成并回到待命" : "打开桌宠控制台"}
        onPointerDown={(event) => {
          dragStartRef.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            moved: false,
            dragRequested: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = dragStartRef.current;
          if (!start) {
            return;
          }
          const deltaX = event.clientX - start.pointerX;
          const deltaY = event.clientY - start.pointerY;
          if ((Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) && !start.dragRequested) {
            start.moved = true;
            start.dragRequested = true;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            onStartWindowDrag();
          }
        }}
        onPointerUp={(event) => {
          const start = dragStartRef.current;
          dragStartRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (start?.moved) {
            onWindowMoveEnd();
            return;
          }
          if (state === "completed") {
            onAcknowledge();
            return;
          }
          onOpenSettings();
        }}
        onPointerCancel={(event) => {
          dragStartRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          onWindowMoveEnd();
        }}
      >
        <span
          className={`hardware-block ${showHardwareBlock ? "is-visible" : ""}`}
          aria-hidden="true"
        >
          <img className="hardware-block__image" src={hardwareBlocks[state]} alt="" draggable={false} decoding="async" />
          <span className="hardware-block__flash" aria-hidden="true" />
        </span>
        <span className="pet__rig">
          <span className="pet__shadow" aria-hidden="true" />
          <span className="pet__sprite-wrap" aria-hidden="true">
            <img
              className="pet__sprite"
              src={currentFrames[frameIndex % currentFrames.length]}
              alt=""
              draggable={false}
              decoding="async"
            />
          </span>
          <span className="pet__impact" aria-hidden="true" />
        </span>
      </button>
    </div>
  );
});
