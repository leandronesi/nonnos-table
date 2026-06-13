/**
 * StanzaScene — the real-time WebGL room (Onda P4).
 *
 * One table under one lamp, at night. Real light (spotlight with soft
 * shadows), real depth (fog), real materials (procedural walnut, turned
 * pieces), and a camera that SITS DOWN at the table when you arrive.
 *
 * Everything on the table is driven by real user data passed as props;
 * objects without data are simply not in the room.
 *
 * DOM stays outside: dialogue, exit link and vignette live in StanzaHome.
 * This file is lazy-loaded so three.js never touches the main bundle.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Pezzo, PezziFromFen, type PieceKind } from "./Pezzi";
import {
  woodTexture,
  boardTexture,
  paperTexture,
  cardTexture,
  letterTexture,
  steamTexture,
  plaqueTexture,
} from "./textures";
import { tr } from "../../i18n/lang";

// ── Props from StanzaHome (all real data) ──────────────────────────────────────

export interface StanzaSceneProps {
  /** FEN of the momento position; null hides the board. */
  fen: string | null;
  /** Played (red) and best (green) moves as [from, to] square names. */
  playedMove: [string, string] | null;
  bestMove: [string, string] | null;
  /** Board orientation: user color. */
  orientation: "white" | "black";
  /** Handicap ladder steps (5 regina .. 1 pedone); null hides the pieces. */
  handicap: { initialStep: number; currentStep: number } | null;
  /** Notebook lines (real milestones) + gold target line. */
  notebookLines: string[];
  notebookGold: string | null;
  showNotebook: boolean;
  /** Thorn box card words (top anchors, 1 word each). */
  thorns: string[];
  /** Fresh letter on the table. */
  showLetter: boolean;
  /** Reduced motion: camera starts seated, no drift, no steam animation. */
  reducedMotion: boolean;
  /**
   * Breathing affordance on the board: a slow sinusoidal scale pulse that
   * signals "this is alive, touch it" before the first interaction.
   * Disabled once the user has visited the board (StanzaHome gates it).
   * Ignored when reducedMotion is true.
   */
  boardBreathing: boolean;
  /** Object navigation — the room IS the menu. */
  onBoardClick?: () => void;
  onNotebookClick?: () => void;
  onBoxClick?: () => void;
  onLetterClick?: () => void;
  /** Controlled focus: StanzaHome owns it (Escape and the DOM chip drive it too). */
  focus: Focus;
  onFocusRequest: (focus: Focus) => void;
}

// ── Gli sguardi: where the camera can lean ─────────────────────────────────────

export type Focus = "tavolo" | "scacchiera" | "quaderno" | "scatola";

const FOCI: Record<Focus, { pos: THREE.Vector3; tgt: THREE.Vector3; minD: number; maxD: number }> = {
  tavolo:     { pos: new THREE.Vector3(0, 1.42, 2.95),     tgt: new THREE.Vector3(0, 0.18, -0.15),    minD: 1.6, maxD: 4.6 },
  scacchiera: { pos: new THREE.Vector3(-0.28, 1.18, 1.5),  tgt: new THREE.Vector3(-0.28, 0.08, 0.1),  minD: 0.7, maxD: 3.2 },
  quaderno:   { pos: new THREE.Vector3(1.38, 0.95, 1.5),   tgt: new THREE.Vector3(1.52, 0.02, 0.62),  minD: 0.5, maxD: 2.6 },
  scatola:    { pos: new THREE.Vector3(-1.35, 0.85, 0.4),  tgt: new THREE.Vector3(-1.55, 0.08, -0.55), minD: 0.5, maxD: 2.6 },
};

// ── Camera rig: sit down, then glide between gli sguardi ──────────────────────

const ENTER_POS = new THREE.Vector3(0, 2.6, 5.6);
const LOOK_AT = FOCI.tavolo.tgt;

/** Coarse pointer = phone/tablet: lighter shadows, capped DPR. */
const COARSE =
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;

/**
 * useMemo + dispose-on-unmount for GPU resources (textures, geometries).
 * Without this every visit to /stanza would strand its canvas textures in
 * GPU memory — ~12MB per entry, fatal on low-end mobile after a few laps.
 */
function useDisposable<T extends { dispose: () => void }>(
  make: () => T,
  deps: React.DependencyList,
): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const res = useMemo(make, deps);
  useEffect(() => {
    return () => {
      res.dispose();
    };
  }, [res]);
  return res;
}

