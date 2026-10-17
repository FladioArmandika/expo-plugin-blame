// prototype: PB_STEP=k keeps the first k user plugins; the rest are marked as
// "already run" so Expo's auto-applied legacy plugins don't sneak them back in.
module.exports = ({ config }) => {
  const all = config.plugins || [];
  const k = Number(process.env.PB_STEP ?? all.length);
  const name = (p) => (Array.isArray(p) ? p[0] : p);
  const suppressed = all.slice(k).map(name).filter((n) => typeof n === 'string' && !n.startsWith('.'));
  const seed = (c) => {
    c._internal = c._internal || {}; c._internal.pluginHistory = c._internal.pluginHistory || {};
    for (const n of suppressed) c._internal.pluginHistory[n] ??= { name: n, version: 'suppressed-by-prebuild-blame' };
    return c;
  };
  return { ...config, plugins: [seed, ...all.slice(0, k)] };
};
