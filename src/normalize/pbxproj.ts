import { createHash } from 'node:crypto';

// Xcode object ids are 24 uppercase hex chars. Plugins that add objects through
// the `xcode` package get random ids on every run, so prebuild output is only
// comparable after those ids are replaced with ones derived from content.
const OBJECT_ID = /\b[0-9A-F]{24}\b/g;

// One object entry inside `objects = { ... }`, e.g.
//   \t\tABC... /* main.m */ = {isa = PBXBuildFile; fileRef = DEF... /* main.m */; };
// Multi-line entries end with a `\t\t};` line at the same depth.
const OBJECT_ENTRY = /^\t\t([0-9A-F]{24})(?: \/\*.*?\*\/)? = (\{[\s\S]*?\n?\t*\});$/gm;

// Enough for the reference depth plugins realistically create
// (group -> file reference -> build file -> build phase).
const HASH_ROUNDS = 6;

const hashId = (input: string): string =>
  createHash('sha1').update(input).digest('hex').slice(0, 24).toUpperCase();

/** Maps each object id in a `project.pbxproj` to its body text. */
export function parseObjects(text: string): Map<string, string> {
  const objects = new Map<string, string>();
  for (const match of text.matchAll(OBJECT_ENTRY)) {
    objects.set(match[1]!, match[2]!);
  }
  return objects;
}

/**
 * Replaces every object id not in `stableIds` with an id derived from the
 * object's content, so identical inputs give identical text across runs.
 *
 * `stableIds` should be the ids from the baseline prebuild: those come from
 * Expo's template and are already stable, and keeping them leaves untouched
 * lines identical between steps. Works on the raw text, so nothing else about
 * the file's formatting changes.
 */
export function normalizePbxproj(text: string, stableIds: ReadonlySet<string> = new Set()): string {
  const objects = parseObjects(text);
  const freshIds = [...objects.keys()].filter((id) => !stableIds.has(id));

  // Hash each fresh object's body, with references to other fresh objects
  // replaced by their hash from the previous round, until references resolve.
  let keys = new Map(freshIds.map((id) => [id, '']));
  for (let round = 0; round < HASH_ROUNDS; round++) {
    const next = new Map<string, string>();
    for (const id of freshIds) {
      const body = objects
        .get(id)!
        .replace(OBJECT_ID, (ref) => (keys.has(ref) ? `<${keys.get(ref)}>` : ref));
      next.set(id, hashId(body));
    }
    keys = next;
  }

  // Exact duplicates hash the same; give them an ordinal in a stable order.
  const seen = new Map<string, number>();
  const rename = new Map<string, string>();
  for (const id of [...freshIds].sort((a, b) => keys.get(a)!.localeCompare(keys.get(b)!))) {
    const key = keys.get(id)!;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    rename.set(id, count === 0 ? key : hashId(`${key}#${count}`));
  }

  return text.replace(OBJECT_ID, (id) => rename.get(id) ?? id);
}