/**
 * One rig owns the camera life:
 *   entering — 3s dolly to the chair (the act of sitting down)
 *   gliding  — 1.6s pursuit toward the focused object (controls disabled)
 *   free     — OrbitControls active around the current focus target
 */
function CameraRig({
  reducedMotion,
  focus,
  onSeated,
}: {
  reducedMotion: boolean;
  focus: Focus;
  onSeated: () => void;
}) {
  const { camera, controls, size } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: { target: THREE.Vector3; enabled: boolean; minDistance: number; maxDistance: number; update: () => void } | null;
    size: { width: number; height: number };
  };
  const t0 = useRef<number | null>(null);
  const seated = useRef(false);
  const prevFocus = useRef<Focus>("tavolo");
  const glideUntil = useRef(0);

  // Portrait phones see the same room from a little further back and wider,
  // otherwise the table overflows the frame on both sides.
  const portrait = size.height > size.width;
  const prevPortrait = useRef(portrait);
  const back = portrait ? 1.4 : 1;
  const wantFov = portrait ? 54 : 42;
  if (camera.fov !== wantFov) {
    camera.fov = wantFov;
    camera.updateProjectionMatrix();
  }
  // Scratch vectors: useFrame runs at 60fps, allocating clones there is GC churn.
  const scratch = useRef(new THREE.Vector3()).current;
  const focusPosInto = (f: (typeof FOCI)[Focus], out: THREE.Vector3) =>
    out.copy(f.pos).sub(f.tgt).multiplyScalar(back).add(f.tgt);

  useFrame((state) => {
    const now = state.clock.elapsedTime;

    // 1) Sitting down
    if (!seated.current) {
      focusPosInto(FOCI.tavolo, scratch);
      if (reducedMotion) {
        camera.position.copy(scratch);
        camera.lookAt(LOOK_AT);
        seated.current = true;
        onSeated();
        return;
      }
      if (t0.current === null) t0.current = now;
      const k = Math.min((now - t0.current) / 3.0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(ENTER_POS, scratch, e);
      camera.lookAt(LOOK_AT);
      if (k >= 1) {
        seated.current = true;
        onSeated();
      }
      return;
    }

    if (!controls) return;
    const f = FOCI[focus];

    // 2) A new sguardo (or the phone rotated): retune the rails
    if (focus !== prevFocus.current || portrait !== prevPortrait.current) {
      const focusChanged = focus !== prevFocus.current;
      prevFocus.current = focus;
      prevPortrait.current = portrait;
      controls.minDistance = f.minD;
      controls.maxDistance = f.maxD * back;
      if (focusChanged) {
        glideUntil.current = now + (reducedMotion ? 0 : 1.6);
        if (reducedMotion) {
          focusPosInto(f, scratch);
          camera.position.copy(scratch);
          controls.target.copy(f.tgt);
          controls.update();
        }
      }
    }

    // 3) Glide: pursue the preset, hands off the wheel
    if (now < glideUntil.current) {
      controls.enabled = false;
      focusPosInto(f, scratch);
      camera.position.lerp(scratch, 0.065);
      controls.target.lerp(f.tgt, 0.065);
      controls.update();
    } else {
      controls.enabled = true;
    }
  });
  return null;
}

// ── Inspection light: when you lean over an object, the light leans with you ──

function FocusLight({ focus }: { focus: Focus }) {
  const ref = useRef<THREE.PointLight>(null);
  // Scratch vector: no per-frame allocation in useFrame.
  const want = useRef(new THREE.Vector3()).current;
  useFrame(() => {
    if (!ref.current) return;
    const f = FOCI[focus];
    const wantIntensity = focus === "tavolo" ? 0 : 4.2;
    want.set(f.tgt.x, f.tgt.y + 1.05, f.tgt.z + 0.3);
    ref.current.position.lerp(want, 0.08);
    ref.current.intensity += (wantIntensity - ref.current.intensity) * 0.08;
  });
  return (
    <pointLight
      ref={ref}
      position={[0, 1.2, 0.3]}
      intensity={0}
      distance={3.2}
      decay={2}
      color="#ffdcae"
    />
  );
}

// ── The lamp: visible body + the one true light of the room ───────────────────

