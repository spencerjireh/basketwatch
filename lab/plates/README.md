# Staple plates

The ten staples on the front page each carry a piece of art. This directory
makes it.

```
uv run --script lab/plates/trace.py --all
uv run --script lab/plates/trace.py rice --preview
```

Output goes to `apps/web/public/plates/*.svg`, and `CREDITS.md` beside this
file is regenerated from the sources' own Commons metadata on every full run.
Neither is edited by hand.

Unlike the rest of `lab/`, this is not exploration. It is the build step for
shipped art, kept here because it is a one-off run rather than part of
`turbo build`: the SVGs are committed, and nothing in CI needs Python.

## Why it exists

The first version of this art was ten `<path d="...">` strings written by
hand. They read as clip art. Tracing real source imagery is both better
looking and more honest about where the pictures came from.

## How it works

Posterisation done in vector. A greyscale source is cut at three luminance
thresholds into three nested masks -- every darker band lies wholly inside
the lighter one -- and each mask is contoured, simplified and smoothed into
one `<path>`. Nesting is deliberate: disjoint bands would leave hairline
seams where they meet.

The three layers composite, so each layer's own opacity is solved backwards
from the tone the stack should land on. The group carries no opacity itself:
the web app sets it, and gets 0.06 / 0.11 / 0.18 at rest, all three lifting
in proportion when a row animates to 0.45.

## Tuning a plate

Everything lives in `sources.json`. The knobs, in the order they usually
matter:

- `crop` -- fractions of the frame to keep. Most period plates carry a
  caption, a plate number and dissection figures in the margins, and all
  three trace as litter.
- `paper` -- the luminance above which a pixel is background. The default
  0.82 suits a plate printed on white. A source with a flat grey ground or
  a hatched meadow needs it lower, which is how the cow is separated from
  her field.
- `invert` -- for a pale subject on a dark ground.
- `quantiles` -- where the two inner thresholds sit inside the ink's own
  tone distribution.
- `min_area`, `tolerance` -- speckle floor and simplification. Raise either
  if a plate goes over the size ceiling.

`--preview` writes `.preview/<key>.png`: the source beside the trace, with
the trace drawn from the same rings the SVG carries and XORed the way
`fill-rule="evenodd"` will draw them. What you see there is what ships.

## Sourcing

Public domain first. Six of the ten are 19th-century botanical plates --
five from Blanco's *Flora de Filipinas*, which is both public domain and
from one of the two countries the basket prices -- and three more come from
period food and livestock plates. Only the egg is a modern photograph, for
want of any usable period illustration.

The source files themselves are cached in `.cache/` and are not committed.
Only the traced outlines ship.
