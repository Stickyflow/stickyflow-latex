// Packs release/stickyflow.zip for a GitHub release and for CTAN: the package, its documentation as PDF, the examples, README and license.
// Run after the build; it needs lualatex for the documentation.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

rmSync(RELEASE, { recursive: true, force: true })
mkdirSync(join(PACKAGE, 'doc'), { recursive: true })
for (const name of FILES) cpSync(join(ROOT, 'dist', name), join(PACKAGE, name))
for (const name of ['README.md', 'LICENSE', 'CHANGELOG.md']) cpSync(join(ROOT, name), join(PACKAGE, name))
cpSync(join(ROOT, 'doc/stickyflow-doc.tex'), join(PACKAGE, 'doc/stickyflow-doc.tex'))
cpSync(join(ROOT, 'examples'), join(PACKAGE, 'examples'), { recursive: true, filter: (from) => !/\.(aux|log|out|pdf)$/.test(from) })

// The documentation is compiled with the package beside it, which is taken away again.
const doc = join(PACKAGE, 'doc')
for (const name of FILES) cpSync(join(ROOT, 'dist', name), join(doc, name))
for (let run = 0; run < 2; run++) {
  execFileSync('lualatex', ['-interaction=nonstopmode', '-halt-on-error', 'stickyflow-doc.tex'], { cwd: doc, stdio: 'ignore' })
}
for (const name of readdirSync(doc)) {
  if (!['stickyflow-doc.tex', 'stickyflow-doc.pdf'].includes(name)) rmSync(join(doc, name), { recursive: true, force: true })
}

execFileSync('tar', ['-a', '-c', '-f', 'stickyflow.zip', 'stickyflow'], { cwd: RELEASE, stdio: 'inherit' })
console.log('release/stickyflow.zip')