function Lampada() {
  return (
    <group position={[0, 0, 0]}>
      {/* Cord */}
      <mesh position={[0, 2.6, 0]}>
        <cylinderGeometry args={[0.004, 0.004, 1.6, 6]} />
        <meshStandardMaterial color="#0a0a0c" roughness={0.9} />
      </mesh>
      {/* Shade (open cone) */}
      <mesh position={[0, 1.82, 0]}>
        <coneGeometry args={[0.42, 0.34, 48, 1, true]} />
        <meshStandardMaterial
          color="#16110b"
          roughness={0.6}
          metalness={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Glowing inner disc — the bulb you almost see */}
      <mesh position={[0, 1.66, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.3, 32]} />
        <meshBasicMaterial color="#ffd9a0" toneMapped={false} transparent opacity={0.85} />
      </mesh>
      {/* The light itself — lighter shadow map on coarse-pointer devices */}
      <spotLight
        position={[0, 1.75, 0]}
        angle={0.62}
        penumbra={0.85}
        intensity={42}
        distance={9}
        decay={1.4}
        color="#ffd9a8"
        castShadow
        shadow-mapSize-width={COARSE ? 1024 : 2048}
        shadow-mapSize-height={COARSE ? 1024 : 2048}
        shadow-bias={-0.0004}
      />
      {/* Warm fill so blacks don't clip to void */}
      <pointLight position={[0, 1.3, 1.2]} intensity={1.6} color="#c9b18a" decay={1.8} />
    </group>
  );
}

// ── The table ──────────────────────────────────────────────────────────────────

function Tavolo({ onClick }: { onClick?: () => void }) {
  const wood = useDisposable(() => woodTexture(), []);
  return (
    <mesh
      position={[0, -0.1, 0]}
      receiveShadow
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <boxGeometry args={[7.2, 0.2, 3.8]} />
      <meshStandardMaterial map={wood} roughness={0.62} metalness={0.04} />
    </mesh>
  );
}

// ── The board with frame, pieces and move arrows ──────────────────────────────

const SQUARE = 0.185;
const BOARD_W = SQUARE * 8;

function sqToXZ(sq: string, flipped: boolean): [number, number] {
  let file = sq.charCodeAt(0) - 97;
  let rank = parseInt(sq[1], 10) - 1;
  if (flipped) {
    file = 7 - file;
    rank = 7 - rank;
  }
  return [(file - 3.5) * SQUARE, (3.5 - rank) * SQUARE];
}

function MoveArrow({
  from,
  to,
  color,
  flipped,
  y,
}: {
  from: string;
  to: string;
  color: string;
  flipped: boolean;
  y: number;
}) {
  const [x1, z1] = sqToXZ(from, flipped);
  const [x2, z2] = sqToXZ(to, flipped);
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz); // rotation around Y so +z aligns to the move
  const headLen = 0.11;
  const bodyLen = Math.max(len - headLen, 0.02);

  return (
    <group position={[x1, y, z1]} rotation={[0, angle, 0]}>
      {/* Shaft — a thin flat box hovering just above the squares */}
      <mesh position={[0, 0, bodyLen / 2]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.022, 0.004, bodyLen]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.85} />
      </mesh>
      {/* Head — a flat triangle lying on the board plane (no paper planes) */}
      <mesh position={[0, 0.001, bodyLen]} rotation={[-Math.PI / 2, 0, Math.PI]} geometry={arrowHeadGeo(headLen)}>
        <meshBasicMaterial
          color={color}
          toneMapped={false}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// Flat triangular arrowhead (a 2D shape, not a 3-segment cone).
// With mesh rotation [-PI/2, 0, PI] a shape point (x, y) maps to (-x, 0, y):
// the tip (0, len) lands at local z=len, i.e. exactly on the target square
// when the mesh sits at z=bodyLen (bodyLen + headLen = full move length).
const ARROW_HEADS = new Map<number, THREE.ShapeGeometry>();
function arrowHeadGeo(len: number): THREE.ShapeGeometry {
  let g = ARROW_HEADS.get(len);
  if (!g) {
    const s = new THREE.Shape();
    s.moveTo(0, len);
    s.lineTo(-0.046, 0);
    s.lineTo(0.046, 0);
    s.closePath();
    g = new THREE.ShapeGeometry(s);
    ARROW_HEADS.set(len, g);
  }
  return g;
}

