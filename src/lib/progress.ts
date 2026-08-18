// Watch-progress arithmetic, extracted so it can be tested on its own.
//
// The distinction this module exists to enforce: a playback position is measured
// against *the film*, but `video.duration` measures *the stream that is playing*.
// Those are the same number only when the stream starts at zero. Whenever the
// transcode proxy is handed a `start` offset — resuming, seeking, switching audio
// — the stream is shorter than the film, and mixing the two silently corrupts the
// saved progress. See finding C1.

/** Fraction of the film watched. 0 when the inputs can't support an answer. */
export function watchedFraction(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  if (!Number.isFinite(position) || position <= 0) return 0
  return position / duration
}

// A position may legitimately land slightly past the reported duration: copy-mode
// seeks snap to a keyframe and container durations are approximate. Beyond this
// much, the two numbers are measuring different things and no honest conclusion
// can be drawn from them.
const IMPLAUSIBLE_RATIO = 1.1

/**
 * Whether an item counts as finished, and so should drop out of Continue Watching.
 *
 * A ratio far above 1 does not mean "extra finished" — it means the position and
 * the duration came from different clocks. Refusing to decide is the recoverable
 * direction: the title stays in the row and the next honest save corrects it,
 * whereas a wrong `true` makes it vanish while the user is still watching.
 */
export function isCompleted(position: number, duration: number): boolean {
  const fraction = watchedFraction(position, duration)
  if (fraction > IMPLAUSIBLE_RATIO) return false
  return fraction > 0.9
}

/**
 * The film's full duration, for storing alongside a position.
 *
 * @param transcodedDuration Duration ffprobe reported for the whole file, or null
 *   when the item was never probed (live, or a direct browser source).
 * @param videoDuration `video.duration` — the *remaining* length for an offset
 *   stream, and Infinity or NaN for a fragmented MP4 with no declared length.
 */
export function resolveSaveDuration(
  transcodedDuration: number | null,
  videoDuration: number,
): number {
  if (transcodedDuration != null && Number.isFinite(transcodedDuration) && transcodedDuration > 0) {
    return transcodedDuration
  }
  return Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : 0
}

/** Percentage for progress bars and rings. Clamped, so a bad row can't overflow a bar. */
export function progressPercent(position: number, duration: number): number {
  return Math.min(100, Math.max(0, watchedFraction(position, duration) * 100))
}

/**
 * Whether an `ended` event landed at the real end of the film.
 *
 * A transcoded source is served as a window starting at an offset, so `ended`
 * fires whenever playback catches up with the encoder or the session is torn
 * down mid-seek — both of which happen in the middle of an episode. Only real
 * time can tell those apart from a film that actually finished.
 *
 * @param realPosition  playbackOffset + video.currentTime
 * @param realDuration  the probed length of the whole film, not of the window
 */
export function isPlaybackAtEnd(
  realPosition: number,
  realDuration: number,
  toleranceSeconds = 45,
): boolean {
  if (!Number.isFinite(realDuration) || realDuration <= 0) return false
  if (!Number.isFinite(realPosition) || realPosition < 0) return false
  return realDuration - realPosition <= toleranceSeconds
}
