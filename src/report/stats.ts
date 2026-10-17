/** "8 prebuilds in 4.2s", "2 prebuilds + 6 cached in 1.1s" or "8 cached prebuilds in 0.4s". */
export function runStats(prebuilds: number, cached: number, durationMs: number): string {
  const plural = (n: number) => `prebuild${n === 1 ? '' : 's'}`;
  const runs = !cached ? `${prebuilds} ${plural(prebuilds)}` : !prebuilds ? `${cached} cached ${plural(cached)}` : `${prebuilds} ${plural(prebuilds)} + ${cached} cached`;
  return `${runs} in ${(durationMs / 1000).toFixed(1)}s`;
}