function Scacchiera({
  fen,
  playedMove,
  bestMove,
  orientation,
}: {
  fen: string;
  playedMove: [string, string] | null;
  bestMove: [string, string] | null;
  orientation: "white" | "black";
}) {
  const squares = useDisposable(() => boardTexture(), []);
  const flipped = orientation === "black";

  return (
    <group position={[-0.28, 0, 0.1]} rotation={[0, 0.06, 0]}>
      {/* Frame */}
      <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
        <boxGeometry args={[BOARD_W + 0.14, 0.07, BOARD_W + 0.14]} />
        <meshStandardMaterial color="#1c1209" roughness={0.5} />
      </mesh>
      {/* Squares */}
      <mesh position={[0, 0.0705, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[BOARD_W, BOARD_W]} />
        <meshStandardMaterial map={squares} roughness={0.55} />
      </mesh>
      {/* Pieces — group flips for black orientation so the user side faces camera */}
      <group rotation={[0, flipped ? Math.PI : 0, 0]}>
        <PezziFromFen fen={fen} square={SQUARE} y={0.071} />
      </group>
      {/* Arrows (computed in display space, so outside the flipped group) */}
      {playedMove && (
        <MoveArrow from={playedMove[0]} to={playedMove[1]} color="#ef4444" flipped={flipped} y={0.078} />
      )}
      {bestMove && (
        <MoveArrow from={bestMove[0]} to={bestMove[1]} color="#22c55e" flipped={flipped} y={0.082} />
      )}
    </group>
  );
}

// ── The handicap: returned pieces LIE on the wood, what remains STANDS ─────────

const STEP_PIECES: Record<number, PieceKind[]> = {
  5: ["q"],
  4: ["r"],
  3: ["b"],
  2: ["p", "p"],
  1: ["p"],
};

function Handicap({ initialStep, currentStep }: { initialStep: number; currentStep: number }) {
  const items: { kind: PieceKind; lying: boolean; idx: number }[] = [];
  let idx = 0;
  for (let step = initialStep; step >= 1; step--) {
    const lying = step > currentStep;
    for (const kind of STEP_PIECES[step] ?? []) {
      items.push({ kind, lying, idx: idx++ });
    }
  }
  return (
    <group position={[-1.62, 0, 0.78]} rotation={[0, 0.35, 0]}>
      {items.map((it) => (
        <Pezzo
          key={it.idx}
          kind={it.kind}
          white
          position={[it.idx * 0.17, it.lying ? 0.052 : 0, 0]}
          // Lying on its side: returned to the Nonno, one evening at a time.
          rotation={it.lying ? [0, 0, Math.PI / 2 + 0.06 * it.idx] : undefined}
          scale={1.05}
        />
      ))}
    </group>
  );
}

// ── The notebook (+ glasses, + letter) ─────────────────────────────────────────

function Quaderno({
  lines,
  gold,
  showLetter,
  onLetterClick,
}: {
  lines: string[];
  gold: string | null;
  showLetter: boolean;
  onLetterClick?: () => void;
}) {
  const paper = useDisposable(() => paperTexture(tr("Il nostro viaggio", "Our story"), lines, gold), [lines, gold]);
  const letter = useMemo(() => (showLetter ? letterTexture() : null), [showLetter]);
  useEffect(() => {
    return () => {
      letter?.dispose();
    };
  }, [letter]);

  return (
    <group position={[1.52, 0, 0.62]} rotation={[0, -0.22, 0]}>
      {/* Page lying on the wood */}
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow castShadow>
        <planeGeometry args={[0.98, 0.74]} />
        <meshStandardMaterial map={paper} roughness={0.85} />
      </mesh>
      {/* Glasses resting on the page, top-right */}
      <Occhiali position={[0.26, 0.018, -0.18]} />
      {/* Fresh letter tucked on the page corner — its own click, not the notebook's */}
      {letter && (
        <mesh
          position={[-0.3, 0.012, 0.24]}
          rotation={[-Math.PI / 2, 0, 0.26]}
          castShadow
          onClick={
            onLetterClick
              ? (e) => {
                  e.stopPropagation();
                  onLetterClick();
                }
              : undefined
          }
        >
          <planeGeometry args={[0.42, 0.27]} />
          <meshStandardMaterial map={letter} roughness={0.85} />
        </mesh>
      )}
    </group>
  );
}

function Occhiali({ position }: { position: [number, number, number] }) {
  const gold = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#b9a87c", metalness: 0.85, roughness: 0.32 }),
    [],
  );
  return (
    <group position={position} rotation={[0, 0.5, 0]}>
      {/* Lenses (rims) lying flat */}
      <mesh material={gold} position={[-0.065, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.052, 0.0035, 10, 36]} />
      </mesh>
      <mesh material={gold} position={[0.065, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.052, 0.0035, 10, 36]} />
      </mesh>
      {/* Bridge */}
      <mesh material={gold} position={[0, 0, -0.01]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.0035, 0.0035, 0.026, 8]} />
      </mesh>
      {/* Folded temple arms */}
      <mesh material={gold} position={[-0.11, 0.004, 0.07]} rotation={[Math.PI / 2.2, 0, 0]}>
        <cylinderGeometry args={[0.003, 0.003, 0.16, 8]} />
      </mesh>
      <mesh material={gold} position={[0.11, 0.004, 0.07]} rotation={[Math.PI / 2.2, 0, 0]}>
        <cylinderGeometry args={[0.003, 0.003, 0.16, 8]} />
      </mesh>
    </group>
  );
}

