import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Settings, RefreshCw, Trash2, Check, AlertCircle, Download, Database, ChevronDown, EyeOff, Shield, Users, Tv, ImageOff, Play, Languages, MessageSquarePlus } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { useEpgStore } from '@/stores/epgStore'
import { epgUrlFromM3u } from '@/services/epg'
import { getPlaylistMeta, clearPlaylist, clearTmdbNotFound } from '@/services/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useExclusionsStore, type ContentType } from '@/stores/exclusionsStore'
import { useProfileStore, getProfile, PROFILES } from '@/stores/profileStore'
import { useKidRestrictions } from '@/stores/kidRestrictionsStore'
import { usePlaybackPrefsStore } from '@/stores/playbackPrefsStore'
import { VlcHandlerSection } from '@/components/settings/VlcHandlerSection'
import { LanguageSwitch } from '@/components/ui/LanguageSwitch'
import { formatDateTime, formatNumber, useT, type MessageKey } from '@/lib/i18n'

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

/** The languages offered for the audio and subtitle track defaults. */
const TRACK_LANGS = ['sv', 'en', 'no', 'da', 'fi', 'de', 'fr', 'es', 'ar'] as const

function ProgressBar({ label, icon, pct, indeterminate, detail }: {
  label: string
  icon: React.ReactNode
  pct: number | null
  indeterminate?: boolean
  detail?: string
}) {
  const t = useT()
  const isDone = pct === -1
  const isActive = pct !== null && !isDone
  const displayPct = isDone ? 100 : (pct ?? 0)

  return (
    <div className={`flex flex-col gap-1.5 transition-opacity ${pct === null ? 'opacity-40' : 'opacity-100'}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-neutral-400">
          {icon}
          {label}
          {isDone && <span className="text-accent-500 font-medium">{t('settings.progressDone')}</span>}
        </span>
        <span className="text-neutral-500">
          {isDone ? '100%' : isActive && !indeterminate ? `${displayPct}%` : ''}
          {detail && isActive ? `  ·  ${detail}` : ''}
        </span>
      </div>
      <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isDone
              ? 'bg-accent-500 w-full'
              : indeterminate && isActive
              ? 'w-full animate-shimmer bg-gradient-to-r from-accent-800 via-accent-500 to-accent-800 bg-[length:200%_100%]'
              : 'bg-accent-500'
          }`}
          style={!isDone && !indeterminate ? { width: `${displayPct}%` } : undefined}
        />
      </div>
    </div>
  )
}

