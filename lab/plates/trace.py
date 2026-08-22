# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pillow>=10.3",
#   "numpy>=1.26",
#   "scikit-image>=0.24",
#   "requests>=2.31",
# ]
# ///
"""
Staple plates: turn a source image into a three-band ink plate as SVG.

    uv run --script lab/plates/trace.py --all
    uv run --script lab/plates/trace.py rice --preview

The web app draws ten staples. Hand-drawing them produced clip art, so the
art is traced from public-domain source imagery instead, by this script,
which is the point: the plates are generated, not drawn, and anyone can
rerun it.

The pipeline is posterisation done in vector rather than raster. A greyscale
source is cut at three luminance thresholds into three NESTED masks -- every
darker band lies wholly inside the lighter one. Nesting is not an accident of
the maths, it is what stops hairline seams appearing between adjacent bands
the way disjoint regions would. The layers then composite, so each layer's
own opacity is solved backwards from the tone the stack should land on.

Output contract, which the web app depends on:

  * one <g> holding three <path>, lightest first
  * group has no opacity of its own -- the consumer sets it, and gets
    0.06 / 0.11 / 0.18 at group opacity 0.18, all three lifting in
    proportion when it animates to 0.45
  * a radial vignette mask is baked in, so the edge fade travels with the
    file and works the same in the hero, the staple rows and /prices
  * ink is #1f1c18 (--color-ink); the app is light-only, so currentColor
    would buy nothing and would force a mask-and-background technique
    with a worse Safari story
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from skimage import measure

HERE = Path(__file__).parent
REPO = HERE.parent.parent
SOURCES = HERE / "sources.json"
CACHE = HERE / ".cache"
PREVIEW = HERE / ".preview"
OUT = REPO / "apps" / "web" / "public" / "plates"
CREDITS = HERE / "CREDITS.md"

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
UA = "basketwatch-plates/1.0 (https://github.com/spencerjireh; one-off art pipeline)"

INK = "#1f1c18"

# The tone each band should reach once the stack has composited, relative to
# the group opacity the consumer sets. 1.0 is the darkest band.
TARGET = (0.33, 0.61, 1.0)

# Every plate is emitted on this square field. Square keeps the CSS honest:
# one aspect ratio for the hero watermark, the row art and the /prices chips.
FIELD = 1000

# Path data gzips to roughly a fifth of this, so the ceiling is a sanity
# backstop against a source that traces into confetti -- not a byte budget.
SIZE_CEILING = 90_000


# --------------------------------------------------------------------------
# sources


@dataclass
class Source:
    key: str
    subject: str
    commons: str | None = None
    url: str | None = None
    # fraction of the frame to keep: left, top, right, bottom. Botanical
    # plates carry a caption and a plate number, and both trace as ink.
    crop: tuple[float, float, float, float] = (0.0, 0.0, 1.0, 1.0)
    # pixels lighter than this (0..1) are paper, not ink
    paper: float = 0.82
    # where the two inner thresholds sit in the ink's own tone distribution
    quantiles: tuple[float, float] = (0.55, 0.20)
    invert: bool = False
    # drop contours smaller than this fraction of the frame -- speckle
    min_area: float = 0.00035
    tolerance: float = 1.1
    # air left around the subject once it is trimmed to its own bounds. The
    # staple rows crop the plate to the row, so a compact subject that fills
    # its frame is cropped down to a featureless middle; padding it out is
    # what keeps it recognisable there.
    pad: float = 0.09
    note: str = ""


def load_sources() -> dict[str, Source]:
    raw = json.loads(SOURCES.read_text())
    out: dict[str, Source] = {}
    for key, entry in raw.items():
        fields = dict(entry)
        for name in ("crop", "quantiles"):
            if name in fields:
                fields[name] = tuple(fields[name])
        out[key] = Source(key=key, **fields)
    return out


# --------------------------------------------------------------------------
# fetch


def strip_html(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def resolve(source: Source) -> tuple[str, dict[str, str]]:
    """Return (download url, credit metadata)."""
    if source.url:
        return source.url, {"source": source.url, "licence": "see sources.json"}

    assert source.commons
    reply = requests.get(
        COMMONS_API,
        params={
            "action": "query",
            "format": "json",
            "titles": source.commons,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata",
            "iiurlwidth": 1800,
        },
        headers={"User-Agent": UA},
        timeout=45,
    )
    reply.raise_for_status()
    pages = (reply.json().get("query") or {}).get("pages") or {}
    page = next(iter(pages.values()), None)
    if not page or "imageinfo" not in page:
        raise SystemExit(f"{source.key}: commons has no such file: {source.commons}")

    info = page["imageinfo"][0]
    meta = info.get("extmetadata", {})

    def field(name: str) -> str:
        return strip_html(meta.get(name, {}).get("value", "")) or "unknown"

    return info.get("thumburl") or info["url"], {
        "source": f"https://commons.wikimedia.org/wiki/{source.commons.replace(' ', '_')}",
        "file": info["url"],
        "author": field("Artist"),
        "licence": field("LicenseShortName"),
        "credit": field("Credit"),
    }


def fetch(source: Source) -> tuple[Path, dict[str, str]]:
    url, meta = resolve(source)
    CACHE.mkdir(exist_ok=True)
    stamp = hashlib.sha1(url.encode()).hexdigest()[:12]
    path = CACHE / f"{source.key}-{stamp}"
    if not path.exists():
        reply = requests.get(url, headers={"User-Agent": UA}, timeout=90)
        reply.raise_for_status()
        path.write_bytes(reply.content)
    return path, meta


# --------------------------------------------------------------------------
# raster


def normalise(path: Path, source: Source, work: int) -> np.ndarray:
    """Greyscale, cropped, contrast-stretched, blurred. 0 = black, 1 = paper."""
    image = Image.open(path)
    # A palette or LA source loses its alpha silently on a bare convert("L");
    # flatten onto white first so transparency reads as paper, not as ink.
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        flat = Image.new("RGBA", image.size, (255, 255, 255, 255))
        image = Image.alpha_composite(flat, image)
    image = image.convert("L")

    left, top, right, bottom = source.crop
    w, h = image.size
    image = image.crop((int(left * w), int(top * h), int(right * w), int(bottom * h)))

    if source.invert:
        image = ImageOps.invert(image)

    scale = work / max(image.size)
    if scale < 1:
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )

    image = ImageOps.autocontrast(image, cutoff=(1, 1))
    # Blur before thresholding. Without it every band edge is a pixel
    # staircase, and Douglas-Peucker faithfully reproduces the staircase.
    image = image.filter(ImageFilter.GaussianBlur(radius=max(1.0, image.width / 700)))

    return np.asarray(image, dtype=np.float32) / 255.0


def thresholds(grey: np.ndarray, source: Source) -> list[float]:
    ink = grey[grey < source.paper]
    if ink.size == 0:
        raise SystemExit(f"{source.key}: nothing darker than paper={source.paper}")
    lo, hi = source.quantiles
    return [
        source.paper,
        float(np.quantile(ink, lo)),
        float(np.quantile(ink, hi)),
    ]


def trim(grey: np.ndarray, paper: float, pad: float) -> np.ndarray:
    """Crop to the ink, then pad. Makes every plate fill its field the same."""
    ink = grey < paper
    rows = np.flatnonzero(ink.any(axis=1))
    cols = np.flatnonzero(ink.any(axis=0))
    if rows.size == 0 or cols.size == 0:
        return grey
    cut = grey[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]
    # Pad with fresh paper rather than by widening the crop. A subject that
    # already fills its source has no spare margin to take, and clamping
    # against the frame would silently ignore the setting.
    margin = round(pad * max(cut.shape))
    return np.pad(cut, margin, constant_values=1.0)


# --------------------------------------------------------------------------
# vector


def chaikin(points: np.ndarray, passes: int = 2) -> np.ndarray:
    """Corner-cutting on a closed ring. Turns a polygon back into a curve."""
    for _ in range(passes):
        head = points
        tail = np.roll(points, -1, axis=0)
        cut = np.empty((len(points) * 2, 2), dtype=points.dtype)
        cut[0::2] = 0.75 * head + 0.25 * tail
        cut[1::2] = 0.25 * head + 0.75 * tail
        points = cut
    return points


def ring_area(points: np.ndarray) -> float:
    x, y = points[:, 0], points[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def rings(mask: np.ndarray, source: Source, scale: float, offset: tuple[float, float]):
    """Contour one band into simplified, smoothed rings in field coordinates."""
    # Pad by one pixel so a shape touching the frame still closes into a ring
    # rather than being clipped into an open polyline.
    padded = np.pad(mask.astype(np.float32), 1)
    floor = source.min_area * mask.size
    out: list[np.ndarray] = []

    for contour in measure.find_contours(padded, 0.5):
        ring = measure.approximate_polygon(contour, tolerance=source.tolerance)
        if len(ring) < 4 or ring_area(ring) < floor:
            continue
        ring = chaikin(ring[:-1] if np.allclose(ring[0], ring[-1]) else ring)
        # A second, gentler pass drops the points Chaikin added along the
        # straights, where they say nothing, and keeps the ones on curves.
        ring = measure.approximate_polygon(
            np.vstack([ring, ring[:1]]), tolerance=source.tolerance * 0.32
        )
        if len(ring) < 4:
            continue
        # find_contours works in (row, col); SVG wants (x, y).
        xy = np.column_stack([ring[:, 1] - 1, ring[:, 0] - 1]) * scale
        out.append(xy + np.asarray(offset))

    return out


def path_data(rings_: list[np.ndarray]) -> str:
    parts: list[str] = []
    for ring in rings_:
        points = [f"{x:.1f},{y:.1f}" for x, y in ring]
        parts.append("M" + points[0] + "L" + "L".join(points[1:]) + "Z")
    return "".join(parts)


def solve_opacities(targets=TARGET) -> list[float]:
    """
    Bands are nested, so they composite. Solve each layer's own opacity so
    the stack lands on the target tone: 1-(1-a)(1-p) = t.
    """
    out: list[float] = []
    covered = 0.0
    for target in targets:
        if covered >= 1.0:
            out.append(1.0)
            continue
        own = (target - covered) / (1.0 - covered)
        out.append(round(min(1.0, max(0.0, own)), 4))
        covered = target
    return out


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {field} {field}" \
role="img" aria-label="{subject}">
<defs>
<radialGradient id="fade" cx="50%" cy="50%" r="62%">
<stop offset="0%" stop-color="#fff"/>
<stop offset="34%" stop-color="#fff"/>
<stop offset="100%" stop-color="#000"/>
</radialGradient>
<mask id="edge"><rect width="{field}" height="{field}" fill="url(#fade)"/></mask>
</defs>
<g mask="url(#edge)" fill="{ink}" fill-rule="evenodd">
{paths}
</g>
</svg>
"""


