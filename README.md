# stickyflow-latex

SFL figures in LaTeX, drawn while the document compiles. The renderer is stickyflow.js itself, translated to Lua, so a figure in the PDF looks
the same as in the browser, and every new version of the library comes along with the next build.

The PDF carries the SFL of each figure, its data and its place on the page. Opened with the stickyflow PDF extension, the figures come alive:
their sliders move, their drawings follow.

## Use it

1. Put the two files from `dist/` next to your document: `stickyflow.sty` and `stickyflow.lua`. In Overleaf, upload them into the project
   once.
2. Compile with LuaLaTeX. In Overleaf: Menu, Compiler, LuaLaTeX.
3. Load the package and write a figure into the document:

```latex
\usepackage{stickyflow}

\begin{sfl}[0.8\linewidth]
sfl 1.11

Model report {
  ...
}
---
{ "sales": [{ "quarter": "Q1", "amount": 42 }, { "quarter": "Q2", "amount": 55 }] }
\end{sfl}
```

The optional width is the width of the figure, the line by default. The rows of its data sources, if it has any, follow the SFL as JSON after a
line of three dashes. The environment cannot stand inside the argument of another command.

A figure can also stay in a file of its own, with its data in another:

```latex
\sflinput[0.62\linewidth]{section-study.sfl}
\sflinput[0.8\linewidth][revenue.json]{revenue.sfl}
```

Controls such as sliders are left out of print; they show in the extension, under the pointer. `examples/section-study.tex` is a complete
document with both ways.

## How it works

The static core of stickyflow.js, which renders SFL to SVG without a browser, is translated to Lua with TypeScriptToLua. Before that,
`tools/codemod.mjs` rewrites a copy of it where JavaScript and Lua differ: regular expressions, the truth of 0 and the empty text, 32 bit
arithmetic, stable sorting, lists with holes and a few built-in functions. `src/shims.ts` holds the helpers it calls, and they are translated
with it.

In LaTeX, `lua/stickyflow.lua` renders the SFL to SVG with that core and draws the SVG as PDF operators: paths, shapes, arcs, arrow heads,
clips, dashes and transparency. Shapes go into forms with their own resources, so the resources of the page stay as other packages set them.
Texts are set by TeX in the fonts of the document. After the last page, the package attaches `stickyflow.json` with every figure for the
extension.

## Build

```bash
npm install
npm run build
```

The build takes the sources of stickyflow.js from `../stickyflow.js/src`, or from the folder in `STICKYFLOW_SRC`, and writes the two files of
`dist/`, with the translated core preloaded in `stickyflow.lua`.

To compile the example locally, point TeX and Lua at `dist/`:

```bash
cd examples
TEXINPUTS="../dist:" LUAINPUTS="../dist:" lualatex section-study.tex
```

## Not yet

- Gradients are drawn in their middle color.
- Shaders, 3D scenes and inputs, which only a browser draws. A 3D scene is to be placed as a still picture, with its model attached for the
  extension.
