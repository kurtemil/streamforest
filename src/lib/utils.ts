export function normalizeShowKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\boch\b/g, '&').replace(/\band\b/g, '&')
    .replace(/\s*&\s*/g, ' & ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim()
}
