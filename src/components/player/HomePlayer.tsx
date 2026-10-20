import { useEffect, useMemo, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { Captions, X } from 'lucide-react'
import {
  getPlaybackSource, locatePart, reportPlayback,
  type HomePart, type HomeSubtitle, type PlaybackSource,
} from '@/services/jellyfin'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { useProfileStore } from '@/stores/profileStore'
import { usePlaybackPrefsStore } from '@/stores/playbackPrefsStore'
import { pickHomeSubtitle, samePick, subtitleLabel, SUBTITLES_OFF } from '@/lib/homeSubtitles'
import { subtitleFont } from '@/lib/subtitleSize'
import { SubtitleSizePicker } from '@/components/ui/SubtitleSizePicker'
import { useLocale, useT } from '@/lib/i18n'
import { isKiosk } from '@/lib/kiosk'
import { clearPlayerBridge, markPlayerFailed, setPlayerBridge, type BridgeTracks } from '@/lib/playerBridge'
import { playsHlsItself } from '@/lib/nativeHls'

const REPORT_EVERY_MS = 10_000

/**
 * Where the player is opened: which part of the film, how far into it, and which
 * subtitle stream of that file (undefined: carry the film's choice over). A new
 * cursor opens the player again, which is how a burnt-in subtitle is changed and
 * how a split film moves on to its next file.
 */
interface Cursor { part: number; at: number; subIndex?: number | null; n: number }

/**
 * The player for the home library. Deliberately separate from VideoPlayer.
 *
 * VideoPlayer exists to make raw IPTV streams playable: probing, server-side seeking,
 * subtitle extraction, keyframe tricks, all through the transcode proxy. Jellyfin
 * already serves what a browser can play, as a file or as seekable HLS, so none of
 * that applies here and none of it should be at risk from this.
 *
 * The browser's own controls are used on purpose: on an iPhone that is the system
 * player, with AirPlay and picture-in-picture for free. Text subtitles are
 * ordinary <track>s, so the system player lists them too; picture subtitles are
 * burnt in by the server, chosen from the menu in the top bar.
 */
export function HomePlayer() {
  const t = useT()
  const locale = useLocale()
  const { playing, session, close } = useHomeLibraryStore()
  // The player follows the token, not the session object: every list reload made
  // a new object, and the player took that for a new session and started the film
  // again from where it had opened. A tab switch was enough (it reloads the list).
  const sessionToken = session?.token
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const prefs = usePlaybackPrefsStore((s) => s.byProfile[activeProfileId ?? ''])
  const setPrefs = usePlaybackPrefsStore((s) => s.setPrefs)
  const setTitlePrefs = usePlaybackPrefsStore((s) => s.setTitlePrefs)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [subs, setSubs] = useState<HomeSubtitle[]>([])
  const [chosen, setChosen] = useState<HomeSubtitle | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // The film's subtitle choice, carried from file to file. Undefined until the
  // first file has been read and a choice made from what it offers.
  const choiceRef = useRef<HomeSubtitle | null | undefined>(undefined)
  const sourceRef = useRef<PlaybackSource | null>(null)
  const bridgeRef = useRef<{ tracks: () => BridgeTracks; choose: (id: number) => void }>({
    tracks: () => ({ audio: [], audioActive: -1, subtitles: [], subtitleActive: -1 }),
    choose: () => {},
  })
  const titleKey = playing ? `jf:${playing.id}` : ''
  const subtitleSize = prefs?.subtitleSize ?? 'm'
  // On the kiosk the phone is the remote: no top bar, no browser controls, and the
  // kiosk reaches the <video> through the bridge (KioskApp).
  const kiosk = isKiosk()

  const parts = useMemo<HomePart[]>(() => (playing
    ? playing.parts ?? [{ id: playing.id, durationSec: playing.durationSec, positionSec: playing.positionSec, played: playing.played, lastPlayedAt: playing.lastPlayedAt }]
    : []), [playing])

  // A new film: open it where this profile left it, here or in Swiftfin.
  useEffect(() => {
    choiceRef.current = undefined
    setSubs([])
    setChosen(null)
    setMenuOpen(false)
    if (!playing) { setCursor(null); return }
    const resume = !playing.played && playing.positionSec > 10 ? playing.positionSec : 0
    const { index, offsetSec } = locatePart(parts, resume)
    setCursor({ part: index, at: offsetSec, n: 0 })
  }, [playing, parts])

  useEffect(() => {
    const video = videoRef.current
    const session = useHomeLibraryStore.getState().session
    if (!playing || !session || !video || !cursor) return
    const part = parts[cursor.part]
    if (!part) return
    setFailed(false)
    let cancelled = false
    let hls: Hls | null = null
    let source: PlaybackSource | null = null
    let started = false
    let stopped = false
    // The first cursor already starts at 0 below ten seconds (the resume rule);
    // a reopen for another subtitle starts at the very second it left.
    const startAt = cursor.at > 1 ? cursor.at : 0
    // Film time is the parts before this one plus where this file is. A seek stays
    // inside the file that is playing: crossing into the next part is a new file.
    const offset = parts.slice(0, cursor.part).reduce((sum, p) => sum + p.durationSec, 0)
    const total = parts.reduce((sum, p) => sum + p.durationSec, 0)
    setPlayerBridge({
      video,
      position: () => offset + video.currentTime,
      duration: () => total,
      seek: (to) => {
        const end = Number.isFinite(video.duration) && video.duration > 0 ? video.duration - 1 : Infinity
        video.currentTime = Math.max(0, Math.min(end, to - offset))
      },
      close: () => useHomeLibraryStore.getState().close(),
      live: false,
      // Subtitles only: the server sends one audio stream, the file's default.
      tracks: () => bridgeRef.current.tracks(),
      selectSubtitle: (id) => bridgeRef.current.choose(id),
    })

    const stop = () => {
      if (!source || !started || stopped) return
      stopped = true
      // Stopped is what makes the server save the position and end the transcode.
      // Read the list again once it has, so the card shows where this left off.
      void reportPlayback(session, source, 'stopped', video.currentTime).then(() => useHomeLibraryStore.getState().reload())
    }

    ;(async () => {
      try {
        const clean = await getPlaybackSource(session, part.id)
        if (cancelled) return
        if (choiceRef.current === undefined) {
          const remembered = usePlaybackPrefsStore.getState().getTitlePrefs(activeProfileId, titleKey).subtitleLang
          choiceRef.current = pickHomeSubtitle(clean.subtitles, remembered, prefs?.preferredSubtitleLang ?? '')
        }
        const here = cursor.subIndex !== undefined
          ? clean.subtitles.find((s) => s.index === cursor.subIndex) ?? null
          : samePick(clean.subtitles, choiceRef.current ?? null)
        source = here && !here.text ? await getPlaybackSource(session, part.id, { burnIn: here.index }) : clean
        if (cancelled) return
        sourceRef.current = source
        setSubs(source.subtitles)
        setChosen(here)

        const playDirect = (url: string) => {
          video.src = url
          if (startAt > 0) {
            video.addEventListener('loadedmetadata', () => { video.currentTime = startAt }, { once: true })
          }
        }
        if (source.hls && !playsHlsItself(video)) {
          const HlsLib = (await import('hls.js')).default
          if (cancelled) return
          if (HlsLib.isSupported()) {
            hls = new HlsLib({ startPosition: startAt > 0 ? startAt : -1 })
            hls.on(HlsLib.Events.ERROR, (_e, data) => { if (data.fatal) { setFailed(true); markPlayerFailed(video) } })
            hls.loadSource(source.url)
            hls.attachMedia(video)
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            playDirect(source.url)
          } else {
            throw new Error('no MSE')
          }
        } else {
          playDirect(source.url)
        }
        // May be refused outside the tap that opened the player (iOS). The controls
        // then show a play button, which is the right fallback.
        video.play().catch(() => {})
      } catch {
        if (!cancelled) { setFailed(true); markPlayerFailed(video) }
      }
    })()

    const onPlaying = () => {
      if (!source) return
      if (!started) { started = true; void reportPlayback(session, source, 'start', video.currentTime) }
    }
    const onPause = () => { if (source && started && !video.ended) void reportPlayback(session, source, 'progress', video.currentTime, true) }
    const onEnded = () => {
      stop()
      // A split film goes straight on to its next file.
      if (cursor.part < parts.length - 1) setCursor({ part: cursor.part + 1, at: 0, n: cursor.n + 1 })
      // The kiosk goes back to its idle screen; nobody is there to press close.
      else if (kiosk) close()
    }
    video.addEventListener('playing', onPlaying)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    const timer = window.setInterval(() => {
      if (source && started && !video.paused) void reportPlayback(session, source, 'progress', video.currentTime)
    }, REPORT_EVERY_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      stop()
      clearPlayerBridge(video)
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
    // `prefs` is read once per file, on purpose: changing the size must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, sessionToken])

  // Show the chosen text track, hide the rest. The <track>s are in `textSubs` order.
  const textSubs = useMemo(() => subs.filter((s) => s.text && s.url), [subs])
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const tracks = Array.from(video.textTracks)
    textSubs.forEach((s, i) => {
      if (tracks[i]) tracks[i].mode = chosen?.text && chosen.index === s.index ? 'showing' : 'disabled'
    })
  }, [textSubs, chosen])

  useEffect(() => {
    if (!playing) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (menuOpen) setMenuOpen(false); else close() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, close, menuOpen])

  const choose = (s: HomeSubtitle | null) => {
    setMenuOpen(false)
    choiceRef.current = s
    // Remembered per film: a language, or off. An untagged stream has no language
    // to remember, so the film keeps whatever it had.
    if (!s) setTitlePrefs(activeProfileId, titleKey, { subtitleLang: SUBTITLES_OFF })
    else if (s.lang) setTitlePrefs(activeProfileId, titleKey, { subtitleLang: s.lang })
    const video = videoRef.current
    const burning = sourceRef.current?.burntIn !== undefined
    // A picture subtitle, or leaving one, means a different picture: reopen the
    // file at the same second. Text tracks switch in place.
    if ((s && !s.text) || burning) {
      if (cursor && video) setCursor({ part: cursor.part, at: video.currentTime, subIndex: s?.index ?? null, n: cursor.n + 1 })
    } else {
      setChosen(s)
    }
  }

  // What the kiosk's bridge reads and chooses through: this render's menu.
  bridgeRef.current = {
    tracks: () => ({
      audio: [],
      audioActive: -1,
      subtitles: subs.map((s) => ({ id: s.index, name: subtitleLabel(s, locale, t('player.track', { number: s.index + 1 })) })),
      subtitleActive: chosen?.index ?? -1,
    }),
    choose: (id) => choose(id === -1 ? null : subs.find((s) => s.index === id) ?? null),
  }

  if (!playing) return null

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <style>{`.sf-home-video::cue { font-size: ${subtitleFont(subtitleSize)}; line-height: 1.25; background-color: rgba(0, 0, 0, 0.75); }`}</style>
      {!kiosk && <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 pt-safe px-safe">
        <button
          onClick={close}
          aria-label={t('common.close')}
          className="m-3 w-11 h-11 shrink-0 rounded-full bg-black/60 ring-1 ring-white/20 flex items-center justify-center text-white"
        >
          <X size={18} />
        </button>
        <p className="flex-1 min-w-0 text-body text-white/90 font-medium truncate">
          {playing.name}
          {parts.length > 1 && cursor && (
            <span className="text-white/60"> · {t('homePlayer.part', { part: cursor.part + 1, count: parts.length })}</span>
          )}
        </p>
        {subs.length > 0 && (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('player.subtitles')}
            aria-expanded={menuOpen}
            className={`m-3 w-11 h-11 shrink-0 rounded-full ring-1 ring-white/20 flex items-center justify-center ${
              chosen ? 'bg-accent-600/70 text-white' : 'bg-black/60 text-white'
            }`}
          >
            <Captions size={18} />
          </button>
        )}
      </div>}
      {menuOpen && (
        <div
          role="menu"
          className="absolute top-[calc(4.5rem+env(safe-area-inset-top,0px))] right-3 z-20 w-64 max-w-[calc(100vw-1.5rem)] bg-black/90 rounded-xl p-3 ring-1 ring-white/10 shadow-2xl"
        >
          <p className="text-white/50 text-xs uppercase tracking-wider mb-2 px-2">{t('player.subtitles')}</p>
          {[null, ...subs].map((s) => {
            const on = (chosen?.index ?? null) === (s?.index ?? null)
            return (
              <button
                key={s?.index ?? 'off'}
                role="menuitemradio"
                aria-checked={on}
                onClick={() => choose(s)}
                className={`flex items-center gap-2 w-full min-h-11 px-2 rounded-lg hover:bg-white/10 text-left text-sm ${on ? 'text-accent-400' : 'text-white/80'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? 'bg-accent-500' : 'bg-white/30'}`} />
                {s ? subtitleLabel(s, locale, t('player.track', { number: s.index + 1 })) : t('player.subtitlesOff')}
              </button>
            )
          })}
          <div className="border-t border-white/10 my-2" />
          <p className="text-white/50 text-xs uppercase tracking-wider mb-2 px-2">{t('player.subSize')}</p>
          <SubtitleSizePicker
            value={subtitleSize}
            onChange={(size) => { if (activeProfileId) setPrefs(activeProfileId, { subtitleSize: size }) }}
          />
        </div>
      )}
      <video
        ref={videoRef}
        controls={!kiosk}
        playsInline
        autoPlay
        // The subtitle files are on the same server as the video but not on this
        // page's origin; a <track> from another origin loads only in CORS mode.
        crossOrigin="anonymous"
        className="sf-home-video w-full h-full object-contain bg-black"
        onClick={() => setMenuOpen(false)}
      >
        {textSubs.map((s) => (
          <track
            key={`${sourceRef.current?.playSessionId}:${s.index}`}
            kind="subtitles"
            src={s.url}
            srcLang={s.lang ?? ''}
            label={subtitleLabel(s, locale, t('player.track', { number: s.index + 1 }))}
          />
        ))}
      </video>
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
          <p className="text-body text-white/80 bg-black/70 rounded-lg px-4 py-3">{t('home.playFailed')}</p>
        </div>
      )}
    </div>
  )
}
