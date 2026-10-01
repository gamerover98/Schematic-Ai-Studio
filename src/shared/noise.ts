/**
 * Coherent noise for the mix distributions, from a seed and nothing else.
 *
 * Every function here is pure and deterministic: the same seed and the same
 * coordinates give the same number in main, where a fill is written, and in
 * the renderer, where a block is placed by hand. Nothing reads `Math.random`.
 *
 * No dependency, because the whole of it is a page of arithmetic: Ken Perlin's
 * improved noise (2002), Stefan Gustavson's 3D simplex, fractal sums of either,
 * Musgrave's ridged multifractal and Worley's cellular noise. Each is written
 * the way its author published it, and the tests pin values to the seed.
 *
 * The outputs are only ever *ranked* -- `main/domain/mix.ts` cuts the ranking
 * at the mix's shares -- so what matters is the shape of the field, not its
 * range. That is why nothing here is rescaled to [0, 1].
 */

/**
 * A number in [0, 1) that depends only on the cell and the seed.
 *
 * MurmurHash3's finaliser over the three coordinates and the seed, each
 * multiplied by a different odd constant first so that swapping two axes is a
 * different cell. Integer arithmetic throughout, so main and the renderer get
 * the same bits.
 */
export function cellHash01(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x8da6b343) ^
    Math.imul(y | 0, 0xd8163841) ^
    Math.imul(z | 0, 0xcb1ab31f) ^
    Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** mulberry32: a small seeded generator, for building tables from a seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The noise state for one seed: a shuffled permutation, doubled so an index
 * never has to wrap, and an offset that moves the lattice off the block grid.
 *
 * The offset matters more than it looks. Gradient noise is exactly zero at
 * every lattice point, and with a frequency like 0.25 every fourth block lands
 * on one -- thousands of cells with the same value, which is a ranking full of
 * ties and a pattern with a grid in it.
 */
export interface NoiseSeed {
  readonly perm: Uint8Array;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
}

const seeds = new Map<number, NoiseSeed>();

export function noiseSeed(seed: number): NoiseSeed {
  const held = seeds.get(seed);
  if (held !== undefined) return held;
  const random = mulberry32(seed ^ 0x9e3779b9);
  const order = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) order[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = order[i & 255];
  const made = { perm, ox: random() * 256, oy: random() * 256, oz: random() * 256 };
  // A handful of seeds are live at once; a map that only grows is a leak.
  if (seeds.size >= 32) seeds.clear();
  seeds.set(seed, made);
  return made;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + t * (b - a);

function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Ken Perlin's improved noise, roughly in [-1, 1]. */
export function perlin3(perm: Uint8Array, x: number, y: number, z: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const X = fx & 255;
  const Y = fy & 255;
  const Z = fz & 255;
  x -= fx;
  y -= fy;
  z -= fz;
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = perm[X] + Y;
  const AA = perm[A] + Z;
  const AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y;
  const BA = perm[B] + Z;
  const BB = perm[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
      lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u),
      v,
    ),
    lerp(
      lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
}

const F3 = 1 / 3;
const G3 = 1 / 6;
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
] as const;

function corner(gi: number, x: number, y: number, z: number): number {
  let t = 0.6 - x * x - y * y - z * z;
  if (t < 0) return 0;
  t *= t;
  const g = GRAD3[gi];
  return t * t * (g[0] * x + g[1] * y + g[2] * z);
}

/**
 * Stefan Gustavson's 3D simplex noise, roughly in [-1, 1].
 *
 * Fewer directional artefacts than Perlin's: its cells are tetrahedra rather
 * than cubes, so the grain does not line up with the block axes.
 */
