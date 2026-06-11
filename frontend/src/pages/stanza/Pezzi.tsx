/**
 * Pezzi.tsx — a turned (lathe) chess set for the WebGL Stanza.
 *
 * Modern minimal profiles (Bauhaus-leaning, not fake Staunton): every piece is
 * a LatheGeometry from a hand-drawn profile, except the knight, which gets a
 * stylized tilted head on a turned base. Ivory and dark walnut materials.
 *
 * `PezziFromFen` places the full set from a FEN string on a board of given
 * square size, centered on the group origin.
 */

import { useMemo } from "react";
import * as THREE from "three";

export type PieceKind = "p" | "r" | "n" | "b" | "q" | "k";

// ── Profiles: arrays of [radius, height] from base (y=0) to tip ───────────────

const PROFILES: Record<Exclude<PieceKind, "n">, [number, number][]> = {
  p: [
    [0, 0], [0.054, 0], [0.05, 0.012], [0.028, 0.045], [0.02, 0.085],
    [0.034, 0.105], [0.04, 0.125], [0.026, 0.148], [0, 0.158],
  ],
  r: [
    [0, 0], [0.06, 0], [0.055, 0.014], [0.038, 0.045], [0.034, 0.125],
    [0.05, 0.138], [0.05, 0.19], [0.04, 0.19], [0.038, 0.175], [0, 0.175],
  ],
  b: [
    [0, 0], [0.057, 0], [0.05, 0.014], [0.029, 0.05], [0.023, 0.115],
    [0.035, 0.148], [0.029, 0.19], [0.012, 0.222], [0, 0.238],
  ],
  q: [
    [0, 0], [0.063, 0], [0.057, 0.014], [0.033, 0.06], [0.026, 0.14],
    [0.04, 0.172], [0.044, 0.2], [0.028, 0.228], [0.034, 0.244],
    [0.014, 0.268], [0, 0.278],
  ],
  k: [
    [0, 0], [0.065, 0], [0.059, 0.014], [0.035, 0.06], [0.027, 0.15],
    [0.041, 0.182], [0.045, 0.21], [0.03, 0.238], [0.035, 0.258],
    [0.018, 0.284], [0, 0.305],
  ],
};

const KNIGHT_BASE: [number, number][] = [
  [0, 0], [0.058, 0], [0.052, 0.014], [0.038, 0.045], [0.033, 0.075], [0.028, 0.085], [0, 0.085],
];

// ── Materials (shared) ─────────────────────────────────────────────────────────

export const IVORY = new THREE.MeshStandardMaterial({
  color: "#ded5bf",
  roughness: 0.42,
  metalness: 0.02,
});
export const WALNUT = new THREE.MeshStandardMaterial({
  color: "#241c14",
  roughness: 0.38,
  metalness: 0.05,
});

function latheFrom(points: [number, number][]): THREE.LatheGeometry {
  const v = points.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(v, 40);
}

// Geometry cache (module-level: built once, shared by every piece instance).
const GEO: Partial<Record<Exclude<PieceKind, "n">, THREE.LatheGeometry>> = {};
function geoFor(kind: Exclude<PieceKind, "n">): THREE.LatheGeometry {
  if (!GEO[kind]) GEO[kind] = latheFrom(PROFILES[kind]);
  return GEO[kind]!;
}
let knightBaseGeo: THREE.LatheGeometry | null = null;
function knightBase(): THREE.LatheGeometry {
  if (!knightBaseGeo) knightBaseGeo = latheFrom(KNIGHT_BASE);
  return knightBaseGeo;
}

// ── Single piece ───────────────────────────────────────────────────────────────

export function Pezzo({
  kind,
  white,
  position,
  rotation,
  scale = 1,
}: {
  kind: PieceKind;
  white: boolean;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}) {
  const mat = white ? IVORY : WALNUT;

  if (kind === "n") {
    // Stylized knight: turned base + tilted wedge head + small muzzle.
    return (
      <group position={position} rotation={rotation} scale={scale}>
        <mesh geometry={knightBase()} material={mat} castShadow receiveShadow />
        <mesh
          material={mat}
          position={[0.008, 0.135, 0]}
          rotation={[0, 0, -0.5]}
          castShadow
        >
          <boxGeometry args={[0.045, 0.13, 0.052]} />
        </mesh>
        <mesh
          material={mat}
          position={[0.045, 0.175, 0]}
          rotation={[0, 0, -1.05]}
          castShadow
        >
          <boxGeometry args={[0.034, 0.07, 0.044]} />
        </mesh>
      </group>
    );
  }

  if (kind === "k") {
    // King: lathe body + tiny cross.
    return (
      <group position={position} rotation={rotation} scale={scale}>
        <mesh geometry={geoFor("k")} material={mat} castShadow receiveShadow />
        <mesh material={mat} position={[0, 0.325, 0]} castShadow>
          <boxGeometry args={[0.01, 0.045, 0.01]} />
        </mesh>
        <mesh material={mat} position={[0, 0.332, 0]} castShadow>
          <boxGeometry args={[0.032, 0.01, 0.01]} />
        </mesh>
      </group>
    );
  }

  return (
    <mesh
      geometry={geoFor(kind)}
      material={mat}
      position={position}
      rotation={rotation}
      scale={scale}
      castShadow
      receiveShadow
    />
  );
}

// ── Full set from FEN ──────────────────────────────────────────────────────────

export interface FenPiece {
  kind: PieceKind;
  white: boolean;
  file: number; // 0..7 (a..h)
  rank: number; // 0..7 (rank 1..8)
}

export function parseFenPieces(fen: string): FenPiece[] {
  const placement = fen.split(" ")[0];
  const out: FenPiece[] = [];
  const rows = placement.split("/");
  for (let r = 0; r < rows.length && r < 8; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (ch >= "1" && ch <= "8") {
        file += parseInt(ch, 10);
        continue;
      }
      const lower = ch.toLowerCase() as PieceKind;
      if (["p", "r", "n", "b", "q", "k"].includes(lower)) {
        out.push({
          kind: lower,
          white: ch === ch.toUpperCase(),
          file,
          rank: 7 - r, // FEN row 0 = rank 8
        });
        file++;
      }
    }
  }
  return out;
}

/**
 * Renders all pieces of a FEN, centered: square (file, rank) center is at
 * x = (file - 3.5) * s, z = (3.5 - rank) * s  (white side toward +z / camera).
 */
export function PezziFromFen({
  fen,
  square,
  y = 0,
}: {
  fen: string;
  square: number;
  y?: number;
}) {
  const pieces = useMemo(() => parseFenPieces(fen), [fen]);
  return (
    <group>
      {pieces.map((p, i) => (
        <Pezzo
          key={i}
          kind={p.kind}
          white={p.white}
          position={[(p.file - 3.5) * square, y, (3.5 - p.rank) * square]}
          // Knights face the opponent
          rotation={p.kind === "n" && !p.white ? [0, Math.PI, 0] : undefined}
          scale={square / 0.18}
        />
      ))}
    </group>
  );
}
