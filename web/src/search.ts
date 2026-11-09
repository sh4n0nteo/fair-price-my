// Client-side search over a few hundred names: no index or library needed, a scored filter is instant.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Every query word must appear somewhere in the item's fields (English and Malay names together).
 * Rank: a field starting with the whole query, then a word starting with the first query word,
 * then any match; shorter text breaks ties.
 */
export function rank<T>(items: readonly T[], query: string, fields: (t: T) => string[], limit = 8): T[] {
  const q = norm(query)
  if (!q) return []
  const words = q.split(' ')
  const scored: { t: T; score: number; len: number }[] = []
  for (const t of items) {
    const fs = fields(t).map(norm)
    const hay = fs.join(' ')
    if (!words.every((w) => hay.includes(w))) continue
    const score = fs.some((f) => f.startsWith(q)) ? 0 : fs.some((f) => ` ${f}`.includes(` ${words[0]}`)) ? 1 : 2
    scored.push({ t, score, len: fs[0]?.length ?? 0 })
  }
  scored.sort((a, b) => a.score - b.score || a.len - b.len)
  return scored.slice(0, limit).map((s) => s.t)
}