export function simplex3(perm: Uint8Array, xin: number, yin: number, zin: number): number {
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const z0 = zin - (k - t);
  // Which of the six tetrahedra of the cube the point is in. Written out
  // rather than destructured: this runs once per cell of a fill, and a
  // destructuring assignment builds an array every time.
  let i1 = 0;
  let j1 = 0;
  let k1 = 0;
  let i2 = 0;
  let j2 = 0;
  let k2 = 0;
  if (x0 >= y0) {
    i2 = 1;
    if (y0 >= z0) {
      i1 = 1;
      j2 = 1;
    } else if (x0 >= z0) {
      i1 = 1;
      k2 = 1;
    } else {
      k1 = 1;
      k2 = 1;
    }
  } else {
    j2 = 1;
    if (y0 < z0) {
      k1 = 1;
      k2 = 1;
    } else if (x0 < z0) {
      j1 = 1;
      k2 = 1;
    } else {
      j1 = 1;
      i2 = 1;
    }
  }
  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3;
  const y2 = y0 - j2 + 2 * G3;
  const z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3;
  const y3 = y0 - 1 + 3 * G3;
  const z3 = z0 - 1 + 3 * G3;
  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;
  return (
    32 *
    (corner(perm[ii + perm[jj + perm[kk]]] % 12, x0, y0, z0) +
      corner(perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12, x1, y1, z1) +
      corner(perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12, x2, y2, z2) +
      corner(perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12, x3, y3, z3))
  );
}

export type NoiseBasis = (perm: Uint8Array, x: number, y: number, z: number) => number;

/**
 * Fractal Brownian motion: `octaves` layers of a noise, each `lacunarity`
 * times finer and `persistence` times weaker than the one before, normalised
 * by the sum of the weights. Each octave is shifted so the layers do not all
 * pass through the same lattice points.
 */
export function fbm(
  basis: NoiseBasis,
  perm: Uint8Array,
  x: number,
  y: number,
  z: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
): number {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum +=
      amplitude * basis(perm, x * frequency + octave * 19.19, y * frequency + octave * 7.73, z * frequency + octave * 13.37);
    norm += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}

/**
 * Musgrave's ridged multifractal: `offset - |noise|`, squared, so the zero
 * crossings of the noise become sharp ridges, each octave weighted by the
 * one before it through `gain` -- detail gathers on the ridges and the
 * valleys stay smooth. Veins, cracks and mountain crests.
 */
export function ridged(
  perm: Uint8Array,
  x: number,
  y: number,
  z: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  gain: number,
  offset: number,
): number {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let frequency = 1;
  let weight = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    let signal =
      offset - Math.abs(simplex3(perm, x * frequency + octave * 19.19, y * frequency + octave * 7.73, z * frequency + octave * 13.37));
    signal *= signal;
    signal *= weight;
    weight = Math.min(1, Math.max(0, signal * gain));
    sum += signal * amplitude;
    norm += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}

/** Worley's answer for one point: the two nearest feature points and whose. */
export interface WorleySample {
  /** Distance to the nearest point, in cells of `size`. */
  f1: number;
  /** Distance to the second nearest. */
  f2: number;
  /** A number in [0, 1) naming the nearest point's cell: one per patch. */
  id: number;
}

const sample: WorleySample = { f1: 0, f2: 0, id: 0 };

/**
 * Worley's cellular noise. One feature point per cube of `size` blocks, moved
 * off the cube's centre by up to `jitter` of its width, and the 27 cubes
 * around the point searched for the two nearest.
 *
 * Returns one shared object, overwritten by the next call: this runs once per
 * cell of a fill, which may be eight million times.
 */
export function worley(seed: number, x: number, y: number, z: number, size: number, jitter: number): WorleySample {
  const px = x / size;
  const py = y / size;
  const pz = z / size;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const cz = Math.floor(pz);
  let f1 = Infinity;
  let f2 = Infinity;
  let id = 0;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const gx = cx + dx;
        const gy = cy + dy;
        const gz = cz + dz;
        const fx = gx + 0.5 + jitter * (cellHash01(gx, gy, gz, seed) - 0.5);
        const fy = gy + 0.5 + jitter * (cellHash01(gx, gy, gz, seed ^ 0x51ed27) - 0.5);
        const fz = gz + 0.5 + jitter * (cellHash01(gx, gy, gz, seed ^ 0x2545f49) - 0.5);
        const d = (fx - px) ** 2 + (fy - py) ** 2 + (fz - pz) ** 2;
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = cellHash01(gx, gy, gz, seed ^ 0x6c8e9cf5);
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  sample.f1 = Math.sqrt(f1);
  sample.f2 = Math.sqrt(f2);
  sample.id = id;
  return sample;
}
