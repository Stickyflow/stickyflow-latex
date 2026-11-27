# Changelog

## 0.2.1, 27 November 2026

Built from stickyflow.js 0.23.2.

- `\sflhint[text]` sets a note that a figure is interactive on a layer of the PDF. Every reader shows it, and a viewer that draws the
  figures live hides it. The layer needs no other package.
- The zip of the release is a zip. The ones of 0.1.0 and 0.2.0 were tar archives under the name of a zip, which some systems do not open.
- The sample paper sets its notes with `\sflhint`. With ocgx2 and hyperref together, LuaLaTeX gave the layer of its notes the number of
  another object, so no viewer could hide them.

## 0.2.0, 26 November 2026

- A figure without a scene in three dimensions that is given a picture is that picture in print, for what only a browser draws, as
  a shader. Its source still travels with the page, so a viewer draws it live.
- `examples/paper`: a sample paper in two columns with seven interactive figures, from a model fitted by hand to a synthesizer in
  three dimensions. Its figures come from the SFL gallery; the zip holds them and the compiled paper.

## 0.1.1, 26 November 2026

- A figure whose bindings call a math function such as `max`, `sin` or `round` is drawn again. In 0.1.0 it stopped the document with an error about `Array`.

## 0.1.0, 26 November 2026

The first release. Built from stickyflow.js 0.23.1.

- SFL written in the document between `\begin{sfl}` and `\end{sfl}`, or kept in a file and drawn with `\sflinput`.
- The rows of the data sources as JSON, after a line of three dashes or in a file of their own.
- Scenes in three dimensions as a still picture in print, with their models attached to the PDF.
- Real transparency, in forms with their own resources.
- Controls such as sliders are left out of print.
- The PDF carries the SFL, the data and the place of every figure, so a viewer can make the figures live.
