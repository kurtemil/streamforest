export interface VttCue {
  startTime: number
  endTime: number
  text: string
}

export function parseVttTimestamp(s: string): number {
  const m = s.match(/^(?:(\d+):)?(\d+):(\d+)\.(\d+)$/)
  if (!m) return NaN
  const h = m[1] ? Number(m[1]) : 0
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000
}

export function parseVttBlock(block: string): VttCue | null {
  const lines = block.split('\n').filter(l => l.length > 0)
  if (lines.length === 0) return null
  if (lines[0].startsWith('WEBVTT')) return null
  if (/^(NOTE|STYLE|REGION)\b/.test(lines[0])) return null
  const tsIdx = lines.findIndex(l => l.includes('-->'))
  if (tsIdx < 0) return null
  const [rawStart, rawEnd] = lines[tsIdx].split('-->').map(s => s.trim().split(/\s+/)[0] ?? '')
  const start = parseVttTimestamp(rawStart)
  const end = parseVttTimestamp(rawEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const content = lines.slice(tsIdx + 1).join('\n').trim()
  if (!content) return null
  return { startTime: start, endTime: end, text: content }
}
