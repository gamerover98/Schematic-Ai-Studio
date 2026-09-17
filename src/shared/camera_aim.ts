/**
 * Where the viewport's camera may be sent, and the arithmetic that turns what
 * was asked for into a position and a point to look at.
 *
 * `capture_viewport` used to photograph the window exactly as the user had left
 * it, and its description told the model to ask for another angle. A model
 * checking its own build through coordinates cannot see the one side it got
 * wrong, and "please turn the camera round" is a round trip through a person for
 * something the app can do itself.
 *
 * ## Why this is in `shared/` and resolved in main
 *
 * The renderer only *applies* a camera: it is handed a position and a target
 * and draws from there. Everything that can be wrong about the request -- a
 * compass word that does not exist, an elevation past the pole, a distance
 * behind the far plane -- is decided here, from the document's size, where a
 * suite can reach every number. A renderer that resolved it would put the rules
 * inside a component this project's harness cannot mount.
 *
 * `documentFraming` moved here from `renderer/lib/framing.ts`, which re-exports
 * it, because an empty `camera: {}` means "the establishing shot" and two copies
 * of that shot is how the R key and the tool come to disagree about it.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The open document's dimensions, in blocks. */
export interface BoxSize {
  width: number;
  height: number;
  length: number;
}

/**
 * How far out the establishing shot stands, in multiples of the box's largest
 * side. The number the mesh-bounds framing always used.
 */
export const FRAMING_DISTANCE_FACTOR = 1.6;

/**
 * The establishing shot for a document of this size.
 *
 * Derived from the **document box** rather than from the geometry in it, which
 * is the fix as much as the centring is: `Box3.setFromObject` on an empty
 * document is an empty box, so framing gave up and left the camera wherever it
 * had been mounted -- pointed at nothing, at the exact moment the user most
 * needs to see where the work surface is.
 *
 * The angle and the 1.6 are the ones the mesh-bounds version used, kept so an
 * ordinary document opens looking the way it always did.
 */
export function documentFraming(size: BoxSize): { target: Vec3; position: Vec3 } {
  const target = {
    x: size.width / 2,
    y: size.height / 2,
    z: size.length / 2,
  };
  const distance = Math.max(size.width, size.height, size.length) * FRAMING_DISTANCE_FACTOR;
  return {
    target,
    position: {
      x: target.x + distance,
      y: target.y + distance * 0.7,
      z: target.z + distance,
    },
  };
}

/**
 * The sides a camera can be sent to, as a builder names them.
 *
 * Compass words rather than an angle, for the reason the viewport's compass is
 * labelled the way it is: a builder thinks in north and east, and
 * `facing=north` is what the file says. The word is the side the camera stands
 * **on**, so `north` looks south at the target -- the side of the build that
 * faces north.
 */
export const AIM_SIDES = [
  "north",
  "north_east",
  "east",
  "south_east",
  "south",
  "south_west",
  "west",
  "north_west",
  "above",
  "below",
] as const;

export type AimSide = (typeof AIM_SIDES)[number];

/** Degrees above the horizontal, when a horizontal side is asked for alone. */
export const DEFAULT_AIM_ELEVATION = 30;

/**
 * The steepest a horizontal side may be asked to look.
 *
 * At 90 the side stops meaning anything -- straight down from the north is
 * straight down from the south -- and OrbitControls takes its azimuth from
 * `atan2(0, 0)`, which is zero by definition rather than by intent. `above` and
 * `below` are the words for that.
 */
export const MAX_AIM_ELEVATION = 89;

/** Unit horizontal steps, in this app's axes: north is -Z, east +X. */
const SIDE_STEP: Record<Exclude<AimSide, "above" | "below">, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  north_east: { x: Math.SQRT1_2, z: -Math.SQRT1_2 },
  east: { x: 1, z: 0 },
  south_east: { x: Math.SQRT1_2, z: Math.SQRT1_2 },
  south: { x: 0, z: 1 },
  south_west: { x: -Math.SQRT1_2, z: Math.SQRT1_2 },
  west: { x: -1, z: 0 },
  north_west: { x: -Math.SQRT1_2, z: -Math.SQRT1_2 },
};

