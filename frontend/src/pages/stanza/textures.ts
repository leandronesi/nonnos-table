/**
 * textures.ts — procedural canvas textures for the WebGL Stanza.
 *
 * Everything is generated at runtime on a <canvas>: no asset downloads, no
 * licensing, and the notebook page can render the user's REAL milestone lines.
 * Each builder returns a THREE.CanvasTexture ready for a material map.
 */

import * as THREE from "three";
import { tr } from "../../i18n/lang";

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return [c, ctx];
}

/** Deterministic pseudo-random (so the wood does not change on re-render). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dark walnut planks with grain — the table top. */
export function woodTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(1024, 1024);
  const rnd = mulberry32(20260611);

  // Base
  const base = ctx.createLinearGradient(0, 0, 0, 1024);
  base.addColorStop(0, "#3d2a1a");
  base.addColorStop(0.55, "#2c1d11");
  base.addColorStop(1, "#1d130b");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 1024);

  // Planks (vertical strips with slight tone variation)
  const plankW = 146;
  for (let x = 0; x < 1024; x += plankW) {
    const tone = (rnd() - 0.5) * 18;
    ctx.fillStyle = `rgba(${60 + tone}, ${40 + tone * 0.7}, ${24 + tone * 0.5}, 0.16)`;
    ctx.fillRect(x, 0, plankW, 1024);
    // Seam
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x - 1, 0, 2, 1024);
  }

  // Grain: long wavy strokes
  for (let i = 0; i < 340; i++) {
    const x0 = rnd() * 1024;
    const alpha = 0.025 + rnd() * 0.05;
    const light = rnd() > 0.72;
    ctx.strokeStyle = light
      ? `rgba(214, 178, 128, ${alpha * 0.8})`
      : `rgba(8, 4, 2, ${alpha})`;
    ctx.lineWidth = 0.6 + rnd() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, -10);
    const drift = (rnd() - 0.5) * 40;
    ctx.bezierCurveTo(
      x0 + drift, 300 + rnd() * 100,
      x0 - drift, 600 + rnd() * 100,
      x0 + (rnd() - 0.5) * 24, 1040,
    );
    ctx.stroke();
  }

  // Sparse knots
  for (let i = 0; i < 5; i++) {
    const kx = rnd() * 1024;
    const ky = rnd() * 1024;
    const kr = 6 + rnd() * 14;
    const g = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr);
    g.addColorStop(0, "rgba(10,5,2,0.5)");
    g.addColorStop(1, "rgba(10,5,2,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(kx, ky, kr, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The chessboard squares — product colors, slightly muted for the night. */
export function boardTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(1024, 1024);
  const s = 1024 / 8;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      ctx.fillStyle = (r + f) % 2 === 0 ? "#9aa6bd" : "#2b3852";
      ctx.fillRect(f * s, r * s, s, s);
    }
  }
  // Soft inner vignette so the board does not look printed
  const g = ctx.createRadialGradient(512, 512, 280, 512, 512, 760);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The notebook page — cream paper, ruled lines, red margin, REAL lines of the
 * user's journey written in serif italic, the gold target line last.
 */
export function paperTexture(title: string, lines: string[], goldLine: string | null): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(1024, 768);

  // Paper
  const bg = ctx.createLinearGradient(0, 0, 1024, 768);
  bg.addColorStop(0, "#f1e7d0");
  bg.addColorStop(0.6, "#ece1c8");
  bg.addColorStop(1, "#e0d3b4");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 768);

  // Ruled lines
  ctx.strokeStyle = "rgba(90, 70, 40, 0.16)";
  ctx.lineWidth = 2;
  for (let y = 150; y < 768; y += 78) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(984, y);
    ctx.stroke();
  }
  // Red margin
  ctx.strokeStyle = "rgba(168, 32, 32, 0.28)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(110, 24);
  ctx.lineTo(110, 744);
  ctx.stroke();

  // Title
  ctx.fillStyle = "#3a2f1d";
  ctx.font = "600 44px Fraunces, Georgia, serif";
  ctx.fillText(title, 140, 100);

  // Lines (italic, like notes)
  ctx.font = "italic 500 34px Fraunces, Georgia, serif";
  ctx.fillStyle = "#4d4128";
  let y = 215;
  for (const line of lines.slice(0, 4)) {
    // bullet
    ctx.fillStyle = "#7c5cff";
    ctx.beginPath();
    ctx.arc(150, y - 11, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4d4128";
    ctx.fillText(truncate(ctx, line, 760), 175, y);
    y += 78;
  }
  if (goldLine) {
    ctx.fillStyle = "#8a6508";
    ctx.beginPath();
    ctx.arc(150, y - 11, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(truncate(ctx, goldLine, 760), 175, y);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A cream card with the REAL anchor label (word-wrapped, up to 3 lines) and
 * the standing invitation at the bottom. Live text per user — it is a canvas.
 */
export function cardTexture(label: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 320);
  ctx.fillStyle = "#ece2cb";
  ctx.fillRect(0, 0, 256, 320);
  ctx.strokeStyle = "rgba(110, 85, 45, 0.4)";
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 250, 314);

  // Label, wrapped on word boundaries (max 3 lines)
  ctx.fillStyle = "#5d4c2e";
  ctx.font = "600 27px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  const words = label.toUpperCase().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const probe = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(probe).width <= 220 || !cur) {
      cur = probe;
    } else {
      lines.push(cur);
      cur = w;
    }
    if (lines.length === 3) break;
  }
  if (cur && lines.length < 3) lines.push(cur);
  let y = 64;
  for (const line of lines) {
    ctx.fillText(line, 128, y);
    y += 38;
  }

  // The invitation
  ctx.fillStyle = "#7a6336";
  ctx.font = "italic 500 30px Fraunces, Georgia, serif";
  ctx.fillText(tr("esercitiamoci.", "let's practice."), 128, 282);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Cream paper tag naming the box: readable even in shade, kin to the cards. */
export function plaqueTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 144);
  const bg = ctx.createLinearGradient(0, 0, 0, 144);
  bg.addColorStop(0, "#efe5cd");
  bg.addColorStop(1, "#ddcfae");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 144);
  ctx.strokeStyle = "rgba(110, 85, 45, 0.45)";
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 500, 132);
  // Canon (PRODUCT.md / nonno-voice): anchors are named with their upside,
  // never as blame. Same wording as the Tavolo section title.
  ctx.fillStyle = "#4a3a1e";
  ctx.font = "italic 600 50px Fraunces, Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText(tr("Le tue ancore", "Your anchors"), 256, 90);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The folded letter front — paper with a fold shadow and "Per te." */
export function letterTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 320);
  const bg = ctx.createLinearGradient(0, 0, 0, 320);
  bg.addColorStop(0, "#f3ead6");
  bg.addColorStop(1, "#e3d6ba");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 320);
  // Fold shadow (envelope flap)
  const flap = ctx.createLinearGradient(0, 0, 0, 170);
  flap.addColorStop(0, "rgba(120, 95, 50, 0.18)");
  flap.addColorStop(1, "rgba(120, 95, 50, 0)");
  ctx.fillStyle = flap;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(512, 0);
  ctx.lineTo(256, 180);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(120, 95, 50, 0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(256, 180);
  ctx.lineTo(512, 0);
  ctx.stroke();
  // Per te.
  ctx.fillStyle = "#6b5638";
  ctx.font = "italic 600 44px Fraunces, Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText(tr("Per te.", "For you."), 256, 250);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft round alpha blob — used by the steam sprites. */
export function steamTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.5, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(t + "...").width > maxW) t = t.slice(0, -1);
  return t + "...";
}
