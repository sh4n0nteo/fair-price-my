// Copy the pipeline's output (../data/out) into public/data before dev/build.
// data/out/ is the single source of truth in git; public/data is a git-ignored build artifact.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../../data/out', import.meta.url))
const dest = fileURLToPath(new URL('../public/data', import.meta.url))

if (!existsSync(src)) {
  console.error(`copy-data: ${src} not found. Run \`python -m pipeline\` from the repo root first.`)
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true }) // a district dropped from scope must not linger
cpSync(src, dest, { recursive: true })
console.log(`copy-data: ${src} -> ${dest}`)
