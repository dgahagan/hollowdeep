// WCAG AA contrast checker for the Phase 3 theme tokens (T1/T11).
// Run: node dev/contrast-check.mjs — exits 1 if any pair misses its target.
// Targets: 4.5:1 body text, 3:1 large text (>=18.66px bold / 24px) and UI parts.

const srgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 0xff, n & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
};
const lum = (hex) => {
  const [r, g, b] = srgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ---- The shipped tokens (keep in sync with src/app/theme.css) ----
export const dark = {
  surface0: '#16130f',
  surface1: '#201a12',
  surface2: '#2a2317',
  border: '#4a3f2e', // decorative separators only — exempt from 1.4.11
  borderStrong: '#8a795c', // interactive control boundaries — 3:1 required
  ink: '#e8ddc8',
  inkMuted: '#b0a086',
  accent: '#d9a441',
  danger: '#e08663',
  success: '#9dc186',
};

export const light = {
  surface0: '#ede2cb',
  surface1: '#f6efe0',
  surface2: '#fdf9ef',
  border: '#b3a284', // decorative separators only — exempt from 1.4.11
  borderStrong: '#7c6c4e', // interactive control boundaries — 3:1 required
  ink: '#2e2618',
  inkMuted: '#5d5138',
  accent: '#7d5514',
  danger: '#9c3116',
  success: '#33591f',
};

const checks = [];
for (const [name, t] of [
  ['dark', dark],
  ['light', light],
]) {
  for (const surface of ['surface0', 'surface1', 'surface2']) {
    checks.push([`${name} ink on ${surface}`, t.ink, t[surface], 4.5]);
    checks.push([`${name} inkMuted on ${surface}`, t.inkMuted, t[surface], 4.5]);
    checks.push([`${name} accent on ${surface}`, t.accent, t[surface], 4.5]);
    checks.push([`${name} danger on ${surface}`, t.danger, t[surface], 4.5]);
    checks.push([`${name} success on ${surface}`, t.success, t[surface], 4.5]);
  }
  // Interactive control boundaries (inputs, buttons): 3:1 per WCAG 1.4.11.
  // `border` is decorative panel separation only and is exempt.
  checks.push([`${name} borderStrong on surface0`, t.borderStrong, t.surface0, 3]);
  checks.push([`${name} borderStrong on surface1`, t.borderStrong, t.surface1, 3]);
  checks.push([`${name} borderStrong on surface2`, t.borderStrong, t.surface2, 3]);
}

let failed = 0;
for (const [label, fg, bg, target] of checks) {
  const r = ratio(fg, bg);
  const ok = r >= target;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(30)} ${r.toFixed(2)}:1  (needs ${target}:1)`,
  );
}
if (failed) {
  console.error(`\n${failed} contrast pair(s) below target.`);
  process.exit(1);
}
console.log('\nAll token pairs meet WCAG AA.');
