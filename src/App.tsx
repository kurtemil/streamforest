import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { HomePage } from '@/pages/HomePage'
import { MoviesPage } from '@/pages/MoviesPage'
import { SeriesPage } from '@/pages/SeriesPage'
import { LiveTVPage } from '@/pages/LiveTVPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { WatchLaterPage } from '@/pages/WatchLaterPage'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { ProfilePicker } from '@/components/ProfilePicker'
import { usePlaylistStore } from '@/stores/playlistStore'
import { useProfileStore } from '@/stores/profileStore'
import { PasswordGate } from '@/components/PasswordGate'
import { syncFromRemote, syncWatchLaterFromRemote } from '@/services/sync'
import { kidRestrictionsStore, } from '@/stores/kidRestrictionsStore'
import { PROFILES } from '@/stores/profileStore'

export default function App() {
  const { loadFromDB, loaded } = usePlaylistStore()
  const { activeProfileId, showPicker } = useProfileStore()

  useEffect(() => {
    loadFromDB()
    // Pull kid restrictions once on startup for all kid profiles
    PROFILES.filter((p) => p.role === 'kid').forEach((p) => kidRestrictionsStore.syncFromRemote(p.id))
  }, [loadFromDB])

  // Sync remote data whenever the active profile changes
  useEffect(() => {
    if (activeProfileId) {
      syncFromRemote(activeProfileId)
      syncWatchLaterFromRemote(activeProfileId)
    }
  }, [activeProfileId])

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0a0a]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-accent-600 border-t-transparent animate-spin" />
          <p className="text-neutral-500 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <PasswordGate>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/movies" element={<MoviesPage />} />
          <Route path="/series" element={<SeriesPage />} />
          <Route path="/live" element={<LiveTVPage />} />
          <Route path="/watchlater" element={<WatchLaterPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <VideoPlayer />
      {(!activeProfileId || showPicker) && (
        <ProfilePicker forced={!activeProfileId} />
      )}
    </PasswordGate>
  )
}
