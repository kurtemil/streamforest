import { useState } from 'react'
import { Settings, RefreshCw, Trash2, Check, AlertCircle, Download, Database } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { getPlaylistMeta, clearPlaylist } from '@/services/db'
import { useLiveQuery } from 'dexie-react-hooks'

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
  pct: number | null       // null = not started, -1 = done
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

export function SettingsPage() {
  const { m3uUrl, setM3uUrl, refresh, fetching, progress, error, loadFromDB } = usePlaylistStore()
  const [urlInput, setUrlInput] = useState(m3uUrl)
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

  // Download bar: pct from bytes, null before start, -1 when done
  const dlPct = !progress ? null
    : progress.phase === 'done' ? -1
    : progress.phase === 'saving' ? -1
    : progress.dlTotal > 0 ? Math.round((progress.dlBytes / progress.dlTotal) * 100)
    : null  // indeterminate if no Content-Length

  // Save bar: pct from savePct field, null before saving phase
  const savePct = !progress ? null
    : progress.phase === 'done' ? -1
    : progress.phase === 'saving' ? progress.savePct
    : null

  const dlIndeterminate = progress?.phase === 'downloading' && progress.dlTotal === 0
  const buttonLabel = fetching
    ? progress?.phase === 'saving' ? 'Saving…' : 'Downloading…'
    : meta ? 'Re-download' : 'Download now'

  return (
    <div className="p-6 pb-12 max-w-2xl">
      <div className="flex items-center gap-2.5 mb-8">
        <Settings size={20} className="text-neutral-400" />
        <h1 className="text-2xl font-bold text-white">Settings</h1>
      </div>

      {/* M3U URL */}
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

      {/* Cached Playlist */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">Cached Playlist</h2>
        <div className="bg-[#141414] rounded-xl p-5 flex flex-col gap-5 ring-1 ring-white/5">

          {/* Stats */}
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
              <div className="col-span-2">
                <p className="text-xs text-neutral-500 mb-1">Source</p>
                <p className="text-neutral-400 text-xs font-mono truncate">{meta.url.slice(0, 50)}…</p>
              </div>
            </div>
          ) : (
            <p className="text-neutral-500 text-sm">No playlist cached yet.</p>
          )}

          {/* Progress bars — shown during and after fetch until dismissed */}
          {fetching && (
            <div className="flex flex-col gap-3 p-4 bg-white/3 rounded-lg border border-white/5">
              <ProgressBar
                label="Downloading"
                icon={<Download size={12} />}
                pct={dlPct}
                indeterminate={dlIndeterminate}
                detail={progress ? formatBytes(progress.dlBytes) : undefined}
              />
              <ProgressBar
                label="Saving to device"
                icon={<Database size={12} />}
                pct={savePct}
                indeterminate={false}
              />
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
              disabled={fetching || !urlInput.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
              {buttonLabel}
            </button>
            {meta && (
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
    </div>
  )
}