// ── The cup, with living steam ─────────────────────────────────────────────────

const CUP_PROFILE: [number, number][] = [
  [0, 0], [0.075, 0], [0.082, 0.012], [0.072, 0.04], [0.078, 0.1], [0.085, 0.115],
];

function Tazza({ reducedMotion }: { reducedMotion: boolean }) {
  const cupGeo = useDisposable(() => {
    const pts = CUP_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, 36);
  }, []);
  const ceramic = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#c9c2b4", roughness: 0.35 }),
    [],
  );
  const steam = useDisposable(() => steamTexture(), []);
  const s1 = useRef<THREE.Mesh>(null);
  const s2 = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;
    if (s1.current) {
      s1.current.position.y = 0.24 + ((t * 0.07) % 0.3);
      const k = ((t * 0.07) % 0.3) / 0.3;
      (s1.current.material as THREE.MeshBasicMaterial).opacity = 0.16 * (1 - k);
      s1.current.position.x = Math.sin(t * 0.9) * 0.015;
    }
    if (s2.current) {
      const tt = t + 2.1;
      s2.current.position.y = 0.24 + ((tt * 0.055) % 0.3);
      const k = ((tt * 0.055) % 0.3) / 0.3;
      (s2.current.material as THREE.MeshBasicMaterial).opacity = 0.12 * (1 - k);
      s2.current.position.x = Math.sin(tt * 0.7) * 0.018;
    }
  });

  return (
    <group position={[0.92, 0, -0.42]}>
      {/* Saucer */}
      <mesh position={[0, 0.006, 0]} castShadow receiveShadow material={ceramic}>
        <cylinderGeometry args={[0.13, 0.14, 0.012, 36]} />
      </mesh>
      {/* Cup body */}
      <mesh geometry={cupGeo} material={ceramic} position={[0, 0.012, 0]} castShadow receiveShadow />
      {/* Coffee */}
      <mesh position={[0, 0.115, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.065, 28]} />
        <meshStandardMaterial color="#170c06" roughness={0.25} />
      </mesh>
      {/* Handle */}
      <mesh material={ceramic} position={[0.085, 0.07, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.032, 0.008, 10, 24, Math.PI]} />
      </mesh>
      {/* Steam — two soft billboarded blobs drifting up */}
      {!reducedMotion && (
        <>
          <Billboard>
            <mesh ref={s1} position={[0, 0.26, 0]}>
              <planeGeometry args={[0.09, 0.16]} />
              <meshBasicMaterial map={steam} transparent opacity={0.14} depthWrite={false} />
            </mesh>
          </Billboard>
          <Billboard>
            <mesh ref={s2} position={[0, 0.3, 0]}>
              <planeGeometry args={[0.07, 0.13]} />
              <meshBasicMaterial map={steam} transparent opacity={0.1} depthWrite={false} />
            </mesh>
          </Billboard>
        </>
      )}
    </group>
  );
}

// ── The thorn box ──────────────────────────────────────────────────────────────