function GroupFilterPanel({
  label, type, groups, excluded, toggle, setAll, cleanTitle = (g) => g,
}: {
  label: MessageKey
  type: ContentType
  groups: { title: string; count: number }[]
  excluded: Set<string>
  toggle: (type: ContentType, group: string) => void
  setAll: (type: ContentType, groups: string[], hide: boolean) => void
  cleanTitle?: (title: string) => string
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')

  const hiddenCount = groups.filter((g) => excluded.has(g.title)).length
  const filtered = search.trim()
    ? groups.filter((g) => cleanTitle(g.title).toLowerCase().includes(search.toLowerCase()))
    : groups

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 bg-white/3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">{t(label)}</span>
          {hiddenCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
              {t('settings.hiddenCount', { count: hiddenCount })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-neutral-500 text-xs">
          <span>{t('settings.groupCount', { count: groups.length })}</span>
          <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="p-4 flex flex-col gap-3 border-t border-white/5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('settings.filterGroups')}
              className="flex-1 bg-white/5 border border-white/8 rounded-lg min-h-11 px-3 py-1.5 text-base can-hover:text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-accent-600/60 transition-colors"
            />
            <button
              onClick={() => setAll(type, groups.map((g) => g.title), true)}
              className="min-h-11 px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-neutral-400 transition-colors whitespace-nowrap"
            >
              {t('settings.hideAll')}
            </button>
            <button
              onClick={() => setAll(type, [], false)}
              className="min-h-11 px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-400 transition-colors whitespace-nowrap"
            >
              {t('settings.showAll')}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto flex flex-col gap-0.5 pr-1 scrollbar-hide">
            {filtered.map((g) => {
              const hidden = excluded.has(g.title)
              return (
                <button
                  key={g.title}
                  onClick={() => toggle(type, g.title)}
                  className={`flex items-center gap-3 min-h-11 px-3 py-2 rounded-lg text-sm transition-colors text-left w-full ${
                    hidden ? 'text-neutral-600' : 'text-neutral-300 hover:bg-white/5'
                  }`}
                >
                  <div className={`w-4 h-4 rounded shrink-0 border flex items-center justify-center transition-colors ${
                    hidden ? 'bg-red-500/20 border-red-500/40' : 'border-white/20'
                  }`}>
                    {hidden && <EyeOff size={9} className="text-red-400" />}
                  </div>
                  <span className={`flex-1 truncate ${hidden ? 'opacity-40' : ''}`}>
                    {cleanTitle(g.title)}
                  </span>
                  <span className="text-xs text-neutral-600 shrink-0">{formatNumber(g.count)}</span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="text-neutral-600 text-sm text-center py-4">{t('settings.noGroups')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const KID_PROFILES = PROFILES.filter((p) => p.role === 'kid')

function KidGroupPanel({
  kidProfileId, movieGroups, seriesGroups, liveGroups,
}: {
  kidProfileId: string
  movieGroups: { title: string; count: number }[]
  seriesGroups: { title: string; count: number }[]
  liveGroups: { title: string; count: number }[]
}) {
  const { excluded, toggle, setAll } = useKidRestrictions(kidProfileId)
  return (
    <div className="flex flex-col gap-3">
      <GroupFilterPanel label="common.movies"  type="movie"  groups={movieGroups}  excluded={excluded.movie}  toggle={toggle} setAll={setAll} cleanTitle={(g) => g.replace(/^VOD:\s*/i, '')} />
      <GroupFilterPanel label="common.tvShows" type="series" groups={seriesGroups} excluded={excluded.series} toggle={toggle} setAll={setAll} cleanTitle={(g) => g.replace(/^Series:\s*/i, '')} />
      <GroupFilterPanel label="common.liveTv"  type="live"   groups={liveGroups}   excluded={excluded.live}   toggle={toggle} setAll={setAll} />
    </div>
  )
}

function EpgSection({ m3uUrl }: { m3uUrl: string }) {
  const t = useT()
  const { status, lastFetched, error, progress, epgUrl, setEpgUrl, resolveUrl, refresh: refreshEpg } = useEpgStore()
  const loading  = status === 'loading'
  const hasError = status === 'error'
  const label    = loading
    ? t('common.loading')
    : lastFetched ? t('settings.epgRefresh') : t('settings.epgLoad')

  // Pre-populate from M3U URL if the field is empty
  const derivedUrl = epgUrlFromM3u(m3uUrl) ?? ''
  const displayUrl = epgUrl || derivedUrl
  const resolvedUrl = resolveUrl(m3uUrl)

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2.5 mb-4">
        <Tv size={16} className="text-neutral-400" />
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">{t('settings.tvGuide')}</h2>
      </div>
      <div className="bg-white/[0.03] rounded-xl p-4 ring-1 ring-white/8 flex flex-col gap-3">
        {/* EPG URL input */}
        <div>
          <label className="block text-xs text-neutral-500 mb-1.5">{t('settings.epgUrl')}</label>
          <input
            type="url"
            value={displayUrl}
            onChange={(e) => setEpgUrl(e.target.value)}
            placeholder={derivedUrl || 'http://provider.com/xmltv.php?username=…&password=…'}
            className="w-full bg-white/5 border border-white/10 rounded-lg min-h-11 px-3 py-2 text-base can-hover:text-sm text-white placeholder-neutral-600 font-mono focus:outline-none focus:border-accent-500/60 focus:bg-white/8 transition-colors"
          />
          {!derivedUrl && !epgUrl && (
            <p className="text-xs text-neutral-600 mt-1">{t('settings.epgHint')}</p>
          )}
        </div>

        {/* Status + action row */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 text-sm">
            {loading ? (
              <span className="text-neutral-400">{progress ?? t('common.loading')}</span>
            ) : hasError ? (
              <span className="text-red-400 flex items-center gap-1.5">
                <AlertCircle size={13} className="shrink-0" /> {error}
              </span>
            ) : lastFetched ? (
              <span className="text-neutral-400">
                {t('settings.epgLastLoaded', { when: formatDateTime(lastFetched) })}
              </span>
            ) : (
              <span className="text-neutral-600">{t('settings.epgNone')}</span>
            )}
          </div>
          <button
            onClick={() => refreshEpg(m3uUrl)}
            disabled={loading || !resolvedUrl}
            className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-lg bg-accent-600 hover:bg-accent-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {label}
          </button>
        </div>
      </div>
    </section>
  )
}

export function SettingsPage() {
  const t = useT()
  const { m3uUrl, setM3uUrl, refresh, fetching, progress, error, loadFromDB, channels } = usePlaylistStore()
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const role = getProfile(activeProfileId)?.role ?? 'kid'

  const { byProfile, toggle: rawToggle, setAll: rawSetAll } = useExclusionsStore()
  const excluded = useMemo(() => {
    const raw = byProfile[activeProfileId ?? ''] ?? { movie: [], series: [], live: [] }
    return { movie: new Set<string>(raw.movie), series: new Set<string>(raw.series), live: new Set<string>(raw.live) }
  }, [byProfile, activeProfileId])
  const toggle = (type: ContentType, group: string) => rawToggle(activeProfileId!, type, group)
  const setAll = (type: ContentType, groups: string[], hide: boolean) => rawSetAll(activeProfileId!, type, groups, hide)
  const [urlInput, setUrlInput] = useState(m3uUrl)
  const [selectedKid, setSelectedKid] = useState<string>(KID_PROFILES[0]?.id ?? '')
  const isAdmin = role === 'admin'
  const canManage = role === 'admin' || role === 'parent'

  const { movieGroups, seriesGroups, liveGroups } = useMemo(() => {
    const mc = new Map<string, number>()
    const sc = new Map<string, number>()
    const lc = new Map<string, number>()
    for (const ch of channels) {
      const map = ch.type === 'movie' ? mc : ch.type === 'series' ? sc : lc
      map.set(ch.groupTitle, (map.get(ch.groupTitle) ?? 0) + 1)
    }
    const sorted = (m: Map<string, number>) =>
      Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([title, count]) => ({ title, count }))
    return { movieGroups: sorted(mc), seriesGroups: sorted(sc), liveGroups: sorted(lc) }
  }, [channels])

  const [selectedPlaybackProfile, setSelectedPlaybackProfile] = useState(activeProfileId ?? PROFILES[0].id)
  const { byProfile: playbackByProfile, setPrefs: setPlaybackPrefs } = usePlaybackPrefsStore()
  const rawPlaybackPrefs = playbackByProfile[selectedPlaybackProfile] ?? {}
  const playbackPrefs = { preferredSubtitleLang: '', preferredAudioLang: '', autoplayNextEpisode: true, ...rawPlaybackPrefs }

  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [clearingTmdb, setClearingTmdb] = useState(false)
  const [tmdbCleared, setTmdbCleared] = useState<number | null>(null)
  const meta = useLiveQuery(() => getPlaylistMeta())

  const handleSave = async () => {
    setSaveError(null)
    try {
      await setM3uUrl(urlInput.trim())
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('settings.saveFailed'))
    }
  }

  const handleClearTmdb = async () => {
    setClearingTmdb(true)
    const count = await clearTmdbNotFound()
    setTmdbCleared(count)
    setClearingTmdb(false)
    setTimeout(() => setTmdbCleared(null), 4000)
  }

  const handleClear = async () => {
    if (!confirm(t('settings.clearConfirm'))) return
    setClearing(true)
    await clearPlaylist()
    await loadFromDB()
    setClearing(false)
  }

  const dlPct = !progress ? null
    : progress.phase === 'done' ? -1
    : progress.phase === 'saving' ? -1
    : progress.dlTotal > 0 ? Math.round((progress.dlBytes / progress.dlTotal) * 100)
    : null

  const savePct = !progress ? null
    : progress.phase === 'done' ? -1
    : progress.phase === 'saving' ? progress.savePct
    : null

  const dlIndeterminate = progress?.phase === 'downloading' && progress.dlTotal === 0
  const buttonLabel = fetching
    ? progress?.phase === 'saving' ? t('settings.saving') : t('settings.downloadingEllipsis')
    : meta ? t('settings.reDownload') : t('settings.downloadNow')

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-600">
        <Shield size={32} />
        <p className="text-sm">{t('settings.restricted')}</p>
      </div>
    )
  }

  return (
    <div className="p-6 pb-12 max-w-2xl">
      <div className="flex items-center gap-2.5 mb-8">
        <Settings size={20} className="text-neutral-400" />
        <h1 className="text-2xl font-bold text-white">{t('settings.title')}</h1>
      </div>

      {/* Language. First, and reachable by every role that can open this page —
          a person who cannot read the interface should not have to navigate it
          to fix that. The same switch is on the profile picker for the roles
          that cannot open Settings at all. */}
      <section className="mb-8">
        <div className="flex items-center gap-2.5 mb-4">
          <Languages size={16} className="text-neutral-400" />
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
            {t('settings.language')}
          </h2>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-4 ring-1 ring-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-sm text-neutral-400 leading-relaxed min-w-0">
            <p>{t('settings.languageBody')}</p>
            <p className="text-neutral-600 text-xs mt-0.5">{t('settings.languageHint')}</p>
          </div>
          <LanguageSwitch />
        </div>
      </section>

      {/* M3U URL — admin only */}
      {isAdmin && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">{t('settings.playlistSource')}</h2>
          <div className="bg-[#141414] rounded-xl p-5 flex flex-col gap-4 ring-1 ring-white/5">
            <div>
              <label className="block text-sm text-neutral-300 mb-2">{t('settings.m3uUrl')}</label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="http://provider.com/get.php?username=…&password=…&type=m3u_plus"
                className="w-full bg-white/5 border border-white/8 rounded-lg min-h-11 px-3 py-2.5 text-base can-hover:text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-accent-600/60 transition-colors font-mono"
              />
              <p className="text-xs text-neutral-600 mt-1.5">{t('settings.m3uPrivate')}</p>
            </div>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium transition-colors w-fit"
            >
              {saved ? <Check size={15} /> : null}
              {saved ? t('common.saved') : t('settings.saveUrl')}
            </button>
            {saveError && (
              <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 rounded-lg p-3">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <p>{saveError}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Cached Playlist — admin + parent */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">{t('settings.cachedPlaylist')}</h2>
        <div className="bg-[#141414] rounded-xl p-5 flex flex-col gap-5 ring-1 ring-white/5">
          {meta ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {([
                { label: 'settings.statTotal',    value: meta.entryCount },
                { label: 'settings.statMovies',   value: meta.movieCount ?? 0 },
                { label: 'settings.statEpisodes', value: meta.seriesCount ?? 0 },
                { label: 'settings.statLive',     value: meta.liveCount ?? 0 },
              ] as const).map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-neutral-500 mb-1">{t(label)}</p>
                  <p className="text-white font-semibold">{formatNumber(value)}</p>
                </div>
              ))}
              <div className="col-span-2">
                <p className="text-xs text-neutral-500 mb-1">{t('settings.lastUpdated')}</p>
                <p className="text-white text-sm font-medium">{formatDateTime(meta.fetchedAt)}</p>
              </div>
              {isAdmin && (
                <div className="col-span-2">
                  <p className="text-xs text-neutral-500 mb-1">{t('settings.source')}</p>
                  <p className="text-neutral-400 text-xs font-mono truncate">{meta.url.slice(0, 50)}…</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-neutral-500 text-sm">{t('settings.noPlaylist')}</p>
          )}

          {fetching && (
            <div className="flex flex-col gap-3 p-4 bg-white/3 rounded-lg border border-white/5">
              <ProgressBar label={t('settings.downloading')} icon={<Download size={12} />} pct={dlPct} indeterminate={dlIndeterminate} detail={progress ? formatBytes(progress.dlBytes) : undefined} />
              <ProgressBar label={t('settings.savingToDevice')} icon={<Database size={12} />} pct={savePct} indeterminate={false} />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 rounded-lg p-3">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          <div className="flex gap-2.5">
            <button
              onClick={refresh}
              disabled={fetching || !m3uUrl}
              className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-lg bg-accent-600 hover:bg-accent-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
              {buttonLabel}
            </button>
            {meta && isAdmin && (
              <button
                onClick={handleClear}
                disabled={clearing}
                className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-neutral-400 text-sm font-medium transition-colors"
              >
                <Trash2 size={14} />
                {t('settings.clearCache')}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Guide Data (EPG) */}
      <EpgSection m3uUrl={m3uUrl} />

      {/* TMDB Metadata */}
      <section className="mb-8">
        <div className="flex items-center gap-2.5 mb-4">
          <ImageOff size={16} className="text-neutral-400" />
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">{t('settings.metadata')}</h2>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-4 ring-1 ring-white/8 flex items-center justify-between gap-4">
          <div className="text-sm text-neutral-400 leading-relaxed">
            <p>{t('settings.tmdbBody')}</p>
            <p className="text-neutral-600 text-xs mt-0.5">{t('settings.tmdbHint')}</p>
          </div>
          <button
            onClick={handleClearTmdb}
            disabled={clearingTmdb}
            className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-400 text-sm font-medium transition-colors shrink-0 disabled:opacity-40"
          >
            <RefreshCw size={14} className={clearingTmdb ? 'animate-spin' : ''} />
            {tmdbCleared !== null ? t('settings.tmdbCleared', { count: tmdbCleared }) : t('settings.tmdbRetry')}
          </button>
        </div>
      </section>

      {/* Playback preferences */}
      <section className="mb-8">
        <div className="flex items-center gap-2.5 mb-4">
          <Play size={16} className="text-neutral-400" />
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">{t('settings.playback')}</h2>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-4 ring-1 ring-white/8 flex flex-col gap-5">
          {/* Profile selector */}
          <div>
            <p className="text-xs text-neutral-500 mb-2.5">{t('settings.profile')}</p>
            <div className="flex gap-2 flex-wrap">
              {PROFILES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlaybackProfile(p.id)}
                  className={`flex items-center gap-2 min-h-11 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    selectedPlaybackProfile === p.id ? 'text-white ring-1' : 'text-neutral-400 bg-white/3 hover:bg-white/6'
                  }`}
                  style={selectedPlaybackProfile === p.id ? { backgroundColor: `${p.color}25`, border: `1px solid ${p.color}60` } : undefined}
                >
                  <div className="w-4 h-4 rounded flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: p.color }}>
                    {p.name[0]}
                  </div>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Autoplay next episode */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-white">{t('settings.autoplayNext')}</p>
              <p className="text-xs text-neutral-600 mt-0.5">{t('settings.autoplayNextHint')}</p>
            </div>
            <button
              onClick={() => setPlaybackPrefs(selectedPlaybackProfile, { autoplayNextEpisode: !playbackPrefs.autoplayNextEpisode })}
              role="switch"
              aria-checked={playbackPrefs.autoplayNextEpisode}
              className={`relative shrink-0 w-10 h-6 rounded-full transition-colors after:absolute after:content-[''] after:-inset-2.5 ${playbackPrefs.autoplayNextEpisode ? 'bg-accent-600' : 'bg-white/15'}`}
            >
              <span className={`absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${playbackPrefs.autoplayNextEpisode ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Language selects — side by side on wider screens */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-white mb-1">{t('settings.defaultAudio')}</label>
              <p className="text-xs text-neutral-600 mb-2">{t('settings.defaultAudioHint')}</p>
              <select
                value={playbackPrefs.preferredAudioLang}
                onChange={(e) => setPlaybackPrefs(selectedPlaybackProfile, { preferredAudioLang: e.target.value })}
                className="w-full bg-[#1e1e1e] border border-white/10 rounded-lg h-11 px-3 py-2 text-base can-hover:text-sm text-white focus:outline-none focus:border-accent-500/60 transition-colors"
              >
                <option value="" className="bg-[#1e1e1e]">{t('settings.trackOff')}</option>
                {TRACK_LANGS.map((code) => (
                  <option key={code} value={code} className="bg-[#1e1e1e]">{t(`trackLang.${code}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-white mb-1">{t('settings.defaultSubtitle')}</label>
              <p className="text-xs text-neutral-600 mb-2">{t('settings.defaultSubtitleHint')}</p>
              <select
                value={playbackPrefs.preferredSubtitleLang}
                onChange={(e) => setPlaybackPrefs(selectedPlaybackProfile, { preferredSubtitleLang: e.target.value })}
                className="w-full bg-[#1e1e1e] border border-white/10 rounded-lg h-11 px-3 py-2 text-base can-hover:text-sm text-white focus:outline-none focus:border-accent-500/60 transition-colors"
              >
                <option value="" className="bg-[#1e1e1e]">{t('settings.trackOff')}</option>
                {TRACK_LANGS.map((code) => (
                  <option key={code} value={code} className="bg-[#1e1e1e]">{t(`trackLang.${code}`)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* VLC handover */}
      <VlcHandlerSection />

      {/* Feedback. The page itself is open to every profile — this is only the
          way in for whoever is already standing in Settings. */}
      <section className="mb-8">
        <div className="flex items-center gap-2.5 mb-4">
          <MessageSquarePlus size={16} className="text-neutral-400" />
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
            {t('feedback.title')}
          </h2>
        </div>
        <Link
          to="/feedback"
          className="bg-white/[0.03] rounded-xl p-4 ring-1 ring-white/8 flex items-center justify-between gap-4 hover:bg-white/[0.06] transition-colors"
        >
          <div className="text-sm text-neutral-400 leading-relaxed min-w-0">
            <p>{t('feedback.settingsBody')}</p>
            <p className="text-neutral-600 text-xs mt-0.5">{t('feedback.hint')}</p>
          </div>
          <span className="text-sm font-medium text-accent-400 shrink-0">
            {t('feedback.settingsLink')} →
          </span>
        </Link>
      </section>

      {/* Hidden Groups — admin + parent */}
      {channels.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">{t('settings.hiddenGroups')}</h2>
          <p className="text-xs text-neutral-600 mb-4">{t('settings.hiddenGroupsHint')}</p>
          <div className="flex flex-col gap-3">
            <GroupFilterPanel label="common.movies"  type="movie"  groups={movieGroups}  excluded={excluded.movie}  toggle={toggle} setAll={setAll} cleanTitle={(g) => g.replace(/^VOD:\s*/i, '')} />
            <GroupFilterPanel label="common.tvShows" type="series" groups={seriesGroups} excluded={excluded.series} toggle={toggle} setAll={setAll} cleanTitle={(g) => g.replace(/^Series:\s*/i, '')} />
            <GroupFilterPanel label="common.liveTv"  type="live"   groups={liveGroups}   excluded={excluded.live}   toggle={toggle} setAll={setAll} />
          </div>
        </section>
      )}

      {/* Parental Controls — admin + parent */}
      {channels.length > 0 && (
        <section>
          <div className="flex items-center gap-2.5 mb-4">
            <Users size={16} className="text-neutral-400" />
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">{t('settings.parentalControls')}</h2>
          </div>
          <p className="text-xs text-neutral-600 mb-4">{t('settings.parentalHint')}</p>

          {/* Kid selector */}
          <div className="flex gap-2 mb-5">
            {KID_PROFILES.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedKid(p.id)}
                className={`flex items-center gap-2 min-h-11 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedKid === p.id
                    ? 'text-white ring-1'
                    : 'text-neutral-400 bg-white/3 hover:bg-white/6'
                }`}
                style={selectedKid === p.id ? { backgroundColor: `${p.color}25`, border: `1px solid ${p.color}60` } : undefined}
              >
                <div className="w-5 h-5 rounded flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: p.color }}>
                  {p.name[0]}
                </div>
                {p.name}
              </button>
            ))}
          </div>

          <KidGroupPanel
            key={selectedKid}
            kidProfileId={selectedKid}
            movieGroups={movieGroups}
            seriesGroups={seriesGroups}
            liveGroups={liveGroups}
          />
        </section>
      )}
    </div>
  )
}
