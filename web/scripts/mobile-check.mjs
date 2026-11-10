// Layout check for result states, in headless Chrome over the DevTools Protocol (no extra deps).
// For each case x width: no horizontal overflow, and no two text runs in different blocks overlap
// (or sit closer than 4px side by side).
// Usage: npm run build && npm run check:mobile [-- <outdir>]   (exit code 1 on any failure)
// Needs Google Chrome; set CHROME=/path/to/chrome if it isn't in the default macOS location.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = process.argv[2] ?? fileURLToPath(new URL('../mobile-check-out', import.meta.url))
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 4174
const BASE = `http://localhost:${PORT}/`
const WIDTHS = [360, 1024]
const CASES = {
  // Grade B eggs, Timur Laut: shops RM 13.50-18.00 (the reported bug: price far outside the range).
  'above-max': '?d=timur-laut&i=1110&p=25',
  'below-min': '?d=timur-laut&i=1110&p=3',
  inside: '?d=timur-laut&i=1110&p=14.85',
  // Red chilli (Kulai), Barat Daya: every shop at RM 16.00, so min == max.
  'near-zero-range': '?d=barat-daya&i=93&p=16.5',
  controlled: '?d=petaling&i=1589&p=3.20',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore',
})
// In CI (GitHub's Ubuntu 24.04 runners) AppArmor blocks the unprivileged user namespaces Chrome's
// sandbox needs, so it won't start. --no-sandbox is safe here: it only ever loads our own localhost build.
const sandbox = process.env.CI ? ['--no-sandbox'] : []
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', ...sandbox, '--remote-debugging-port=9334',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, 'about:blank'], { stdio: 'ignore' })
const cleanup = () => { chrome.kill(); preview.kill() }
chrome.on('error', (e) => {
  preview.kill()
  console.error(`Couldn't start Chrome at ${CHROME} (${e.code}). Set CHROME to a Chrome/Chromium binary.`)
  process.exit(1)
})

let wsUrl
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250)
  try { wsUrl = (await (await fetch('http://127.0.0.1:9334/json')).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch {}
}
if (!wsUrl) {
  cleanup()
  console.error(`Chrome didn't start (CHROME=${CHROME}). Set CHROME to a Chrome/Chromium binary.`)
  process.exit(1)
}
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break } catch {} await sleep(250) }

const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text)
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
await send('Runtime.enable')

// Text runs (per text node, via Range rects = actual glyph boxes, not padded element boxes).
// Runs inside the same block are skipped: the browser lays out its own lines. What we catch is
// separately positioned text (axis labels, tags) colliding with other text.
const OVERLAP_CHECK = `(() => {
  const GAP = 4
  const blockOf = (n) => { let e = n.parentElement; while (e && getComputedStyle(e).display.startsWith('inline')) e = e.parentElement; return e }
  const runs = []
  const w = document.createTreeWalker(document.querySelector('.page'), NodeFilter.SHOW_TEXT)
  while (w.nextNode()) {
    const n = w.currentNode
    if (!n.textContent.trim()) continue
    const r = document.createRange(); r.selectNodeContents(n)
    for (const b of r.getClientRects()) if (b.width > 0 && b.height > 0) runs.push({ t: n.textContent.trim().slice(0, 24), block: blockOf(n), b })
  }
  const hits = []
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const a = runs[i], c = runs[j]
    if (a.block === c.block) continue
    // +GAP: runs on the same line must also keep a small gap ("RM 13.50RM 18.00" touching is unreadable too)
    const ox = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left) + GAP
    const oy = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top)
    if (ox > 1 && oy > 1) hits.push(JSON.stringify(a.t) + ' x ' + JSON.stringify(c.t))
  }
  return { hits, overflow: document.documentElement.scrollWidth > innerWidth, hasResult: !!document.querySelector('.result') }
})()`

const rows = []
for (const width of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: width < 768 })
  for (const [name, query] of Object.entries(CASES)) {
    await send('Page.navigate', { url: BASE + query })
    for (let i = 0; i < 40 && !(await evaluate("!!document.querySelector('.result')")); i++) await sleep(100)
    await evaluate('document.fonts.ready.then(() => true)')
    await sleep(300) // let the marker transition settle
    const r = await evaluate(OVERLAP_CHECK)
    const top = await evaluate("Math.max(0, document.querySelector('.result')?.getBoundingClientRect().top + scrollY - 16 || 0)")
    const h = await evaluate("document.querySelector('.result') ? document.querySelector('.result').getBoundingClientRect().height + 32 : 600")
    const { result } = await send('Page.captureScreenshot', { captureBeyondViewport: true, clip: { x: 0, y: top, width, height: h, scale: 1 } })
    const file = join(OUT, `${name}-${width}.png`)
    writeFileSync(file, Buffer.from(result.data, 'base64'))
    const ok = r.hasResult && !r.overflow && r.hits.length === 0
    rows.push({ case: name, width, ok, overflow: r.overflow, overlaps: r.hits.slice(0, 4), file })
  }
}
ws.close(); cleanup()

for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.case.padEnd(16)} ${String(r.width).padEnd(5)} ${r.overflow ? 'OVERFLOW ' : ''}${r.overlaps.join(' | ')}`)
if (errors.length) console.log('page errors:', errors)
console.log(`screenshots: ${OUT}`)
process.exit(rows.every((r) => r.ok) && !errors.length ? 0 : 1)