function ScatolaSpine({ thorns }: { thorns: string[] }) {
  const woodDark = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#33200d", roughness: 0.52 }),
    [],
  );
  const cards = useMemo(() => thorns.slice(0, 3).map((w) => cardTexture(w)), [thorns]);
  useEffect(() => {
    return () => {
      cards.forEach((c) => c.dispose());
    };
  }, [cards]);
  const plaque = useDisposable(() => plaqueTexture(), []);

  const W = 0.46, D = 0.3, H = 0.16, T = 0.02;
  const YAW = 0.5; // group yaw — cards counter-rotate so they read frontally
  return (
    <group position={[-1.55, 0, -0.55]} rotation={[0, YAW, 0]}>
      {/* Bottom */}
      <mesh material={woodDark} position={[0, T / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[W, T, D]} />
      </mesh>
      {/* Walls */}
      <mesh material={woodDark} position={[0, H / 2, -D / 2 + T / 2]} castShadow>
        <boxGeometry args={[W, H, T]} />
      </mesh>
      <mesh material={woodDark} position={[0, H / 2, D / 2 - T / 2]} castShadow>
        <boxGeometry args={[W, H, T]} />
      </mesh>
      <mesh material={woodDark} position={[-W / 2 + T / 2, H / 2, 0]} castShadow>
        <boxGeometry args={[T, H, D]} />
      </mesh>
      <mesh material={woodDark} position={[W / 2 - T / 2, H / 2, 0]} castShadow>
        <boxGeometry args={[T, H, D]} />
      </mesh>
      {/* Cards: like notes pinned on a wall — they FACE the seat (counter the
          group yaw), standing upright with only a whisper of fan and lean */}
      {cards.map((tex, i) => (
        <mesh
          key={i}
          position={[-0.13 + i * 0.13, 0.17, (i - 1) * 0.015]}
          rotation={[-0.05, -YAW + (i - 1) * 0.08, 0]}
          castShadow
        >
          <planeGeometry args={[0.14, 0.18]} />
          <meshStandardMaterial map={tex} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* Paper tag GLUED to the front face of the box: same yaw as the box
          (no counter-rotation), just a whisper of lean — a label on a crate */}
      <mesh
        position={[0, 0.06, D / 2 + 0.012]}
        rotation={[-0.08, 0, 0]}
        castShadow
      >
        <planeGeometry args={[0.32, 0.09]} />
        <meshStandardMaterial map={plaque} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Clickable object wrapper: the room IS the menu ─────────────────────────────

function Cliccabile({
  onClick,
  children,
}: {
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const hover = useRef(false);

  useFrame(() => {
    if (!ref.current) return;
    const target = hover.current ? 1.02 : 1;
    const s = ref.current.scale.x + (target - ref.current.scale.x) * 0.14;
    ref.current.scale.setScalar(s);
  });

  if (!onClick) return <group>{children}</group>;
  return (
    <group
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        hover.current = true;
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        hover.current = false;
        document.body.style.cursor = "";
      }}
    >
      {children}
    </group>
  );
}

// ── Board wrapper with breathing affordance ────────────────────────────────────
//
// A slow sinusoidal scale (amplitude 1.5%, period ~4 s) makes the board feel
// alive under the lamp — "viva sotto la lampada", not a flashy pulse.
// The breath stops the moment the user first interacts, so it never competes
// with the lean/glide camera moves. Hover overrides it cleanly because
// Cliccabile targets scale 1.02 which wins over the 1.015 max of the breath.
//
// Constraints respected:
//   • transform only (no layout, no color change) — nonno-motion §2
//   • period 4 s → 0.25 Hz, well below the 2 Hz upper limit — nonno-motion §8
//   • amplitude 1.5 %: imperceptible as levitation, readable as life
//   • disabled when reducedMotion — the object stays at scale 1.

function CliccabileBoard({
  onClick,
  breathing,
  reducedMotion,
  children,
}: {
  onClick?: () => void;
  breathing: boolean;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const hover = useRef(false);
  const PERIOD = 4.0; // seconds per full cycle
  const AMPLITUDE = 0.015; // ±1.5 % — below the hover 1.02 ceiling

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const breathe =
      breathing && !reducedMotion
        ? 1 + AMPLITUDE * Math.sin((2 * Math.PI * t) / PERIOD)
        : 1;
    // Hover wins: target is 1.02 on hover, breathe value otherwise.
    const target = hover.current ? 1.02 : breathe;
    const s = ref.current.scale.x + (target - ref.current.scale.x) * 0.14;
    ref.current.scale.setScalar(s);
  });

  if (!onClick) return <group>{children}</group>;
  return (
    <group
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        hover.current = true;
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        hover.current = false;
        document.body.style.cursor = "";
      }}
    >
      {children}
    </group>
  );
}

