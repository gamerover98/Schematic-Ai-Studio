/**
 * The verbs that need an effect this process has to inject.
 *
 * Mostly the ones about the *file* rather than the blocks in it — open, create,
 * save, close, delete — plus the one that photographs the window, which needs
 * the same treatment for the same reason: it reaches Electron, and the rule it
 * has to obey is worth testing without it.
 *
 * Deliberately not in `agent/tools.ts`, and that asymmetry is the design. The
 * in-app agent edits the schematic the user opened; it has no business opening
 * a different one, and a model that could would be able to close the document
 * out from under the person typing to it. An MCP client is in the opposite
 * position — it has no window and no hands, so if it cannot open a file it
 * cannot start.
 *
 * ## Everything is injected
 *
 * These reach the session, the recents list, the conversation store and the OS
 * trash, and half of those import Electron. So the effects arrive as a
 * `Lifecycle` object: the server passes the real ones, `tests/mcp.ts` passes
 * fakes and can then check what a refusal actually refused rather than only
 * what it said. The same split `discard_prompt.ts` was made for, one level up.
 *
 * ## Where the guards are
 *
 * In `policy.ts`, and asked *before* the effect rather than inside it —
 * `openDocument` reassigns the session without looking at what was there, so by
 * the time it has the request the work is already gone. Exactly the reasoning
 * behind the discard dialog living in front of the call rather than inside
 * `session.ts`.
 */

import path from "path";

import { type SchematicFormat } from "../../shared/schematic.js";
import {
  MC_VERSION_NAMES,
  documentEra,
  documentVersionName,
  resolveVersionName,
  versionRangesSentence,
} from "../../shared/mc_versions.js";
import { mayDelete, mayReplaceDocument, withinRoot, type Verdict } from "./policy.js";
import { type DocumentSession } from "../services/session.js";
import {
  AIM_SIDES,
  DEFAULT_AIM_ELEVATION,
  MAX_AIM_ELEVATION,
  parseCameraAim,
  resolveCameraAim,
  type CameraPlacement,
} from "../../shared/camera_aim.js";
import type { CameraState } from "../../shared/ipc.js";

/** Everything these tools need that they must not import for themselves. */
export interface Lifecycle {
  /** The open document, or `null`. */
  session(): DocumentSession | null;
  /** Whether it differs from disk. */
  isDirty(session: DocumentSession): boolean;
  open(filePath: string): Promise<DocumentSession>;
  /**
   * `version` is a name the caller has already resolved, never a label and
   * never absent. It was `string | null`, and `null` reached `dataVersionOf`
   * as a document with no version tag at all -- the report this came from.
   */
  create(
    size: { width: number; height: number; length: number },
    format: SchematicFormat,
    version: string,
  ): Promise<DocumentSession>;
  save(
    session: DocumentSession,
    options: {
      filePath: string | null;
      format?: SchematicFormat;
      /** Omitted keeps what the document carries -- `SaveRequest.version`'s rule. */
      version?: string;
    },
  ): Promise<{
    filePath: string;
    format: SchematicFormat;
    degraded: readonly string[];
    dropped: readonly string[];
    /**
     * The box the file was trimmed to, or `null` if nothing was trimmed.
     *
     * Reported rather than flattened to a boolean: saving crops to content,
     * so a model that placed a block at y=40 in a 64-tall document and then
     * saved needs to know the coordinates in the *file* are not the ones it
     * was working in.
     */
    cropped: { from: [number, number, number]; to: [number, number, number] } | null;
  }>;
  close(): void;
  recents(): Promise<readonly { filePath: string; openedAt: number }[]>;
  /** Moves a file to the OS trash. Never `unlink` — see `mayDelete`. */
  trash(filePath: string): Promise<void>;
  /** The directory the server may touch, already resolved. */
  root(): Promise<string>;
  /**
   * Whether deletion is switched on.
   *
   * Asked at the moment of the call rather than captured when the server
   * started: a user who turns the flag off has turned it off, and a value read
   * once would keep saying yes for the rest of the session.
   */
  allowDelete(): Promise<boolean>;
  /** Refuses a format the chosen game version cannot hold. `null` if it can. */
  refusalFor(format: SchematicFormat, version: string | null): string | null;
  /** Called after anything that changes what is open. */
  announce(session: DocumentSession | null): void;
  /**
   * A picture of the 3D viewport, as PNG bytes already base64-encoded.
   *
   * `camera` is where to put the camera first, already resolved; `null` leaves
   * it where the user had it. The answer carries where it actually stood, which
   * is `null` only when the window could not say.
   *
   * `null` when there is no window to photograph — the process outlives its
   * window on macOS, and a client asking then should be told so rather than
   * handed a blank image.
   */
  capture(camera: CameraPlacement | null): Promise<{
    data: string;
    width: number;
    height: number;
    camera: CameraState | null;
  } | null>;
  /**
   * How far the viewport draws, in blocks.
   *
   * Asked per call for `allowDelete`'s reason: it is a setting the user can
   * move, and a camera stood behind the far plane photographs an empty sky.
   */
  drawDistance(): Promise<number>;
  /** The open schematic's own version history, newest first. */
  versions(): Promise<readonly { id: string; label: string; at: number }[]>;
  /** Snapshot the current state under a label. */
  saveVersion(label: string): Promise<readonly { id: string; label: string; at: number }[]>;
  /**
   * Go back to one, snapshotting what is being left first.
   *
   * Returns `null` when the id names nothing. Restoring starts a fresh history,
   * so it cannot be undone — which is exactly why the state being left is
   * snapshotted, and why this is a fork rather than a one-way door.
   */
  restoreVersion(id: string): Promise<DocumentSession | null>;
  /*
   * There is deliberately no `generate`.
   *
   * A `generate_schematic` tool lived here and asked the model the *user*
   * configured in this app to build the schematic -- a second model, on a
   * second budget, doing what the model driving this connection was already
   * doing with `run_build_script`. It is the one thing this server exists not
   * to be: the header above says the whole value is what a harness cannot do
   * for itself, and calling an LLM is precisely what it can.
   *
   * It also made the app's own provider key a precondition for a connection
   * that has nothing to do with it, so a missing key came back as the
   * gateway's `Invalid API key.` over a link the reader had just authenticated
   * to with a bearer token. That was reported as an MCP authentication failure
   * twice before anyone doubted the tool itself.
   *
   * The chat inside the app is untouched: it never had this tool. It generates
   * through `IPC.generate`, which has its own key gate.
   */
}

