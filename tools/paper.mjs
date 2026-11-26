// Puts the figures of examples/paper next to paper.tex, from the SFL gallery, which keeps every example in one place.
// The gallery is ../SFL-Gallery beside this project, or the folder in SFL_GALLERY. The copies are not kept in this repository.
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GALLERY = resolve(process.env.SFL_GALLERY ?? join(ROOT, '../SFL-Gallery'))
const PAPER = join(ROOT, 'examples/paper')

if (!existsSync(GALLERY)) {
  console.error(`The SFL gallery is not at ${GALLERY}. Set SFL_GALLERY to its folder.`)
  process.exit(1)
}

const lines = readFileSync(join(PAPER, 'figures.txt'), 'utf8').split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('#'))
for (const line of lines) {
  const [name, from] = line.trim().split(/\s+/)
  const source = join(GALLERY, from)
  if (!existsSync(source)) {
    console.error(`missing in the gallery: ${from}`)
    process.exit(1)
  }
  copyFileSync(source, join(PAPER, name))
}
for (const name of ['stickyflow.sty', 'stickyflow.lua']) copyFileSync(join(ROOT, 'dist', name), join(PAPER, name))
console.log(`examples/paper: ${lines.length} figures from ${GALLERY}`)
