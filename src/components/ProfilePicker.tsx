import { useState, useEffect, useCallback } from 'react'
import { PROFILES, useProfileStore, type Profile } from '@/stores/profileStore'
import { syncFromRemote } from '@/services/sync'
import { useExclusionsStore } from '@/stores/exclusionsStore'
import { kidRestrictionsStore } from '@/stores/kidRestrictionsStore'

const KID_IDS = PROFILES.filter((p) => p.role === 'kid').map((p) => p.id)
const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←']

async function verifyPin(profileId: string, pin: string): Promise<boolean> {
  try {
    const res = await fetch('/api/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId, pin }),
    })
    const data = (await res.json()) as { ok: boolean }
    return data.ok
  } catch {
    return false
  }
}

function PinEntry({
  profile,
  onSuccess,
  onBack,
}: {
  profile: Profile
  onSuccess: () => void
  onBack: () => void
}) {
  const [digits, setDigits] = useState<string[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = useCallback(
    async (pin: string[]) => {
      setLoading(true)
      const ok = await verifyPin(profile.id, pin.join(''))
      setLoading(false)
      if (ok) {
        onSuccess()
      } else {
        setError(true)
        setTimeout(() => {
          setDigits([])
          setError(false)
        }, 600)
      }
    },
    [profile.id, onSuccess],
  )

  const addDigit = useCallback(
    (d: string) => {
      if (error || loading) return
      setDigits((prev) => {
        if (prev.length >= 4) return prev
        const next = [...prev, d]
        if (next.length === 4) setTimeout(() => submit(next), 80)
        return next
      })
    },
    [error, loading, submit],
  )

  const removeDigit = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1))
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') addDigit(e.key)
      else if (e.key === 'Backspace') removeDigit()
      else if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [addDigit, removeDigit, onBack])

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-20 h-20 rounded-xl flex items-center justify-center text-3xl font-bold text-white"
          style={{ backgroundColor: profile.color }}
        >
          {profile.name[0]}
        </div>
        <p className="text-white font-semibold text-lg">{profile.name}</p>
      </div>

      <div className="flex gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
              error
                ? 'border-red-500 bg-red-500'
                : loading
                  ? 'border-neutral-400 bg-neutral-400 animate-pulse'
                  : digits.length > i
                    ? 'border-white bg-white'
                    : 'border-neutral-600 bg-transparent'
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {NUMPAD.map((key, i) => {
          if (key === '') return <div key={i} />
          if (key === '←')
            return (
              <button
                key={i}
                onClick={removeDigit}
                className="w-16 h-16 rounded-2xl bg-neutral-800 hover:bg-neutral-700 text-white text-xl flex items-center justify-center transition-colors"
              >
                ←
              </button>
            )
          return (
            <button
              key={i}
              onClick={() => addDigit(key)}
              className="w-16 h-16 rounded-2xl bg-neutral-800 hover:bg-neutral-700 text-white text-2xl font-semibold flex items-center justify-center transition-colors"
            >
              {key}
            </button>
          )
        })}
      </div>

      <button
        onClick={onBack}
        className="text-neutral-600 hover:text-neutral-400 text-sm transition-colors"
      >
        Back
      </button>
    </div>
  )
}

export function ProfilePicker({ forced }: { forced?: boolean }) {
  const { setProfile, closePicker, activeProfileId } = useProfileStore()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const pendingProfile = PROFILES.find((p) => p.id === pendingId)

  const handlePinSuccess = useCallback(() => {
    const id = pendingId!
    setProfile(id)
    syncFromRemote(id)
    useExclusionsStore.getState().syncFromRemote(id)
    const profile = PROFILES.find((p) => p.id === id)
    if (profile?.role === 'admin' || profile?.role === 'parent') {
      KID_IDS.forEach((kidId) => kidRestrictionsStore.syncFromRemote(kidId))
    }
    setPendingId(null)
  }, [pendingId, setProfile])

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col items-center justify-center gap-10 pt-safe pb-safe px-safe">
      <div className="flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-xl bg-accent-600 flex items-center justify-center mb-2">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <path d="M5 3l14 9-14 9V3z" fill="white" />
          </svg>
        </div>
        {!pendingProfile && <h1 className="text-3xl font-bold text-white">Who's watching?</h1>}
      </div>

      {pendingProfile ? (
        <PinEntry
          profile={pendingProfile}
          onSuccess={handlePinSuccess}
          onBack={() => setPendingId(null)}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-5 sm:flex sm:gap-6 px-4 sm:px-0">
            {PROFILES.map((profile) => (
              <button
                key={profile.id}
                onClick={() => setPendingId(profile.id)}
                className="flex flex-col items-center gap-3 group"
              >
                <div
                  className="w-24 h-24 rounded-xl flex items-center justify-center text-4xl font-bold text-white transition-all group-hover:scale-105 group-hover:ring-4 ring-white/0 group-hover:ring-white/60"
                  style={{ backgroundColor: profile.color }}
                >
                  {profile.name[0]}
                </div>
                <span className="text-neutral-400 group-hover:text-white text-sm font-medium transition-colors">
                  {profile.name}
                </span>
              </button>
            ))}
          </div>

          {!forced && activeProfileId && (
            <button
              onClick={closePicker}
              className="text-neutral-600 hover:text-neutral-400 text-sm transition-colors"
            >
              Cancel
            </button>
          )}
        </>
      )}
    </div>
  )
}