export interface LifecycleSpec {
  readonly name: string;
  readonly description: string;
  readonly schema: Record<string, unknown>;
  readonly readOnly: boolean;
  readonly destructive: boolean;
  run(host: Lifecycle, args: unknown): Promise<unknown>;
}

/** Thrown for a refusal, so the server reports it as a tool error like any other. */
export class McpRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpRefusal";
  }
}

function must<T>(verdict: Verdict<T>): T {
  if (!verdict.ok) throw new McpRefusal(verdict.refused);
  return verdict.value;
}

function describe(session: DocumentSession | null, dirty: boolean): unknown {
  if (session === null) {
    return {
      open: false,
      note: "No schematic is open. Use open_document or create_document first.",
    };
  }
  const { doc } = session;
  return {
    open: true,
    filePath: doc.filePath,
    fileName: doc.filePath === null ? null : path.basename(doc.filePath),
    width: doc.width,
    height: doc.height,
    length: doc.length,
    format: doc.format,
    dataVersion: doc.dataVersion,
    /*
     * The raw tag is not an answer a model can use: 1343 means nothing and
     * `null` means either "no tag" or "pre-Flattening", which are very
     * different things. `era` separates them and `version` is what a person
     * calls it.
     */
    version: documentVersionName(doc.format, doc.dataVersion),
    era: documentEra(doc.format, doc.dataVersion),
    unsavedChanges: dirty,
  };
}

const DISCARD = {
  discardUnsavedChanges: {
    type: "boolean",
    description:
      "Only after the user has said to throw away their unsaved changes. Never assume it.",
  },
} as const;

/**
 * The one tool that answers with a picture.
 *
 * This is the capability no harness can get any other way: a model editing a
 * schematic through coordinates is working blind, and one look at what it built
 * catches the whole class of mistakes that are obvious to a person and
 * invisible in a block list — a roof one block short, a wall inside out, a
 * staircase facing the wall.
 *
 * Without `camera` it photographs the window as it *is*, the angle the user
 * left it at. With one it moves the camera first -- a side of the build by
 * compass word, or a position -- waits for that frame to be drawn, and then
 * takes the picture. The camera **stays** there afterwards, which is the user's
 * choice and the honest one: the person watching sees what the model looked at,
 * and R puts the establishing shot back.
 *
 * Still `readOnly`. The flag is a promise about the schematic, the undo stack
 * and the clipboard, and none of them moves; the view is presentation, the way
 * a scrollbar is. Marking it otherwise would put a permission prompt in front
 * of every look a model takes at its own work.
 */
