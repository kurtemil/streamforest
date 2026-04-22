import { useState, useEffect, type FormEvent } from 'react'

const HASH = '3d99a7ce075e9df1c371b15808608dee4be55010e327804cf3246508f2367a08'
const SESSION_KEY = 'sf_auth'

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    setAuthed(sessionStorage.getItem(SESSION_KEY) === '1')
    setChecking(false)
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const hash = await sha256(input)
    if (hash === HASH) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setAuthed(true)
    } else {
      setError(true)
      setInput('')
    }
  }

  if (checking) return null

  if (authed) return <>{children}</>

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a]">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col items-center gap-4 w-72"
      >
        <p className="text-neutral-200 text-lg font-semibold tracking-wide">StreamForest</p>
        <input
          type="password"
          value={input}
          onChange={e => { setInput(e.target.value); setError(false) }}
          placeholder="Password"
          autoFocus
          className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-4 py-2.5 text-neutral-100 placeholder-neutral-600 outline-none focus:border-accent-500 transition-colors"
        />
        {error && (
          <p className="text-red-400 text-sm">Incorrect password</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-accent-600 hover:bg-accent-500 text-white py-2.5 font-medium transition-colors"
        >
          Enter
        </button>
      </form>
    </div>
  )
}
