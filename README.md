# stickyflow-latex

SFL figures in LaTeX, drawn while the document compiles. The renderer is stickyflow.js itself, translated to Lua, so a figure in the PDF looks
the same as in the browser, and every new version of the library comes along with the next build.

## Use it

1. Put the three files from `dist/` next to your document: `stickyflow.sty`, `stickyflow.lua` and `stickyflow-core.lua`. In Overleaf, upload
   them into the project.
2. Compile with LuaLaTeX. In Overleaf: Menu, Compiler, LuaLaTeX.
3. Load the package and place a figure:

```latex
\usepackage{stickyflow}

\sflinput[0.9\linewidth]{section-study.sfl}
```

`examples/section-study.tex` is a complete document.

## How it works

The static core of stickyflow.js, which renders SFL to SVG without a browser, is translated to Lua with TypeScriptToLua. Before that,
`tools/codemod.mjs` rewrites a copy of it where JavaScript and Lua differ: regular expressions, the truth of 0 and the empty text, 32 bit
arithmetic, stable sorting, lists with holes and a few built-in functions. `src/shims.ts` holds the helpers it calls, and they are translated
with it.

In LaTeX, `lua/stickyflow.lua` renders the SFL to SVG with that core and draws the SVG as PDF operators: paths, shapes, arcs, arrow heads,
clips and dashes. Texts are set by TeX in the fonts of the document.

## Build

```bash
npm install
npm run build
```

The build takes the sources of stickyflow.js from `../stickyflow.js/src`, or from the folder in `STICKYFLOW_SRC`, and writes `dist/`.

To compile the example locally, point TeX and Lua at `dist/`:

```bash
cd examples
TEXINPUTS="../dist:" LUAINPUTS="../dist:" lualatex section-study.tex
```

## Not yet

- The SFL source and the place of each figure are not yet carried in the PDF, which the stickyflow PDF extension needs to make the figure
  live.
- SFL written in the document itself, in an environment.
- Gradients are drawn in their middle color, and transparency is mixed with white.
- Shaders, 3D scenes and inputs, which only a browser draws.