/** What was asked for, validated but not yet resolved against a document. */
export interface CameraAim {
  readonly target: Vec3 | null;
  readonly position: Vec3 | null;
  readonly from: AimSide | null;
  readonly elevation: number | null;
  readonly distance: number | null;
}

/** A camera the renderer can apply as it stands. */
export interface CameraPlacement {
  readonly position: Vec3;
  readonly target: Vec3;
}

export type AimVerdict<T> = { ok: true; value: T } | { ok: false; refused: string };

const FIELDS = ["target", "position", "from", "elevation", "distance"] as const;

function vector(raw: unknown, name: string): AimVerdict<Vec3> {
  const value = (raw ?? null) as Record<string, unknown> | null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, refused: `camera.${name} must be an object with x, y and z.` };
  }
  const out: Record<string, number> = {};
  for (const axis of ["x", "y", "z"] as const) {
    const n = value[axis];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return { ok: false, refused: `camera.${name}.${axis} is required and must be a number.` };
    }
    out[axis] = n;
  }
  return { ok: true, value: { x: out.x, y: out.y, z: out.z } };
}

/**
 * Reads the `camera` argument.
 *
 * `null` for no camera at all, which photographs the view as the user left it.
 * Every combination that could only be guessed at is refused by name rather
 * than resolved quietly: a camera that silently ignored half of what it was
 * asked would produce a picture the model believes is of something else.
 */
export function parseCameraAim(raw: unknown): AimVerdict<CameraAim | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, refused: "camera must be an object." };
  }
  const args = raw as Record<string, unknown>;
  const unknown = Object.keys(args).filter((key) => !(FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      refused:
        `camera has no field ${unknown.join(", ")}. ` +
        `It takes ${FIELDS.join(", ")}.`,
    };
  }

  let target: Vec3 | null = null;
  if (args.target !== undefined) {
    const read = vector(args.target, "target");
    if (!read.ok) return read;
    target = read.value;
  }
  let position: Vec3 | null = null;
  if (args.position !== undefined) {
    const read = vector(args.position, "position");
    if (!read.ok) return read;
    position = read.value;
  }

  let from: AimSide | null = null;
  if (args.from !== undefined) {
    if (typeof args.from !== "string" || !(AIM_SIDES as readonly string[]).includes(args.from)) {
      return {
        ok: false,
        refused: `camera.from must be one of ${AIM_SIDES.join(", ")}; got ${JSON.stringify(args.from)}.`,
      };
    }
    from = args.from as AimSide;
  }

  let elevation: number | null = null;
  if (args.elevation !== undefined) {
    if (typeof args.elevation !== "number" || !Number.isFinite(args.elevation)) {
      return { ok: false, refused: "camera.elevation must be a number of degrees." };
    }
    if (Math.abs(args.elevation) > MAX_AIM_ELEVATION) {
      return {
        ok: false,
        refused:
          `camera.elevation must be between -${MAX_AIM_ELEVATION} and ${MAX_AIM_ELEVATION} degrees. ` +
          `To look straight down or up, use from "above" or "below".`,
      };
    }
    elevation = args.elevation;
  }

  let distance: number | null = null;
  if (args.distance !== undefined) {
    if (typeof args.distance !== "number" || !Number.isFinite(args.distance) || args.distance <= 0) {
      return { ok: false, refused: "camera.distance must be a number of blocks greater than zero." };
    }
    distance = args.distance;
  }

  if (position !== null && (from !== null || elevation !== null || distance !== null)) {
    return {
      ok: false,
      refused:
        "Give camera either a position, or a side with from (and optionally elevation and distance) -- not both.",
    };
  }
  if (elevation !== null && from === null) {
    return { ok: false, refused: "camera.elevation goes with camera.from, which says the side to look from." };
  }
  if (elevation !== null && (from === "above" || from === "below")) {
    return {
      ok: false,
      refused: `camera.elevation does not apply to from "${from}", which already looks straight ${from === "above" ? "down" : "up"}.`,
    };
  }

  return { ok: true, value: { target, position, from, elevation, distance } };
}

