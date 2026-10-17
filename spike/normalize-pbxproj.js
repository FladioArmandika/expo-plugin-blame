// Rename UUIDs that are not in `stable` to content-derived ids, so the same
// objects get the same ids on every run. Works on raw text (no re-serialize).
const crypto = require('crypto');
const UUID = /\b[0-9A-F]{24}\b/g;
function objects(text) {
  // top-level object lines/blocks inside `objects = { ... }`: "\t\tUUID /* c */ = {...};"
  const map = new Map();
  const re = /^\t\t([0-9A-F]{24})(?: \/\*.*?\*\/)? = (\{[\s\S]*?\n?\t*\});$/gm;
  let m; while ((m = re.exec(text))) map.set(m[1], m[2]);
  return map;
}
function normalize(text, stable = new Set()) {
  const objs = objects(text);
  const fresh = [...objs.keys()].filter((u) => !stable.has(u));
  let key = new Map(fresh.map((u) => [u, 'x']));
  for (let round = 0; round < 6; round++) {
    const next = new Map();
    for (const u of fresh) {
      const body = objs.get(u).replace(UUID, (r) => (key.has(r) ? `<${key.get(r)}>` : r));
      next.set(u, crypto.createHash('sha1').update(body).digest('hex').slice(0, 24).toUpperCase());
    }
    key = next;
  }
  // also fold in who references the object (two identical PBXBuildFiles in different phases)
  const seen = new Map(); const rename = new Map();
  for (const u of fresh.sort((a, b) => (key.get(a) < key.get(b) ? -1 : 1))) {
    const k = key.get(u); const n = seen.get(k) || 0; seen.set(k, n + 1);
    rename.set(u, n ? crypto.createHash('sha1').update(k + n).digest('hex').slice(0, 24).toUpperCase() : k);
  }
  return text.replace(UUID, (u) => rename.get(u) || u);
}
module.exports = { normalize, objects };
if (require.main === module) {
  const fs = require('fs');
  const [file, baseline] = process.argv.slice(2);
  const stable = baseline ? new Set(objects(fs.readFileSync(baseline, 'utf8')).keys()) : new Set();
  process.stdout.write(normalize(fs.readFileSync(file, 'utf8'), stable));
}
