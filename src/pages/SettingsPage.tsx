import { useState, useMemo } from 'react'
import { Settings, RefreshCw, Trash2, Check, AlertCircle, Download, Database, ChevronDown, EyeOff, Shield, Users } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { getPlaylistMeta, clearPlaylist } from '@/services/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useExclusionsStore, type ContentType } from '@/stores/exclusionsStore'
import { useProfileStore, getProfile, PROFILES } from '@/stores/profileStore'
import { useKidRestrictions } from '@/stores/kidRestrictionsStore'

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function formatDate(ts: number) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts))
}

function ProgressBar({ label, icon, pct, indeterminate, detail }: {
  label: string
  icon: React.ReactNode
  pct: number | null
  indeterminate?: boolean
  detail?: string
}) {
  const isDone = pct === -1
  const isActive = pct !== null && !isDone
  const displayPct = isDone ? 100 : (pct ?? 0)

  return (
    <div className={`flex flex-col gap-1.5 transition-opacity ${pct === null ? 'opacity-40' : 'opacity-100'}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-neutral-400">
          {icon}
          {label}
          {isDone && <span className="text-accent-500 font-medium">✓ Done</span>}
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
  label, type, groups, excluded, toggle, setAll, cleanTitle = (t) => t,
}: {
  label: string
  type: ContentType
  groups: { title: string; count: number }[]
  excluded: Set<string>
  toggle: (type: ContentType, group: string) => void
  setAll: (type: ContentType, groups: string[], hide: boolean) => void
  cleanTitle?: (t: string) => string
}) {
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
          <span className="text-sm font-medium text-white">{label}</span>
          {hiddenCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
              {hiddenCount} hidden
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-neutral-500 text-xs">
          <span>{groups.length} groups</span>
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
              placeholder="Filter groups…"
              className="flex-1 bg-white/5 border border-white/8 rounded-lg px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-accent-600/60 transition-colors"
            />
            <button
              onClick={() => setAll(type, groups.map((g) => g.title), true)}
              className="px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-neutral-400 transition-colors whitespace-nowrap"
            >
              Hide all
            </button>
            <button
              onClick={() => setAll(type, [], false)}
              className="px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-400 transition-colors whitespace-nowrap"
            >
              Show all
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto flex flex-col gap-0.5 pr-1 scrollbar-hide">
            {filtered.map((g) => {
              const hidden = excluded.has(g.title)
              return (
                <button
                  key={g.title}
                  onClick={() => toggle(type, g.title)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left w-full ${
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
                  <span className="text-xs text-neutral-600 shrink-0">{g.count.toLocaleString()}</span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="text-neutral-600 text-sm text-center py-4">No groups found</p>
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
      <GroupFilterPanel label="Movies"   type="movie"  groups={movieGroups}  excluded={excluded.movie}  toggle={toggle} setAll={setAll} cleanTitle={(t) => t.replace(/^VOD:\s*/i, '')} />
      <GroupFilterPanel label="TV Shows" type="series" groups={seriesGroups} excluded={excluded.series} toggle={toggle} setAll={setAll} cleanTitle={(t) => t.replace(/^Series:\s*/i, '')} />
      <GroupFilterPanel label="Live TV"  type="live"   groups={liveGroups}   excluded={excluded.live}   toggle={toggle} setAll={setAll} />
    </div>
  )
}

export function SettingsPage() {
  const { m3uUrl, setM3uUrl, refresh, fetching, progress, error, loadFromDB, channels } = usePlaylistStore()
  const { excluded, toggle, setAll } = useExclusionsStore()
  const [urlInput, setUrlInput] = useState(m3uUrl)
  const [selectedKid, setSelectedKid] = useState<string>(KID_PROFILES[0]?.id ?? '')

  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const role = getProfile(activeProfileId)?.role ?? 'kid'
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

  const [saved, setSaved] = useState(false)
  const [clearing, setClearing] = useState(false)
  const meta = useLiveQuery(() => getPlaylistMeta())

  const handleSave = () => {
    setM3uUrl(urlInput.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleClear = async () => {
    if (!confirm("Clear all cached playlist data? You'll need to re-download it.")) return
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
    ? progress?.phase === 'saving' ? 'Saving…' : 'Downloading…'
    : meta ? 'Re-download' : 'Download now'

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-600">
        <Shield size={32} />
        <p className="text-sm">Settings are restricted to parents and administrators.</p>
      </div>
    )
  }

  return (
    <div className="p-6 pb-12 max-w-2xl">
      <div className="flex items-center gap-2.5 mb-8">
        <Settings size={20} className="text-neutral-400" />
        <h1 className="text-2xl font-bold text-white">Settings</h1>
      </div>

      {/* M3U URL — admin only */}
      {isAdmin && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">Playlist Source</h2>
          <div className="bg-[#141414] rounded-xl p-5 flex flex-col gap-4 ring-1 ring-white/5">
            <div>
              <label className="block text-sm text-neutral-300 mb-2">M3U URL</label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="http://provider.com/get.php?username=…&password=…&type=m3u_plus"
                className="w-full bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-accent-600/60 transition-colors font-mono"
              />
              <p className="text-xs text-neutral-600 mt-1.5">Keep this URL private — it contains your credentials.</p>
            </div>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-sm font-medium transition-colors w-fit"
            >
              {saved ? <Check size={15} /> : null}
              {saved ? 'Saved' : 'Save URL'}
            </button>
          </div>
        </section>
      )}

      {/* Cached Playlist — admin + parent */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">Cached Playlist</h2>
        <div className="bg-[#141414] rounded-xl p-5 flex flex-col gap-5 ring-1 ring-white/5">
          {meta ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total', value: meta.entryCount },
                { label: 'Movies', value: meta.movieCount ?? 0 },
                { label: 'TV Episodes', value: meta.seriesCount ?? 0 },
                { label: 'Live Channels', value: meta.liveCount ?? 0 },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-neutral-500 mb-1">{label}</p>
                  <p className="text-white font-semibold">{value.toLocaleString()}</p>
                </div>
              ))}
              <div className="col-span-2">
                <p className="text-xs text-neutral-500 mb-1">Last updated</p>
                <p className="text-white text-sm font-medium">{formatDate(meta.fetchedAt)}</p>
              </div>
              {isAdmin && (
                <div className="col-span-2">
                  <p className="text-xs text-neutral-500 mb-1">Source</p>
                  <p className="text-neutral-400 text-xs font-mono truncate">{meta.url.slice(0, 50)}…</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-neutral-500 text-sm">No playlist cached yet.</p>
          )}

          {fetching && (
            <div className="flex flex-col gap-3 p-4 bg-white/3 rounded-lg border border-white/5">
              <ProgressBar label="Downloading" icon={<Download size={12} />} pct={dlPct} indeterminate={dlIndeterminate} detail={progress ? formatBytes(progress.dlBytes) : undefined} />
              <ProgressBar label="Saving to device" icon={<Database size={12} />} pct={savePct} indeterminate={false} />
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
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
              {buttonLabel}
            </button>
            {meta && isAdmin && (
              <button
                onClick={handleClear}
                disabled={clearing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-neutral-400 text-sm font-medium transition-colors"
              >
                <Trash2 size={14} />
                Clear cache
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Hidden Groups — admin + parent */}
      {channels.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">Hidden Groups</h2>
          <p className="text-xs text-neutral-600 mb-4">Groups you hide won't appear anywhere in the app — not in lists, search, or the home screen.</p>
          <div className="flex flex-col gap-3">
            <GroupFilterPanel label="Movies"   type="movie"  groups={movieGroups}  excluded={excluded.movie}  toggle={toggle} setAll={setAll} cleanTitle={(t) => t.replace(/^VOD:\s*/i, '')} />
            <GroupFilterPanel label="TV Shows" type="series" groups={seriesGroups} excluded={excluded.series} toggle={toggle} setAll={setAll} cleanTitle={(t) => t.replace(/^Series:\s*/i, '')} />
            <GroupFilterPanel label="Live TV"  type="live"   groups={liveGroups}   excluded={excluded.live}   toggle={toggle} setAll={setAll} />
          </div>
        </section>
      )}

      {/* Parental Controls — admin + parent */}
      {channels.length > 0 && (
        <section>
          <div className="flex items-center gap-2.5 mb-4">
            <Users size={16} className="text-neutral-400" />
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">Parental Controls</h2>
          </div>
          <p className="text-xs text-neutral-600 mb-4">Hidden groups apply on top of your global settings for each kid's profile.</p>

          {/* Kid selector */}
          <div className="flex gap-2 mb-5">
            {KID_PROFILES.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedKid(p.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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
