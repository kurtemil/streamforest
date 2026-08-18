export interface SeenRow { id: string; firstSeenAt: number }

/**
 * Which of the seen-ids count as recently added.
 *
 * Kept apart from Dexie because this is the judgement, and the judgement is what
 * was wrong before: "Recently Added" ranked by position in the M3U file, so a
 * Christmas film that happened to sit near the top of the playlist was still
 * being called new in July. There is no date in an M3U, so the app stamps ids it
 * has not seen before and this decides what that history is allowed to claim.
 *
 * Two rules, both of which exist to let the row say nothing:
 *
 * - The oldest stamp is the baseline import. Everything carrying it arrived in
 *   one go — a library, not an arrival — so none of it is recent. On a fresh
 *   install every row shares that stamp and the result is empty, which is the
 *   correct answer until an import brings something the last one did not have.
 * - Past `maxAgeDays`, nothing is recent any more. Without this a library that
 *   stopped being updated would keep presenting its last delivery as new
 *   forever, which is the original bug wearing a different hat.
 */
export function pickRecentlyAdded(
  rows: readonly SeenRow[],
  now: number,
  maxAgeDays = 45,
): string[] {
  if (!rows.length) return []
  let baseline = Infinity
  for (const r of rows) if (r.firstSeenAt < baseline) baseline = r.firstSeenAt
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000
  return rows
    .filter((r) => r.firstSeenAt > baseline && r.firstSeenAt >= cutoff)
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt)
    .map((r) => r.id)
}
