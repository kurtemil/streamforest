import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ProfileRole = 'admin' | 'parent' | 'kid'

export interface Profile {
  id: string
  name: string
  color: string
  role: ProfileRole
}

export const PROFILES: Profile[] = [
  { id: 'elof',   name: 'Elof',   color: '#3b82f6', role: 'admin'  },
  { id: 'jossan', name: 'Jossan', color: '#a855f7', role: 'parent' },
  { id: 'vera',   name: 'Vera',   color: '#ec4899', role: 'kid'    },
  { id: 'noah',   name: 'Noah',   color: '#22c55e', role: 'kid'    },
]

export function getProfile(id: string | null): Profile | undefined {
  return PROFILES.find((p) => p.id === id)
}

interface ProfileState {
  activeProfileId: string | null
  showPicker: boolean
  setProfile: (id: string) => void
  openPicker: () => void
  closePicker: () => void
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      activeProfileId: null,
      showPicker: false,
      setProfile: (id) => set({ activeProfileId: id, showPicker: false }),
      openPicker: () => set({ showPicker: true }),
      closePicker: () => set({ showPicker: false }),
    }),
    {
      name: 'sf-profile',
      partialize: (state) => ({ activeProfileId: state.activeProfileId }),
    }
  )
)
