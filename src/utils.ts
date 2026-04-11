// ─── utils.ts ─────────────────────────────────────────────────────────────────
// Shared math helpers used throughout the game.
// All functions here are pure (no side-effects) and framework-agnostic, so they
// can be unit-tested in isolation and reused by any module.
// ──────────────────────────────────────────────────────────────────────────────

// ─── 2-D vector ───────────────────────────────────────────────────────────────
// Immutable-style helpers: every operation returns a *new* Vec2 so callers
// never accidentally mutate a shared vector.
export class Vec2 {
  x: number;
  y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /** Returns a new Vec2 with the same values. */
  clone(): Vec2 { return new Vec2(this.x, this.y); }

  /** Component-wise addition. */
  add(v: Vec2): Vec2 { return new Vec2(this.x + v.x, this.y + v.y); }

  /** Component-wise subtraction (this − v). */
  sub(v: Vec2): Vec2 { return new Vec2(this.x - v.x, this.y - v.y); }

  /** Scalar multiplication. */
  scale(s: number): Vec2 { return new Vec2(this.x * s, this.y * s); }

  /** Euclidean length of the vector. */
  magnitude(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }

  /** Returns a unit vector in the same direction. Returns (0,0) for zero-length input. */
  normalize(): Vec2 {
    const m = this.magnitude();
    return m === 0 ? new Vec2(0, 0) : new Vec2(this.x / m, this.y / m);
  }

  /** Dot product — useful for projecting one vector onto another. */
  dot(v: Vec2): number { return this.x * v.x + this.y * v.y; }
}

// ─── Position interface ───────────────────────────────────────────────────────
// Any object with x/y coordinates satisfies this interface, letting helper
// functions work with Player, Enemy, Gem, etc. without importing those types.
export interface HasPosition {
  x: number;
  y: number;
}

/** Euclidean distance between two positioned objects. */
export function distance(a: HasPosition, b: HasPosition): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Returns true when two axis-aligned circles overlap.
 * Uses squared-distance comparison to avoid a square-root, which is faster
 * and safe because we only need a boolean result.
 */
export function circlesOverlap(
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const distSq = dx * dx + dy * dy;
  const radSum = ar + br;
  // Compare distSq < (ar + br)² instead of dist < ar + br (avoids sqrt)
  return distSq < radSum * radSum;
}

// ─── Random helpers ───────────────────────────────────────────────────────────

/** Uniform random float in [min, max). */
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Uniform random integer in [min, max] (inclusive on both ends). */
export function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}

// ─── Array helpers ────────────────────────────────────────────────────────────

/**
 * Fisher-Yates in-place shuffle.
 * Mutates `arr` and returns it so callers can chain: `shuffle([...pool])`.
 */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

// ─── Numeric helpers ──────────────────────────────────────────────────────────

/** Clamps `v` so it stays within [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Color helpers ────────────────────────────────────────────────────────────

/**
 * Linear interpolation between two CSS hex colors ("#rrggbb").
 * t=0 returns c1, t=1 returns c2, values in between blend the channels.
 * Used for smooth color transitions in visual effects.
 */
export function lerpColor(c1: string, c2: string, t: number): string {
  // Parse each hex channel into a 0-255 integer
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  // Lerp each channel and clamp to integer
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  // Re-encode as a 2-digit hex string per channel
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