def build(source: Source, work: int, preview: bool) -> tuple[str, dict[str, str], dict]:
    path, meta = fetch(source)
    grey = normalise(path, source, work)
    cuts = thresholds(grey, source)
    grey = trim(grey, source.paper, source.pad)

    # Fit the trimmed plate into the square field, centred.
    scale = FIELD / max(grey.shape)
    offset = (
        (FIELD - grey.shape[1] * scale) / 2,
        (FIELD - grey.shape[0] * scale) / 2,
    )

    # A bimodal source -- a solid black cockerel on pale ground -- puts both
    # inner thresholds inside the same ink, and the darkest band comes back
    # empty. Solving over the bands that actually carry geometry keeps the
    # plate's darkest tone at full strength, so a two-tone plate sits at the
    # same weight in a row as a three-tone one instead of reading as faded.
    bands = [rings(grey < cut, source, scale, offset) for cut in cuts]
    drawn = [band for band in bands if band]
    opacities = solve_opacities(TARGET[len(TARGET) - len(drawn) :]) if drawn else []
    paths = [
        f'<path opacity="{opacity}" d="{path_data(band)}"/>'
        for band, opacity in zip(drawn, opacities)
    ]

    svg = SVG.format(
        field=FIELD,
        ink=INK,
        subject=source.subject,
        paths="\n".join(paths),
    )

    stats = {
        "points": sum(len(r) for band in bands for r in band),
        "rings": sum(len(band) for band in bands),
        "bytes": len(svg.encode()),
        "cuts": [round(c, 3) for c in cuts],
    }

    if preview:
        write_preview(source, grey, drawn, opacities)

    return svg, meta, stats


