// Packs release/stickyflow.zip for a GitHub release and for CTAN: the package, its documentation as PDF, the examples with the sample
// paper, its figures and its PDF, README and license. Run after the build; it needs lualatex, and the SFL gallery for the paper.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { zipFolder } from './zip.mjs'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE = join(ROOT, 'release')
const PACKAGE = join(RELEASE, 'stickyflow')
const FILES = ['stickyflow.sty', 'stickyflow.lua']

for (const name of FILES) {
  if (!existsSync(join(ROOT, 'dist', name))) {
    console.error(`dist/${name} is missing, run npm run build first`)
    process.exit(1)
  }
}

// A document is compiled twice with the package beside it; afterwards only what is named to keep stays in its folder.
function compile(folder, file, keep) {
  for (const name of FILES) cpSync(join(ROOT, 'dist', name), join(folder, name))
  for (let run = 0; run < 2; run++) {
    execFileSync('lualatex', ['-interaction=nonstopmode', '-halt-on-error', file], { cwd: folder, stdio: 'ignore' })
  }
  for (const name of readdirSync(folder)) {
    if (!keep(name)) rmSync(join(folder, name), { recursive: true, force: true })
  }
}

// The figures of the paper, from the gallery.
execFileSync(process.execPath, [join(ROOT, 'tools/paper.mjs')], { stdio: 'inherit' })

rmSync(RELEASE, { recursive: true, force: true })
mkdirSync(join(PACKAGE, 'doc'), { recursive: true })
for (const name of FILES) cpSync(join(ROOT, 'dist', name), join(PACKAGE, name))
for (const name of ['README.md', 'LICENSE', 'CHANGELOG.md']) cpSync(join(ROOT, name), join(PACKAGE, name))
cpSync(join(ROOT, 'doc/stickyflow-doc.tex'), join(PACKAGE, 'doc/stickyflow-doc.tex'))
cpSync(join(ROOT, 'examples'), join(PACKAGE, 'examples'), {
  recursive: true,
  filter: (from) => !/\.(aux|log|out|pdf)$/.test(from) && !FILES.some((name) => from.endsWith(name)),
})

compile(join(PACKAGE, 'doc'), 'stickyflow-doc.tex', (name) => ['stickyflow-doc.tex', 'stickyflow-doc.pdf'].includes(name))
compile(join(PACKAGE, 'examples/paper'), 'paper.tex', (name) => !/\.(aux|log|out)$/.test(name) && !FILES.includes(name))

zipFolder(PACKAGE, join(RELEASE, 'stickyflow.zip'), 'stickyflow')
console.log('release/stickyflow.zip')
