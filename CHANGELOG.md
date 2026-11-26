# Changelog

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
