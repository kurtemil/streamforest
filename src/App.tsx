import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
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
import { kidRestrictionsStore } from '@/stores/kidRestrictionsStore'
import { PROFILES } from '@/stores/profileStore'
import { PageTransition } from '@/ui'

export default function App() {
  const { loadFromDB, loaded } = usePlaylistStore()
  const { activeProfileId, showPicker } = useProfileStore()
  const location = useLocation()

  useEffect(() => {
    loadFromDB()
    PROFILES.filter((p) => p.role === 'kid').forEach((p) => kidRestrictionsStore.syncFromRemote(p.id))
  }, [loadFromDB])

  useEffect(() => {
    if (activeProfileId) {
      syncFromRemote(activeProfileId)
      syncWatchLaterFromRemote(activeProfileId)
    }
  }, [activeProfileId])

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-100">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-accent-600 border-t-transparent animate-spin" />
          <p className="text-neutral-500 text-caption">Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <PasswordGate>
      <Layout>
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={location} key={location.pathname.split('/')[1] || 'home'}>
            <Route path="/"           element={<PageTransition><HomePage /></PageTransition>} />
            <Route path="/movies"     element={<PageTransition><MoviesPage /></PageTransition>} />
            <Route path="/series"     element={<PageTransition><SeriesPage /></PageTransition>} />
            <Route path="/live"       element={<PageTransition><LiveTVPage /></PageTransition>} />
            <Route path="/watchlater" element={<PageTransition><WatchLaterPage /></PageTransition>} />
            <Route path="/settings"   element={<PageTransition><SettingsPage /></PageTransition>} />
            <Route path="*"           element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
      </Layout>
      <VideoPlayer />
      {(!activeProfileId || showPicker) && (
        <ProfilePicker forced={!activeProfileId} />
      )}
    </PasswordGate>
  )
}