def write_preview(source, grey, bands, opacities) -> None:
    """
    Source beside trace, so a bad plate is visible before it ships. The trace
    half is drawn from the same rings the SVG carries -- not from the raster
    masks -- so simplification error shows up here rather than in the browser.
    """
    PREVIEW.mkdir(exist_ok=True)
    height = FIELD
    left = Image.fromarray((grey * 255).astype(np.uint8)).convert("RGB")
    left = ImageOps.pad(left, (FIELD, height), color=(250, 247, 242))

    right = Image.new("RGB", (FIELD, height), (250, 247, 242))
    for band, opacity in zip(bands, opacities):
        # XOR the rings together rather than painting them solid: that is what
        # fill-rule="evenodd" does in the SVG, and it is the whole reason holes
        # exist. Painting each ring filled would show a plate the browser will
        # never draw.
        layer = np.zeros((height, FIELD), dtype=bool)
        for ring in band:
            one = Image.new("L", (FIELD, height), 0)
            ImageDraw.Draw(one).polygon([tuple(p) for p in ring], fill=255)
            layer ^= np.asarray(one, dtype=bool)
        alpha = Image.fromarray((layer * int(255 * opacity)).astype(np.uint8))
        right = Image.composite(
            Image.new("RGB", right.size, (31, 28, 24)), right, alpha
        )

    sheet = Image.new("RGB", (FIELD * 2 + 12, height), (255, 255, 255))
    sheet.paste(left, (0, 0))
    sheet.paste(right, (FIELD + 12, 0))
    sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS).save(
        PREVIEW / f"{source.key}.png"
    )


