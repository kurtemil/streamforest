import { setWatched } from './db'
import { deleteRemoteProgressMany, pushProgressMany } from './sync'

/**
 * Mark a film, an episode, a season or a whole show as watched or not, here and
 * on every other device (D1). Suggested in the app's feedback box 2026-09-11.
 */
export async function markWatched(profileId: string, channelIds: string[], watched: boolean): Promise<void> {
  const entries = await setWatched(profileId, channelIds, watched)
  if (watched) await pushProgressMany(entries)
  else await deleteRemoteProgressMany(profileId, channelIds)
}
