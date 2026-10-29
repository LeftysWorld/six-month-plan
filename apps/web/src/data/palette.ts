/** Small colour helpers for the Goals page: every group gets a gradient of its own. */

/** A stable 0..1 from a string (the group's id), so a group's colours don't change between visits. */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * 32 three-colour gradients for groups and paths, in the same family as the goal colours (bright,
 * mid-light, never muddy). A card that has fewer than two goal colours of its own takes one of these,
 * by its place in the list (see gradientSlots), so the first 32 groups and paths never repeat.
 */
export const GROUP_GRADIENTS: [string, string, string][] = [
  ['#5B8CFF', '#8B6CF6', '#E8559B'],
  ['#22B07D', '#3FB6C9', '#5B8CFF'],
  ['#FF7A45', '#E8559B', '#8B6CF6'],
  ['#3FB6C9', '#22B07D', '#A3C93A'],
  ['#F5B83D', '#FF7A45', '#E8559B'],
  ['#8B6CF6', '#5B8CFF', '#3FB6C9'],
  ['#E8559B', '#FF7A45', '#F5B83D'],
  ['#22B07D', '#5B8CFF', '#8B6CF6'],
  ['#4FD3E8', '#8E7DFF', '#E86AD6'],
  ['#FF6B6B', '#FFA94D', '#FFD43B'],
  ['#12B886', '#38D9A9', '#4FD3E8'],
  ['#7950F2', '#BE4BDB', '#F06595'],
  ['#339AF0', '#22B8CF', '#20C997'],
  ['#FD7E14', '#FA5252', '#E64980'],
  ['#94D82D', '#40C057', '#12B886'],
  ['#5C7CFA', '#3B5BDB', '#15AABF'],
  ['#F783AC', '#DA77F2', '#9775FA'],
  ['#FFA94D', '#FF8787', '#DA77F2'],
  ['#3BC9DB', '#4DABF7', '#748FFC'],
  ['#63E6BE', '#74C0FC', '#B197FC'],
  ['#FFD43B', '#94D82D', '#38D9A9'],
  ['#E8590C', '#D6336C', '#7048E8'],
  ['#0CA678', '#1098AD', '#1C7ED6'],
  ['#F59F00', '#F76707', '#E03131'],
  ['#AE3EC9', '#7048E8', '#4263EB'],
  ['#FF8FA3', '#FFB86B', '#FFE066'],
  ['#40C057', '#22B8CF', '#7950F2'],
  ['#1971C2', '#6741D9', '#C2255C'],
  ['#20C997', '#FAB005', '#FD7E14'],
  ['#845EF7', '#F06595', '#FF922B'],
  ['#22B8CF', '#5C7CFA', '#CC5DE8'],
  ['#E64980', '#BE4BDB', '#4DABF7'],
];

/**
 * Each group's and path's place in the palette: groups in the order they were made, then paths in
 * their order, then the "Not in a group" and "No path" cards. A new group takes the next gradient,
 * so adding groups keeps them distinct (after 32 the palette starts over).
 */
export function gradientSlots(data: { groups: { id: string; created_at: string }[]; paths?: { id: string; rank: number; archived_at?: string | null }[] }): Map<string, number> {
  const groups = [...data.groups].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  const paths = [...(data.paths ?? [])].filter((p) => !p.archived_at).sort((a, b) => a.rank - b.rank);
  const keys = [...groups.map((g) => g.id), ...paths.map((p) => p.id), 'loose', 'no-path'];
  return new Map(keys.map((k, i) => [k, i % GROUP_GRADIENTS.length]));
}

/**
 * The gradient for a group (or a path, or the loose card): its goals' colours when it has two or
 * more different ones, so it reads as its goals; otherwise one of the 32 curated gradients, by its
 * slot (or, with no slot, one picked from its id so it's the same every visit).
 */
export function groupGradient(groupId: string, colors: string[], angle = 100, slot?: number): string {
  const distinct = [...new Set(colors.map((c) => c.toLowerCase()))];
  const stops = distinct.length >= 2 ? distinct : GROUP_GRADIENTS[(slot ?? Math.floor(seed(groupId) * GROUP_GRADIENTS.length)) % GROUP_GRADIENTS.length]!.map((c) => c.toLowerCase());
  const n = stops.length;
  return `linear-gradient(${angle}deg, ${stops.map((c, i) => `${c} ${Math.round((i / (n - 1)) * 100)}%`).join(', ')})`;
}
