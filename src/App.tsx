import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { HomePage } from '@/pages/HomePage'
import { MoviesPage } from '@/pages/MoviesPage'
import { SeriesPage } from '@/pages/SeriesPage'
import { LiveTVPage } from '@/pages/LiveTVPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { usePlaylistStore } from '@/stores/playlistStore'
import { PasswordGate } from '@/components/PasswordGate'

export default function App() {
  const { loadFromDB, loaded } = usePlaylistStore()

  useEffect(() => {
    loadFromDB()
  }, [loadFromDB])

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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <VideoPlayer />
    </PasswordGate>
  )
}
