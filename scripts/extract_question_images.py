#!/usr/bin/env python3
"""
Extract answer images for questions with options_are_images from the Zürich PDF.

Writes question-images/{number_in_pdf:03d}_{a|b|c|d}.png and refreshes JSON paths.

Some questions (e.g. maps) place each option as two stacked PDF images (base map +
overlay). We merge rectangles that strongly overlap, then rasterize the union clip
so each PNG matches what you see in the PDF.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Install dependencies: pip install -r requirements.txt", file=sys.stderr)
    raise

REPO_ROOT = Path(__file__).resolve().parent.parent


def _rect_area(r: fitz.Rect) -> float:
    return float(r.get_area())


def _union_rect(entries: list[dict]) -> fitz.Rect:
    u = fitz.Rect(entries[0]["rect"])
    for e in entries[1:]:
        u |= e["rect"]
    return u


def _overlap_merge_fraction(ri: fitz.Rect, rj: fitz.Rect) -> float:
    inter = ri & rj
    if inter.is_empty:
        return 0.0
    return float(inter.get_area()) / min(_rect_area(ri), _rect_area(rj))


def cluster_rectangles(entries: list[dict], min_overlap_frac: float = 0.32) -> list[list[dict]]:
    """Group images that sit on top of each other (same option, two layers)."""
    n = len(entries)
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        for j in range(i + 1, n):
            if _overlap_merge_fraction(entries[i]["rect"], entries[j]["rect"]) >= min_overlap_frac:
                union(i, j)

    buckets: dict[int, list[dict]] = {}
    for i in range(n):
        buckets.setdefault(find(i), []).append(entries[i])
    return list(buckets.values())


def _image_entries(page: fitz.Page, doc: fitz.Document, header_y_max: float) -> list[dict]:
    out: list[dict] = []
    for img_idx, img in enumerate(page.get_images(full=True)):
        xref = img[0]
        try:
            base = doc.extract_image(xref)
        except Exception:
            continue
        w, h = base["width"], base["height"]
        if min(w, h) < 35:
            continue
        rects = page.get_image_rects(xref)
        if not rects:
            continue
        r = rects[0]
        if r.y0 < header_y_max:
            continue
        area = w * h
        if area > 2_000_000:
            continue
        out.append(
            {
                "xref": xref,
                "w": w,
                "h": h,
                "rect": fitz.Rect(r),
                "x0": float(r.x0),
                "y0": float(r.y0),
                "area": area,
                "img_idx": img_idx,
            }
        )
    return out


def _order_options_a_through_d(seg: list[dict]) -> list[dict]:
    """
    Match PDF label order: one horizontal row → left-to-right by x.
    Two stacked rows (e.g. «a) b)» / «c) d)» on maps) → row-major a,b then c,d.
    """
    if len(seg) != 4:
        return sorted(seg, key=lambda e: e["x0"])
    ys = [e["y0"] for e in seg]
    y_span = max(ys) - min(ys)
    if y_span <= 12.0:
        return sorted(seg, key=lambda e: e["x0"])
    y_mid = (min(ys) + max(ys)) / 2.0
    row_top = [e for e in seg if e["y0"] < y_mid]
    row_bot = [e for e in seg if e["y0"] >= y_mid]
    if len(row_top) == 2 and len(row_bot) == 2:
        row_top.sort(key=lambda e: e["x0"])
        row_bot.sort(key=lambda e: e["x0"])
        return row_top + row_bot
    return sorted(seg, key=lambda e: (e["y0"], e["x0"]))


def _pick_four_options(entries: list[dict]) -> list[dict] | None:
    """
    Legacy: four separate embedded images on one row / split by y-gap.
    """
    if len(entries) < 4:
        return None
    s = sorted(entries, key=lambda e: e["y0"])
    if len(s) == 4:
        return _order_options_a_through_d(s)
    best_i = max(range(1, len(s)), key=lambda i: s[i]["y0"] - s[i - 1]["y0"])
    top, bottom = s[:best_i], s[best_i:]
    for seg in (top, bottom):
        if len(seg) == 4:
            return _order_options_a_through_d(seg)
    candidates = [seg for seg in (top, bottom) if len(seg) >= 4]
    if not candidates:
        return _order_options_a_through_d(s[:4])
    seg = min(candidates, key=lambda g: sum(e["y0"] for e in g) / len(g))
    return _order_options_a_through_d(seg[:4])


def _clusters_to_ordered_options(clusters: list[list[dict]]) -> list[fitz.Rect] | None:
    """Return four page-space clips (union per cluster), ordered a–d."""
    if len(clusters) < 4:
        return None
    while len(clusters) > 4:
        clusters = sorted(clusters, key=lambda c: _union_rect(c).get_area())
        clusters.pop(0)
    metas = []
    for c in clusters:
        u = _union_rect(c)
        metas.append({"clip": u, "x0": float(u.x0), "y0": float(u.y0)})
    ordered = _order_options_a_through_d(metas)
    return [fitz.Rect(m["clip"]) for m in ordered]


def extract_four_option_clips(
    doc: fitz.Document, page_1based: int, header_y_max: float = 95.0
) -> tuple[fitz.Page, list[fitz.Rect]] | None:
    page = doc[page_1based - 1]
    entries = _image_entries(page, doc, header_y_max)
    if len(entries) < 4:
        return None

    clusters = cluster_rectangles(entries)
    clips = _clusters_to_ordered_options(clusters)
    if clips and len(clips) == 4:
        return page, clips

    picked = _pick_four_options(entries)
    if not picked or len(picked) < 4:
        return None
    return page, [fitz.Rect(e["rect"]) for e in picked[:4]]


def save_clip_png(page: fitz.Page, clip: fitz.Rect, path: Path, zoom: float = 3.0) -> None:
    """Rasterize the given page region (union of stacked images)."""
    m = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(clip=clip, matrix=m, alpha=False)
    try:
        pix.save(path.as_posix())
    finally:
        pix = None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--pdf",
        type=Path,
        default=REPO_ROOT / "sources" / "grundkenntnistest_kanton_zuerich.pdf",
    )
    ap.add_argument(
        "--json",
        type=Path,
        default=REPO_ROOT / "grundkenntnistest_kanton_zuerich.json",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "question-images",
        help="Directory that will contain NNN_x.png files (default: repo question-images/)",
    )
    ap.add_argument(
        "--only",
        type=str,
        default="",
        help="Comma-separated number_in_pdf values to extract (e.g. 289 or 55,110,289). Empty = all.",
    )
    args = ap.parse_args()

    only: set[int] = set()
    if args.only.strip():
        for part in args.only.split(","):
            part = part.strip()
            if part:
                only.add(int(part))

    data = json.loads(args.json.read_text(encoding="utf-8"))
    letters = ["a", "b", "c", "d"]
    args.out_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(args.pdf)
    try:
        for cat in data.get("categories", []):
            for sub in cat.get("subsections", []):
                for q in sub.get("questions", []):
                    if not q.get("options_are_images"):
                        continue
                    n = q.get("number_in_pdf")
                    page = q.get("page")
                    if not n or not page:
                        print(
                            f"skip question missing number/page: {q.get('question', '')[:40]}",
                            file=sys.stderr,
                        )
                        continue
                    n_int = int(n)
                    if only and n_int not in only:
                        continue
                    got = extract_four_option_clips(doc, int(page))
                    if not got:
                        print(
                            f"Q{n} page {page}: could not find 4 option clips",
                            file=sys.stderr,
                        )
                        continue
                    qpage, clips = got
                    q["images"] = {}
                    for letter, clip in zip(letters, clips):
                        rel = f"question-images/{n_int:03d}_{letter}.png"
                        path = args.out_dir / f"{n_int:03d}_{letter}.png"
                        save_clip_png(qpage, clip, path)
                        q["images"][letter] = rel
                    q["note"] = "Antworten als Bilder im Original-PDF; siehe question-images."
    finally:
        doc.close()

    args.json.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated {args.json} and PNGs under {args.out_dir}")


if __name__ == "__main__":
    main()
