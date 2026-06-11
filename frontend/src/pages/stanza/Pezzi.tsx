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

// ── Materials (shared) — polished wood, not plastic ───────────────────────────

export const IVORY = new THREE.MeshPhysicalMaterial({
  color: "#e3dcc6",
  roughness: 0.32,
  metalness: 0.0,
  clearcoat: 0.35,
  clearcoatRoughness: 0.4,
});
export const WALNUT = new THREE.MeshPhysicalMaterial({
  color: "#1b1410",
  roughness: 0.3,
  metalness: 0.05,
  clearcoat: 0.5,
  clearcoatRoughness: 0.32,
});

function latheFrom(points: [number, number][]): THREE.LatheGeometry {
  const v = points.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(v, 48);
  geo.computeVertexNormals();
  return geo;
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

/**
 * The knight head: a horse silhouette extruded with a bevel — the classic
 * trick of real-world minimal sets. Outline drawn in XY (x = muzzle forward,
 * y = up from the base top), extruded along Z and beveled.
 */
let knightHeadGeo: THREE.ExtrudeGeometry | null = null;
function knightHead(): THREE.ExtrudeGeometry {
  if (knightHeadGeo) return knightHeadGeo;
  const s = new THREE.Shape();
  s.moveTo(-0.030, 0.000);          // back-bottom of the neck
  s.bezierCurveTo(-0.046, 0.030, -0.044, 0.070, -0.034, 0.092); // nape rising
  s.lineTo(-0.030, 0.118);          // back of the head
  s.lineTo(-0.038, 0.142);          // back ear
  s.lineTo(-0.020, 0.134);          // notch between ears
  s.lineTo(-0.010, 0.155);          // ear tip
  s.bezierCurveTo(0.004, 0.138, 0.018, 0.124, 0.040, 0.108);    // forehead
  s.lineTo(0.062, 0.090);           // muzzle top
  s.lineTo(0.064, 0.072);           // nose
  s.lineTo(0.044, 0.062);           // mouth
  s.bezierCurveTo(0.030, 0.058, 0.022, 0.052, 0.020, 0.040);    // jaw / throat
  s.bezierCurveTo(0.018, 0.022, 0.016, 0.010, 0.014, 0.000);    // front of the neck
  s.closePath();
  knightHeadGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.042,
    bevelEnabled: true,
    bevelThickness: 0.007,
    bevelSize: 0.006,
    bevelSegments: 3,
    curveSegments: 14,
  });
  knightHeadGeo.translate(0, 0, -0.021); // center the thickness
  return knightHeadGeo;
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
    // Knight: turned base + extruded horse-head silhouette.
    return (
      <group position={position} rotation={rotation} scale={scale}>
        <mesh geometry={knightBase()} material={mat} castShadow receiveShadow />
        <mesh
          geometry={knightHead()}
          material={mat}
          position={[0, 0.08, 0]}
          castShadow
          receiveShadow
        />
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
          // Knights face the opponent: the head shape's muzzle is +x,
          // rotY +PI/2 maps +x onto -z (white looks away from the camera).
          rotation={
            p.kind === "n"
              ? [0, p.white ? Math.PI / 2 : -Math.PI / 2, 0]
              : undefined
          }
          scale={square / 0.18}
        />
      ))}
    </group>
  );
}