/**
 * The `version` property every tool that names one shares.
 *
 * One object, spread into four schemas, and **built from the table** rather
 * than written out. That is the fix for the report this came from as much as
 * the validation is: the only spelling a model could see was the example
 * `JE_1_20_4` in a hand-written sentence, so asked for 26.2 it sent the label
 * `"26.2"`, which resolved to nothing and produced a document with no version
 * at all. An `enum` is what stops a model guessing; deriving it is what stops
 * the enum itself going stale the way that example did.
 *
 * The format decides which of these are legal and JSON Schema cannot say so,
 * so the sentence names the ranges and `refusalFor` enforces them -- it has a
 * phrasing per container already.
 */
const VERSION_PROPERTY = {
  type: "string",
  enum: [...MC_VERSION_NAMES],
  description:
    `The Minecraft version, by name (${MC_VERSION_NAMES[0]}) or by label ` +
    `(${MC_VERSION_NAMES[0].replace(/^JE_/, "").replace(/_/g, ".")}). ` +
    versionRangesSentence(),
} as const;

const POINT = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
  required: ["x", "y", "z"],
  additionalProperties: false,
} as const;

const CAPTURE: LifecycleSpec = {
  name: "capture_viewport",
  description:
    "A picture of the 3D viewport — the user's lighting and theme. Use it to check that what you have built actually looks right; a block list cannot show you a wall facing the wrong way. " +
    "Without `camera` it shows the view the user left. With `camera` it first moves the camera, and the camera stays there afterwards, so the user sees what you looked at. " +
    "Coordinates are the schematic's own blocks: north is -z, east is +x, up is +y. " +
    "The answer says where the camera stood.",
  schema: {
    type: "object",
    properties: {
      camera: {
        type: "object",
        description:
          "Where to look from. `{}` is the establishing shot of the whole schematic. " +
          "`from` names the side the camera stands on (from `north` shows the north face of the build); " +
          "`target` defaults to the middle of the schematic and `distance` to far enough to see all of it. " +
          "Or give an exact `position` instead of `from`.",
        properties: {
          target: { ...POINT, description: "The point to look at, in blocks." },
          position: { ...POINT, description: "Exactly where the camera stands. Not with from." },
          from: { type: "string", enum: [...AIM_SIDES] },
          elevation: {
            type: "number",
            minimum: -MAX_AIM_ELEVATION,
            maximum: MAX_AIM_ELEVATION,
            description: `Degrees above the horizontal, with a compass side in from. Default ${DEFAULT_AIM_ELEVATION}.`,
          },
          distance: { type: "number", exclusiveMinimum: 0, description: "Blocks from the target." },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  readOnly: true,
  destructive: false,
  async run(host, args) {
    const aim = parseCameraAim((args as { camera?: unknown } | null)?.camera);
    if (!aim.ok) throw new McpRefusal(aim.refused);

    let camera: CameraPlacement | null = null;
    let notes: readonly string[] = [];
    if (aim.value !== null) {
      /*
       * Resolved against the open document, which is what "the middle of the
       * schematic" and "far enough to see all of it" are measured from. With
       * nothing open there is nothing those words can mean, and the viewport
       * is showing the start screen besides.
       */
      const session = host.session();
      if (session === null) {
        throw new McpRefusal(
          "No schematic is open, so there is nothing to aim the camera at. Use open_document or create_document first.",
        );
      }
      const { doc } = session;
      const resolved = resolveCameraAim(
        aim.value,
        { width: doc.width, height: doc.height, length: doc.length },
        await host.drawDistance(),
      );
      if (!resolved.ok) throw new McpRefusal(resolved.refused);
      camera = resolved.value.camera;
      notes = resolved.value.notes;
    }

    const shot = await host.capture(camera);
    if (shot === null) {
      throw new McpRefusal(
        "There is no window open to photograph. Ask the user to bring Schematic AI Studio " +
          "to the front and try again.",
      );
    }
    return notes.length === 0 ? shot : { ...shot, note: notes.join(" ") };
  },
};

export const LIFECYCLE_SPECS: readonly LifecycleSpec[] = [
  {
    name: "get_document",
    description:
      "Which schematic is open, its size and format, and whether it has unsaved changes. Answers even when nothing is open, which is how you find out.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    destructive: false,
    async run(host) {
      const session = host.session();
      return describe(session, session !== null && host.isDirty(session));
    },
  },

  {
    name: "list_recent_documents",
    description: "Schematics the user has opened recently, most recent first.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    destructive: false,
    async run(host) {
      return { documents: await host.recents() };
    },
  },

  {
    name: "open_document",
    description:
      "Open a schematic file, replacing whatever is open. Refuses if the open document has unsaved changes, unless the user has said to discard them.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to a .schem or .schematic file." },
        ...DISCARD,
      },
      required: ["path"],
      additionalProperties: false,
    },
    readOnly: false,
    destructive: false,
    async run(host, args) {
      const { path: filePath, discardUnsavedChanges } = args as {
        path: string;
        discardUnsavedChanges?: boolean;
      };
      const target = must(withinRoot(await host.root(), filePath));
      const current = host.session();
      must(
        mayReplaceDocument(
          current !== null && host.isDirty(current),
          current?.doc.filePath === undefined || current.doc.filePath === null
            ? null
            : path.basename(current.doc.filePath),
          discardUnsavedChanges === true,
        ),
      );
      const session = await host.open(target);
      host.announce(session);
      return describe(session, false);
    },
  },

  {
    name: "create_document",
    description:
      "Start a new, empty schematic, replacing whatever is open. It exists in memory only until save_document_as gives it a path.",
    schema: {
      type: "object",
      properties: {
        width: { type: "integer" },
        height: { type: "integer" },
        length: { type: "integer" },
        format: {
          type: "string",
          enum: ["sponge3", "sponge2", "mcedit", "litematic"],
          description: "Container format. Defaults to sponge3.",
        },
        version: VERSION_PROPERTY,
        ...DISCARD,
      },
      /*
       * Required, exactly as `NewDocumentRequest.version` is on IPC and for the
       * reason written there: the container and the version are not independent,
       * so they are chosen together at the start rather than discovered at save
       * time. Optional here, its absence produced a document with no version tag
       * and raised nothing -- which is the bug, not a default that needed
       * choosing better.
       */
      required: ["width", "height", "length", "version"],
      additionalProperties: false,
    },
    readOnly: false,
    destructive: false,
    async run(host, args) {
      const a = args as {
        width: number;
        height: number;
        length: number;
        format?: SchematicFormat;
        version?: string;
        discardUnsavedChanges?: boolean;
      };
      const format = a.format ?? "sponge3";
      /*
       * Resolved before anything else looks at it, so a label and a name are
       * the same request from here on and an unknown string is refused by name
       * rather than falling through as `null` -- which `dataVersionOf` cannot
       * tell from 1.8.8's genuine absence of a DataVersion.
       */
      const version = resolveVersionName(String(a.version ?? ""));
      if (version === null) {
        throw new McpRefusal(
          `${String(a.version ?? "")} is not a Minecraft version this build knows. ` +
            `Name one of the versions in this tool's schema, such as ${MC_VERSION_NAMES[0]}.`,
        );
      }
      const refusal = host.refusalFor(format, version);
      if (refusal !== null) throw new McpRefusal(refusal);

      const current = host.session();
      must(
        mayReplaceDocument(
          current !== null && host.isDirty(current),
          current?.doc.filePath === undefined || current.doc.filePath === null
            ? null
            : path.basename(current.doc.filePath),
          a.discardUnsavedChanges === true,
        ),
      );
      const session = await host.create(
        { width: a.width, height: a.height, length: a.length },
        format,
        version,
      );
      host.announce(session);
      return describe(session, true);
    },
  },

  {
    name: "save_document",
    description:
      "Write the open schematic back to the file it came from. Fails if it has never been saved — use save_document_as for that.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: false,
    destructive: false,
    async run(host) {
      const session = host.session();
      if (session === null) throw new McpRefusal("No schematic is open.");
      if (session.doc.filePath === null) {
        throw new McpRefusal(
          "This schematic has never been saved, so there is nowhere to write it. " +
            "Use save_document_as with a path.",
        );
      }
      const result = await host.save(session, { filePath: null });
      host.announce(session);
      return {
        filePath: result.filePath,
        format: result.format,
        cropped: result.cropped,
        degraded: result.degraded,
        note:
          result.degraded.length > 0
            ? "Some blocks could not be written exactly in this format and were simplified."
            : undefined,
      };
    },
  },

  {
    name: "save_document_as",
    description:
      "Write the open schematic to a path, and keep editing it there. An existing file at that path is moved aside with a timestamp rather than overwritten.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        format: { type: "string", enum: ["sponge3", "sponge2", "mcedit", "litematic"] },
        /*
         * Optional, and `SaveRequest.version`'s reason for it holds here: left
         * out means "keep what the document carries", which is what a plain save
         * wants. Present at all because it was not, so a client that had created
         * a document could never state its version anywhere.
         */
        version: VERSION_PROPERTY,
      },
      required: ["path"],
      additionalProperties: false,
    },
    readOnly: false,
    destructive: false,
    async run(host, args) {
      const a = args as { path: string; format?: SchematicFormat; version?: string };
      const session = host.session();
      if (session === null) throw new McpRefusal("No schematic is open.");
      const version = a.version === undefined ? undefined : resolveVersionName(a.version);
      if (version === null) {
        throw new McpRefusal(
          `${String(a.version)} is not a Minecraft version this build knows.`,
        );
      }
      if (version !== undefined) {
        const refusal = host.refusalFor(a.format ?? session.doc.format, version);
        if (refusal !== null) throw new McpRefusal(refusal);
      }
      const target = must(withinRoot(await host.root(), a.path));
      const result = await host.save(session, {
        filePath: target,
        format: a.format,
        ...(version === undefined ? {} : { version }),
      });
      host.announce(session);
      return {
        filePath: result.filePath,
        format: result.format,
        cropped: result.cropped,
        degraded: result.degraded,
      };
    },
  },

  {
    name: "close_document",
    description:
      "Close the open schematic. Refuses if it has unsaved changes, unless the user has said to discard them.",
    schema: { type: "object", properties: { ...DISCARD }, additionalProperties: false },
    readOnly: false,
    destructive: false,
    async run(host, args) {
      const { discardUnsavedChanges } = args as { discardUnsavedChanges?: boolean };
      const session = host.session();
      if (session === null) return { open: false, note: "Nothing was open." };
      must(
        mayReplaceDocument(
          host.isDirty(session),
          session.doc.filePath === null ? null : path.basename(session.doc.filePath),
          discardUnsavedChanges === true,
        ),
      );
      host.close();
      host.announce(null);
      return { open: false };
    },
  },

  {
    name: "delete_document",
    description:
      "Move a schematic file to the system trash. Switched off by default; the user turns it on in Settings. Never deletes the schematic that is currently open, and never erases — the file goes to the recycle bin.",
    schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    readOnly: false,
    destructive: true,
    async run(host, args) {
      const { path: filePath } = args as { path: string };
      const session = host.session();
      /*
       * The three questions live in `policy.ts` and the flag is read from
       * settings by the server, not from here: this module has no business
       * knowing where a preference is stored, and the suite can then drive all
       * three answers without one.
       */
      const target = must(
        mayDelete(
          {
            allowDelete: await host.allowDelete(),
            root: await host.root(),
            openFilePath: session?.doc.filePath ?? null,
          },
          filePath,
        ),
      );
      await host.trash(target);
      return {
        deleted: target,
        note: "Moved to the system trash, so the user can restore it from there.",
      };
    },
  },
  {
    name: "list_versions",
    description:
      "The open schematic's own version history — snapshots of the file, kept beside it and outliving this session. Not Minecraft versions: for those, see the version argument on create_document, or set_document_version to change the one this schematic is for.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    destructive: false,
    async run(host) {
      return { versions: await host.versions() };
    },
  },

  {
    name: "save_version",
    description:
      "Snapshot the schematic as it is now, so it can be returned to later. Cheap, and a good idea before anything sweeping.",
    schema: {
      type: "object",
      properties: { label: { type: "string", description: "What this version is, in a few words." } },
      required: ["label"],
      additionalProperties: false,
    },
    readOnly: false,
    destructive: false,
    async run(host, args) {
      const { label } = args as { label: string };
      return { versions: await host.saveVersion(label) };
    },
  },

  {
    name: "restore_version",
    description:
      "Put the schematic back to one of its saved versions. This cannot be undone — but the state you are leaving is snapshotted first, so it is a fork rather than a one-way door.",
    schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    readOnly: false,
    destructive: true,
    async run(host, args) {
      const { id } = args as { id: string };
      const session = await host.restoreVersion(id);
      if (session === null) {
        throw new McpRefusal(
          `No version with id ${id}. Use list_versions to see what there is.`,
        );
      }
      host.announce(session);
      return describe(session, true);
    },
  },

  CAPTURE,
];

export function findLifecycle(name: string): LifecycleSpec | null {
  return LIFECYCLE_SPECS.find((spec) => spec.name === name) ?? null;
}