export interface ResolvedAim {
  readonly camera: CameraPlacement;
  /** Anything the resolution had to do that the caller did not ask for. */
  readonly notes: readonly string[];
}

/** How much of the draw distance the camera may stand back, at most. */
const DRAW_DISTANCE_SHARE = 0.9;

const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Turns a request into a camera, against the open document.
 *
 * `drawDistance` is the viewport's far plane: nothing beyond it is drawn, so a
 * camera stood further back than that photographs an empty sky. A `from`
 * distance is brought inside it and **says so**; an explicit `position` is
 * taken as given, because the caller chose that point, and gets the same
 * sentence as a warning.
 */
export function resolveCameraAim(
  aim: CameraAim,
  size: BoxSize,
  drawDistance: number,
): AimVerdict<ResolvedAim> {
  const notes: string[] = [];
  const framing = documentFraming(size);
  const target = aim.target ?? framing.target;
  const reach = Math.max(1, drawDistance * DRAW_DISTANCE_SHARE);

  if (aim.position !== null) {
    const span = Math.hypot(
      aim.position.x - target.x,
      aim.position.y - target.y,
      aim.position.z - target.z,
    );
    if (span < 1e-3) {
      return { ok: false, refused: "camera.position and camera.target are the same point, so there is nothing to look along." };
    }
    if (span > reach) {
      notes.push(
        `The camera stands ${round(span)} blocks from what it looks at, and the viewport draws ` +
          `nothing further than ${drawDistance} blocks, so part of the build may be missing from the picture.`,
      );
    }
    return { ok: true, value: { camera: { position: aim.position, target }, notes } };
  }

  const asked =
    aim.distance ?? Math.max(size.width, size.height, size.length) * FRAMING_DISTANCE_FACTOR;
  const distance = Math.min(asked, reach);
  if (distance < asked) {
    notes.push(
      `Moved in to ${round(distance)} blocks: the viewport draws nothing further than its draw ` +
        `distance of ${drawDistance} blocks.`,
    );
  }

  if (aim.from === null) {
    // The establishing shot's direction, about whatever target was asked for.
    const offset = {
      x: framing.position.x - framing.target.x,
      y: framing.position.y - framing.target.y,
      z: framing.position.z - framing.target.z,
    };
    const length = Math.hypot(offset.x, offset.y, offset.z) || 1;
    const scale = distance / length;
    return {
      ok: true,
      value: {
        camera: {
          position: {
            x: target.x + offset.x * scale,
            y: target.y + offset.y * scale,
            z: target.z + offset.z * scale,
          },
          target,
        },
        notes,
      },
    };
  }

  if (aim.from === "above" || aim.from === "below") {
    /*
     * Leaning towards +Z by a thousandth, like the compass's poles. Straight
     * overhead, OrbitControls takes its azimuth from `atan2(0, 0)`, so the view
     * would swing to whatever zero happens to be; leaning south puts north at
     * the top of the picture, which is what a map does.
     */
    const sign = aim.from === "above" ? 1 : -1;
    return {
      ok: true,
      value: {
        camera: {
          position: { x: target.x, y: target.y + sign * distance, z: target.z + distance * 1e-3 },
          target,
        },
        notes,
      },
    };
  }

  const step = SIDE_STEP[aim.from];
  const radians = ((aim.elevation ?? DEFAULT_AIM_ELEVATION) * Math.PI) / 180;
  const flat = distance * Math.cos(radians);
  return {
    ok: true,
    value: {
      camera: {
        position: {
          x: target.x + step.x * flat,
          y: target.y + distance * Math.sin(radians),
          z: target.z + step.z * flat,
        },
        target,
      },
      notes,
    },
  };
}
