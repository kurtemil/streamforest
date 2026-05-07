import { PROFILES, useProfileStore } from '@/stores/profileStore'
import { syncFromRemote } from '@/services/sync'

export function ProfilePicker({ forced }: { forced?: boolean }) {
  const { setProfile, closePicker, activeProfileId } = useProfileStore()

  const select = (id: string) => {
    setProfile(id)
    syncFromRemote(id)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col items-center justify-center gap-10">
      <div className="flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-xl bg-accent-600 flex items-center justify-center mb-2">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <path d="M5 3l14 9-14 9V3z" fill="white" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-white">Who's watching?</h1>
      </div>

      <div className="flex gap-6">
        {PROFILES.map((profile) => (
          <button
            key={profile.id}
            onClick={() => select(profile.id)}
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
    </div>
  )
}