# --------------------------------------------------------------------------
# credits


def write_credits(entries: dict[str, dict[str, str]], sources: dict[str, Source]) -> None:
    lines = [
        "# Plate sources",
        "",
        "Generated by `lab/plates/trace.py` -- do not edit by hand.",
        "",
        "Every plate under `apps/web/public/plates/` is traced from the source",
        "below. Nothing here is redistributed as a photograph: only the traced",
        "outline ships, and the source files stay out of the repository.",
        "",
    ]
    for key in sorted(entries):
        meta = entries[key]
        source = sources[key]
        lines += [
            f"## {key}",
            "",
            f"- Subject: {source.subject}",
            f"- Source: {meta.get('source')}",
            f"- Author: {meta.get('author', 'unknown')}",
            f"- Licence: {meta.get('licence', 'unknown')}",
        ]
        if source.note:
            lines.append(f"- Note: {source.note}")
        lines.append("")
    CREDITS.write_text("\n".join(lines))


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("keys", nargs="*", help="staple keys; default is all")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--preview", action="store_true", help="write proof PNGs")
    parser.add_argument("--work", type=int, default=1400, help="trace resolution")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    sources = load_sources()
    keys = args.keys or list(sources)
    unknown = [k for k in keys if k not in sources]
    if unknown:
        raise SystemExit(f"unknown staples: {', '.join(unknown)}")

    args.out.mkdir(parents=True, exist_ok=True)
    credits: dict[str, dict[str, str]] = {}
    over: list[str] = []

    for key in keys:
        source = sources[key]
        svg, meta, stats = build(source, args.work, args.preview)
        (args.out / f"{key}.svg").write_text(svg)
        credits[key] = meta
        flag = ""
        if stats["bytes"] > SIZE_CEILING:
            over.append(key)
            flag = "  OVER CEILING"
        print(
            f"{key:12} {stats['bytes']:>7,}B  {stats['rings']:>4} rings"
            f"  {stats['points']:>5} pts  cuts={stats['cuts']}{flag}"
        )

    # Only rewrite CREDITS when the whole set was built; a single-staple run
    # would otherwise silently drop the other nine.
    if len(keys) == len(sources):
        write_credits(credits, sources)
        print(f"\ncredits -> {CREDITS.relative_to(REPO)}")

    if over:
        print(f"\nover the {SIZE_CEILING:,}B ceiling: {', '.join(over)}", file=sys.stderr)
        print("raise --tolerance or min_area in sources.json", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
