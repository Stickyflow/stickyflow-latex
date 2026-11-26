// Builds dist/: the static core of stickyflow.js translated to Lua, with the loader and the LaTeX package next to it.
//
// The core is taken from the sources of stickyflow.js beside this project (or STICKYFLOW_SRC), copied into build/, rewritten for Lua by
// codemod.mjs, and translated by TypeScriptToLua into one file.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIBRARY = resolve(process.env.STICKYFLOW_SRC ?? join(ROOT, '../stickyflow.js/src'))
const BUILD = join(ROOT, 'build')
const DIST = join(ROOT, 'dist')
const BROWSER_ONLY = ['runtime']

rmSync(BUILD, { recursive: true, force: true })
mkdirSync(join(BUILD, 'core'), { recursive: true })
cpSync(LIBRARY, join(BUILD, 'core'), { recursive: true, filter: (from) => !BROWSER_ONLY.some((dir) => from === join(LIBRARY, dir)) })

// Private class fields are not translated; they become ordinary fields with a prefix.
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]))
for (const file of walk(join(BUILD, 'core')).filter((f) => f.endsWith('.ts'))) {
  const text = readFileSync(file, 'utf8')
  if (/this\.#|^\s*(?:readonly |static |private )*#\w/m.test(text)) writeFileSync(file, text.replace(/#([A-Za-z_]\w*)/g, '_p_$1'))
}
cpSync(join(ROOT, 'src/shims.ts'), join(BUILD, 'core/__shims.ts'))
writeFileSync(
  join(BUILD, 'entry.ts'),
  `import { renderBound } from './core/binding/runtime';
import { __jsonParse } from './core/__shims';

// The figure as it is drawn when its bindings are read once: with the data given as JSON, and the values its Parameters start with.
export function renderSfl(source: string, data?: string): string {
  const rows = data ? (__jsonParse(data) as Record<string, never>) : {};
  return renderBound(source, { data: rows, padding: 0 }).svg;
}
`,
)
writeFileSync(
  join(BUILD, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: { target: 'ES2022', lib: ['ES2022'], module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, types: [], rootDir: '.', outDir: 'out' },
      files: ['entry.ts'],
      tstl: { luaTarget: '5.3', luaBundle: 'stickyflow-core.lua', luaBundleEntry: 'entry.ts', noImplicitSelf: false },
    },
    null,
    2,
  ),
)

const node = process.execPath
execFileSync(node, [join(ROOT, 'tools/codemod.mjs')], { cwd: BUILD, stdio: 'inherit' })
let log = ''
try {
  log = execFileSync(node, [join(ROOT, 'node_modules/typescript-to-lua/dist/tstl.js'), '-p', 'tsconfig.json'], { cwd: BUILD, encoding: 'utf8' })
} catch (error) {
  log = `${error.stdout ?? ''}${error.stderr ?? ''}`
}
const translationErrors = log.split('\n').filter((line) => line.includes('error TSTL'))
if (translationErrors.length > 0) {
  console.error(translationErrors.join('\n'))
  process.exit(1)
}
if (!existsSync(join(BUILD, 'out/stickyflow-core.lua'))) {
  console.error(log)
  process.exit(1)
}

// Two files for a project: the package, and one Lua file with the loader and, preloaded in it, the translated core.
rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const libraryPackage = join(LIBRARY, '../package.json')
const library = existsSync(libraryPackage) ? JSON.parse(readFileSync(libraryPackage, 'utf8')).version : 'unknown'
const core = readFileSync(join(BUILD, 'out/stickyflow-core.lua'), 'utf8')
const loader = readFileSync(join(ROOT, 'lua/stickyflow.lua'), 'utf8')
writeFileSync(
  join(DIST, 'stickyflow.lua'),
  `-- stickyflow ${version} for LuaLaTeX, licensed under the Apache License 2.0.\n` +
    `-- Built from the sources of stickyflow.js ${library}; do not edit, see https://github.com/Stickyflow/stickyflow-latex.\n` +
    `package.preload['stickyflow-core'] = function(...)\n${core}\nend\n\n${loader}`,
)
cpSync(join(ROOT, 'tex/stickyflow.sty'), join(DIST, 'stickyflow.sty'))
for (const name of ['stickyflow.lua', 'stickyflow.sty']) console.log(`dist/${name} ${Math.round(statSync(join(DIST, name)).size / 1024)} KB`)
