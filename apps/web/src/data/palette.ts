/** Small colour helpers for the Goals page: every group gets a gradient of its own. */

function hexToHsl(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r!)}${to(g!)}${to(b!)}`;
}

/** A stable 0..1 from a string (the group's id), so a group's colours don't change between visits. */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * The gradient for a group: its goals' colours when there are two or more different ones; otherwise
 * the one colour it has, run toward a second hue picked from the group's id (so a one-goal group,
 * or two goals with the same colour, still gets a gradient of its own, and the same one every time).
 */
export function groupGradient(groupId: string, colors: string[], angle = 100): string {
  const distinct = [...new Set(colors.map((c) => c.toLowerCase()))];
  let stops = distinct;
  if (distinct.length < 2) {
    const base = hexToHsl(distinct[0] ?? '') ?? [seed(groupId) * 360, 0.75, 0.6];
    const turn = 35 + seed(groupId + 'turn') * 50; // 35°–85° around the wheel
    const dir = seed(groupId + 'dir') < 0.5 ? -1 : 1;
    const second = hslToHex(base[0] + dir * turn, Math.min(1, Math.max(0.55, base[1])), Math.min(0.68, Math.max(0.45, base[2] + 0.06)));
    stops = [distinct[0] ?? hslToHex(base[0], base[1], base[2]), second];
  }
  const n = stops.length;
  return `linear-gradient(${angle}deg, ${stops.map((c, i) => `${c} ${Math.round((i / (n - 1)) * 100)}%`).join(', ')})`;
}
