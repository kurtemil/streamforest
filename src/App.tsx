import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Layout } from '@/components/layout/Layout'
// Home is what almost every visit opens, so it stays in the main bundle. The
// rest load on first navigation — Settings and Series alone are 1500 lines that
// most sessions never reach.
import { HomePage } from '@/pages/HomePage'
const MoviesPage = lazy(() => import('@/pages/MoviesPage').then(m => ({ default: m.MoviesPage })))
const SeriesPage = lazy(() => import('@/pages/SeriesPage').then(m => ({ default: m.SeriesPage })))
const LiveTVPage = lazy(() => import('@/pages/LiveTVPage').then(m => ({ default: m.LiveTVPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const LibraryPage = lazy(() => import('@/pages/LibraryPage').then(m => ({ default: m.LibraryPage })))
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { ProfilePicker } from '@/components/ProfilePicker'
import { usePlaylistStore } from '@/stores/playlistStore'
import { useProfileStore } from '@/stores/profileStore'
import { syncFromRemote, syncWatchLaterFromRemote } from '@/services/sync'
import { kidRestrictionsStore } from '@/stores/kidRestrictionsStore'
import { useExclusionsStore } from '@/stores/exclusionsStore'
import { usePlaybackPrefsStore } from '@/stores/playbackPrefsStore'
import { useEpgStore } from '@/stores/epgStore'
import { PROFILES } from '@/stores/profileStore'
import { PageTransition } from '@/ui'

export default function App() {
  const { loadFromDB, loaded, syncM3uUrlFromRemote } = usePlaylistStore()
  const { activeProfileId, showPicker } = useProfileStore()
  const location = useLocation()
  const syncEpgUrl = useEpgStore((s) => s.syncEpgUrlFromRemote)

  useEffect(() => {
    loadFromDB()
    PROFILES.filter((p) => p.role === 'kid').forEach((p) => kidRestrictionsStore.syncFromRemote(p.id))
    syncEpgUrl()
    syncM3uUrlFromRemote()
  }, [loadFromDB, syncEpgUrl, syncM3uUrlFromRemote])

  useEffect(() => {
    if (activeProfileId) {
      syncFromRemote(activeProfileId)
      syncWatchLaterFromRemote(activeProfileId)
      useExclusionsStore.getState().syncFromRemote(activeProfileId)
      usePlaybackPrefsStore.getState().syncFromRemote(activeProfileId)
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
    <>
      <Layout>
        {/* A route chunk arrives in milliseconds on a warm connection; the
            fallback exists so a cold one shows the app's own spinner rather
            than a blank frame. */}
        <Suspense fallback={
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-accent-600 border-t-transparent animate-spin" />
          </div>
        }>
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={location} key={location.pathname.split('/')[1] || 'home'}>
            <Route path="/"           element={<PageTransition><HomePage /></PageTransition>} />
            <Route path="/movies"     element={<PageTransition><MoviesPage /></PageTransition>} />
            <Route path="/series"     element={<PageTransition><SeriesPage /></PageTransition>} />
            <Route path="/live"       element={<PageTransition><LiveTVPage /></PageTransition>} />
            <Route path="/library"    element={<PageTransition><LibraryPage /></PageTransition>} />
            <Route path="/watchlater" element={<Navigate to="/library" replace />} />
            <Route path="/settings"   element={<PageTransition><SettingsPage /></PageTransition>} />
            <Route path="*"           element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
        </Suspense>
      </Layout>
      <VideoPlayer />
      {(!activeProfileId || showPicker) && (
        <ProfilePicker forced={!activeProfileId} />
      )}
    </>
  )
}