// ── The room shell: wall + floor void ──────────────────────────────────────────

function Stanza3D(props: StanzaSceneProps & { focus: Focus; onObject: (f: Focus, navigate?: () => void) => void }) {
  const [seated, setSeated] = useState(false);
  const { focus, onObject } = props;

  return (
    <>
      <color attach="background" args={["#04060e"]} />
      <fog attach="fog" args={["#04060e", 5.2, 11]} />

      <CameraRig reducedMotion={props.reducedMotion} focus={focus} onSeated={() => setSeated(true)} />
      {/* Once seated, the chair is yours: drag to look around, scroll to lean in.
          Rails keep the scene unbreakable (never under the table, never past the wall).
          makeDefault registers the controls so the rig can drive their target. */}
      <OrbitControls
        makeDefault
        enabled={seated}
        target={[LOOK_AT.x, LOOK_AT.y, LOOK_AT.z]}
        enablePan={false}
        enableDamping
        dampingFactor={0.07}
        minDistance={1.6}
        maxDistance={4.6}
        minPolarAngle={0.55}
        maxPolarAngle={1.32}
        minAzimuthAngle={-0.85}
        maxAzimuthAngle={0.85}
      />
      {/* Lifted just enough that shadows stay shadows, not voids */}
      <hemisphereLight intensity={0.17} color="#2a3148" groundColor="#100a06" />
      <Lampada />
      {/* Lamp spill: the notebook corner and the box side get their share of warmth */}
      <pointLight position={[1.5, 1.15, 0.62]} intensity={2.8} distance={3} decay={2} color="#ffd2a0" />
      <pointLight position={[-1.5, 1.15, -0.35]} intensity={2.6} distance={3} decay={2} color="#e8c294" />
      {/* Leaning over an object brings the light with you */}
      <FocusLight focus={focus} />

      {/* Back wall, barely touched by the lamp */}
      <mesh position={[0, 1.4, -2.6]} receiveShadow>
        <planeGeometry args={[16, 7]} />
        <meshStandardMaterial color="#0a0e1a" roughness={0.95} />
      </mesh>

      {/* Clicking the bare wood brings you back to the seat */}
      <Tavolo onClick={() => onObject("tavolo")} />

      {props.fen && (
        <CliccabileBoard
          onClick={() => onObject("scacchiera", props.onBoardClick)}
          breathing={props.boardBreathing}
          reducedMotion={props.reducedMotion}
        >
          <Scacchiera
            fen={props.fen}
            playedMove={props.playedMove}
            bestMove={props.bestMove}
            orientation={props.orientation}
          />
        </CliccabileBoard>
      )}
      {props.handicap && (
        <Handicap
          initialStep={props.handicap.initialStep}
          currentStep={props.handicap.currentStep}
        />
      )}
      {props.showNotebook && (
        <Cliccabile onClick={() => onObject("quaderno", props.onNotebookClick)}>
          <Quaderno
            lines={props.notebookLines}
            gold={props.notebookGold}
            showLetter={props.showLetter}
            onLetterClick={props.onLetterClick}
          />
        </Cliccabile>
      )}
      <Tazza reducedMotion={props.reducedMotion} />
      {props.thorns.length > 0 && (
        <Cliccabile onClick={() => onObject("scatola", props.onBoxClick)}>
          <ScatolaSpine thorns={props.thorns} />
        </Cliccabile>
      )}
    </>
  );
}

// ── Public component: the Canvas ───────────────────────────────────────────────

export default function StanzaScene(props: StanzaSceneProps) {
  // The board is the declared shortcut: a single click enters its surface
  // (today's game review) straight away. Every other object leans the camera
  // first, then a second click (or the DOM chip) enters. Bare wood = back to seat.
  function handleObject(f: Focus, navigate?: () => void) {
    if (navigate && (f === "scacchiera" || f === props.focus)) {
      navigate();
      return;
    }
    props.onFocusRequest(f);
  }

  return (
    <Canvas
      shadows
      dpr={[1, COARSE ? 1.5 : 2]}
      camera={{ fov: 42, near: 0.1, far: 30, position: ENTER_POS.toArray() }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
      onPointerMissed={() => props.onFocusRequest("tavolo")}
      style={{ position: "absolute", inset: 0 }}
    >
      <Stanza3D {...props} onObject={handleObject} />
    </Canvas>
  );
}
