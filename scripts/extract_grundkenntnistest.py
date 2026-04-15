#!/usr/bin/env python3
"""
Extract questions, answers, categories, and images from
grundkenntnistest_kanton_zuerich.pdf into JSON (+ PNG assets).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Install dependencies: pip install -r requirements.txt", file=sys.stderr)
    raise

REPO_ROOT = Path(__file__).resolve().parent.parent

# Full re-extract overwrites JSON; keep hand-curated stem paths not covered by PDF rules below.
MANUAL_QUESTION_IMAGES: dict[int, str] = {
    279: "question-images/matterhorn.png",
}

# Stem refers to an on-page illustration (e.g. Amphitheater Avenches).
STEM_IMAGE_HINT = re.compile(r"abgebildet", re.I)


def _stem_text_for_image_hint(stem: str) -> str:
    """PDF line breaks / soft hyphens (U+00AD) break naive substring checks."""
    t = (stem or "").replace("\u00ad", "")
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    # Rejoin words split across lines (e.g. «abgebil» + newline + «dete» → abgebildete).
    t = re.sub(r"([a-zäöüA-ZÄÖÜß])\n([a-zäöüA-ZÄÖÜß])", r"\1\2", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def normalize_lines(text: str) -> list[str]:
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def normalize_unicode_dashes(s: str) -> str:
    t = s.replace("\u2013", "-").replace("\u2014", "-").replace("\u2212", "-")
    return t.strip().lstrip("\ufeff")


def is_footer(line: str) -> bool:
    s = normalize_unicode_dashes(line.strip())
    return bool(re.match(r"^--\s*\d+\s+of\s+\d+\s*--\s*$", s))


def parse_seite(line: str) -> int | None:
    s = normalize_unicode_dashes(line.strip())
    m = re.match(r"^Seite\s*(\d+)\s*/\s*\d+\s*$", s, re.I)
    return int(m.group(1)) if m else None


def is_toc_main(line: str) -> bool:
    return bool(re.match(r"^[1-5]\s+.+\s+\d+\s*$", line.strip()))


def is_toc_sub(line: str) -> bool:
    return bool(re.match(r"^\d\.\d\s+.+\s+\d+\s*$", line.strip()))


def parse_main_category(line: str) -> tuple[str, str] | None:
    s = normalize_unicode_dashes(line.strip())
    if is_toc_main(s):
        return None
    m = re.match(r"^([1-5])\s+(.+)$", s)
    if not m:
        return None
    num, title = m.group(1), m.group(2).strip()
    if "Inhaltsverzeichnis" in title:
        return None
    return num, title


def parse_sub_category(line: str) -> tuple[str, str] | None:
    s = normalize_unicode_dashes(line.strip())
    if is_toc_sub(s):
        return None
    m = re.match(r"^(\d\.\d)\s+(.+)$", s)
    if m:
        return m.group(1), m.group(2).strip()
    m2 = re.match(r"^(\d\.\d)(Bund|Kanton|Gemeinde)$", s)
    if m2:
        return m2.group(1), m2.group(2)
    return None


OPTION_START = re.compile(r"^([a-d])\)\s*(.*)$")

_SUB_NEXT = frozenset({"Bund", "Kanton", "Gemeinde"})


def merge_split_headings(lines: list[str], log: list[str]) -> list[str]:
    """
    PyMuPDF often splits headings across lines, e.g. '1' then 'Demokratie …'
    or '1.1' then 'Bund'. Merge so category regexes match.
    """
    out: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        raw = lines[i]
        s = normalize_unicode_dashes(raw.strip())
        if not s:
            out.append(raw)
            i += 1
            continue

        # Only merge one following line: greedy merging would swallow the first
        # question if the subsection line were missing from the extract order.
        if re.match(r"^[1-5]$", s) and i + 1 < n:
            nxt = normalize_unicode_dashes(lines[i + 1].strip())
            if nxt and not re.match(r"^\d\.\d", nxt) and not re.match(
                r"^a\)", nxt, re.I
            ):
                if not (
                    nxt.startswith("Seite")
                    or is_footer(nxt)
                    or nxt.startswith("Richtige")
                ):
                    out.append(f"{s} {nxt}")
                    i += 2
                    continue

        if re.match(r"^\d\.\d$", s) and i + 1 < n:
            nxt = normalize_unicode_dashes(lines[i + 1].strip())
            if nxt in _SUB_NEXT:
                merged = f"{s} {nxt}"
                out.append(merged)
                i += 2
                continue

        out.append(raw)
        i += 1
    return out


def parse_question_block(
    lines: list[str], start: int, log: list[str]
) -> tuple[dict, int] | None:
    """Parse one question starting at line index `start` (stem first line). Returns (question_dict, next_index)."""
    i = start
    n = len(lines)
    stem_parts: list[str] = []
    while i < n:
        raw = lines[i]
        s = normalize_unicode_dashes(raw.strip())
        if not s:
            if stem_parts:
                stem_parts.append("")
            i += 1
            continue
        if is_footer(s) or parse_seite(s) is not None:
            i += 1
            continue
        if parse_main_category(s) or parse_sub_category(s):
            log.append(f"Unexpected category inside stem at line {i + 1}: {s[:60]}")
            return None
        if OPTION_START.match(s):
            break
        stem_parts.append(raw.rstrip())
        i += 1
    if i >= n:
        return None
    opt_first = normalize_unicode_dashes(lines[i].strip())
    if re.match(r"^a\)\s*b\)\s*c\)\s*d\)\s*$", opt_first, re.I):
        i += 1
        if i >= n:
            return None
        ans_line = normalize_unicode_dashes(lines[i].strip())
        am = re.match(r"^Richtige\s+Antwort:\s*([a-d])\s*$", ans_line, re.I)
        if not am:
            log.append(f"Expected Richtige Antwort after image options at line {i + 1}")
            return None
        stem = "\n".join(stem_parts).strip()
        q: dict = {
            "question": stem,
            "options": {"a": None, "b": None, "c": None, "d": None},
            "correct_answer": am.group(1).lower(),
            "options_are_images": True,
            "images": {},
        }
        return q, i + 1

    m0 = OPTION_START.match(opt_first)
    if not m0:
        return None

    options: dict[str, str] = {}
    for letter in ("a", "b", "c", "d"):
        if i >= n:
            return None
        sm = OPTION_START.match(normalize_unicode_dashes(lines[i].strip()))
        if not sm or sm.group(1) != letter:
            log.append(f"Expected option {letter}) at line {i + 1}, got: {lines[i][:80]!r}")
            return None
        parts: list[str] = [sm.group(2).strip()] if sm.group(2).strip() else []
        i += 1
        while i < n:
            ns = normalize_unicode_dashes(lines[i].strip())
            if not ns:
                parts.append("")
                i += 1
                continue
            if OPTION_START.match(ns):
                break
            if ns.startswith("Richtige Antwort:"):
                break
            if is_footer(ns) or parse_seite(ns) is not None:
                i += 1
                continue
            if parse_main_category(ns) or parse_sub_category(ns):
                break
            parts.append(lines[i].rstrip())
            i += 1
        opt_text = "\n".join(parts).strip()
        options[letter] = opt_text

    if i >= n:
        return None
    ans_line = normalize_unicode_dashes(lines[i].strip())
    am = re.match(r"^Richtige\s+Antwort:\s*([a-d])\s*$", ans_line, re.I)
    if not am:
        log.append(f"Expected Richtige Antwort at line {i + 1}, got: {ans_line[:80]!r}")
        return None
    correct = am.group(1).lower()
    i += 1

    stem = "\n".join(stem_parts).strip()
    q = {
        "question": stem,
        "options": options,
        "correct_answer": correct,
        "options_are_images": False,
        "images": {},
    }

    return q, i


def extract_pdf_lines(pdf_path: Path, log: list[str]) -> list[str]:
    doc = fitz.open(pdf_path)
    try:
        parts: list[str] = []
        for page in doc:
            parts.append(page.get_text("text"))
        text = normalize_unicode_dashes("\n".join(parts))
        lines = normalize_lines(text)
        return merge_split_headings(lines, log)
    finally:
        doc.close()


def page_images_to_png(
    pdf_path: Path, out_dir: Path, min_side: int = 40
) -> dict[int, list[str]]:
    """
    Extract embedded images per 1-based page index. Returns map page_no -> list of relative paths
    images/pageXXX_imgY.png sorted by vertical position (top to bottom), then horizontal.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf_path)
    rel_paths: dict[int, list[str]] = {}
    try:
        for page_index in range(len(doc)):
            page = doc[page_index]
            page_no = page_index + 1
            img_list = page.get_images(full=True)
            entries: list[tuple[float, float, int, int, str]] = []
            for img_idx, img in enumerate(img_list):
                xref = img[0]
                try:
                    base = doc.extract_image(xref)
                except Exception:
                    continue
                w, h = base["width"], base["height"]
                if min(w, h) < min_side:
                    continue
                area = w * h
                y, x = 0.0, float(img_idx)
                try:
                    rects = page.get_image_rects(xref)
                    if rects:
                        r = rects[0]
                        y, x = -float(r.y0), float(r.x0)
                except Exception:
                    try:
                        if hasattr(page, "get_image_bbox"):
                            r = page.get_image_bbox(xref)
                            y, x = -float(r.y0), float(r.x0)
                    except Exception:
                        pass
                ext = base["ext"]
                img_bytes = base["image"]
                fname = f"page{page_no:03d}_img{img_idx:02d}.{ext}"
                fpath = out_dir / fname
                fpath.write_bytes(img_bytes)
                if ext.lower() != "png":
                    # convert to PNG via pixmap for consistency
                    try:
                        pm = fitz.Pixmap(doc, xref)
                        if pm.alpha:
                            pm = fitz.Pixmap(fitz.csRGB, pm)
                        png_path = out_dir / f"page{page_no:03d}_img{img_idx:02d}.png"
                        pm.save(png_path.as_posix())
                        pm = None
                        if fpath != png_path and fpath.exists():
                            fpath.unlink()
                        fname = png_path.name
                    except Exception:
                        pass
                rel = f"images/{fname}"
                entries.append((y, x, area, img_idx, rel))

            def order_for_options(
                rows: list[tuple[float, float, int, int, str]],
            ) -> list[str]:
                if not rows:
                    return []
                if len(rows) <= 4:
                    rows = sorted(rows, key=lambda t: (t[0], t[1]))
                    return [t[4] for t in rows]
                by_band: dict[float, list[tuple[float, float, str]]] = defaultdict(list)
                for yy, xx, _area, _i, rel in rows:
                    key = round(yy / 20.0) * 20.0
                    by_band[key].append((xx, yy, rel))
                for _k, band in sorted(by_band.items(), key=lambda kv: -len(kv[1])):
                    if len(band) >= 4:
                        band.sort(key=lambda t: t[0])
                        return [t[2] for t in band[:4]]
                r2 = sorted(rows, key=lambda t: (-t[2], t[1]))
                return [t[4] for t in r2[:4]]

            rel_paths[page_no] = order_for_options(entries)
    finally:
        doc.close()
    return rel_paths


def find_body_start(lines: list[str]) -> int:
    """Skip TOC: first real content is after Seite 2, or first '1.1 Bund'."""
    for idx, line in enumerate(lines):
        s = normalize_unicode_dashes(line.strip())
        if re.match(r"^Seite\s*2\s*/\s*78\s*$", s, re.I):
            return idx + 1
    for idx, line in enumerate(lines):
        s = normalize_unicode_dashes(line.strip())
        if re.match(r"^1\.1\s*Bund\s*$", s):
            return idx
    return 0


def parse_document(lines: list[str], log: list[str]) -> tuple[list[dict], int]:
    """Returns (list of category trees with questions, question_count)."""
    start = find_body_start(lines)
    if start == 0:
        log.append(
            "Could not find 'Seite 2/78' or '1.1 Bund'; parsing from beginning (TOC may pollute)."
        )

    categories: dict[str, dict] = {}
    order_main: list[str] = []

    def ensure_main(num: str, title: str) -> dict:
        if num not in categories:
            categories[num] = {"id": num, "title": title, "subsections": []}
            order_main.append(num)
        return categories[num]

    def ensure_sub(main: dict, sid: str, stitle: str) -> dict:
        for sub in main["subsections"]:
            if sub["id"] == sid:
                return sub
        sub = {"id": sid, "title": stitle, "questions": []}
        main["subsections"].append(sub)
        return sub

    current_main: str | None = None
    current_main_title = ""
    current_sub: str | None = None
    current_sub_title = ""
    current_page = 1

    i = start
    n = len(lines)
    q_global = 0

    while i < n:
        raw = lines[i]
        s = normalize_unicode_dashes(raw.strip())
        if not s:
            i += 1
            continue
        if is_footer(s):
            i += 1
            continue
        sp = parse_seite(s)
        if sp is not None:
            current_page = sp
            i += 1
            continue

        pm = parse_main_category(s)
        if pm:
            current_main, current_main_title = pm
            ensure_main(current_main, current_main_title)
            current_sub, current_sub_title = None, ""
            i += 1
            continue

        ps = parse_sub_category(s)
        if ps:
            current_sub, current_sub_title = ps
            if current_main is None:
                log.append(f"Subcategory before main at line {i + 1}: {s}")
            else:
                ensure_sub(categories[current_main], current_sub, current_sub_title)
            i += 1
            continue

        if current_main is None or current_sub is None:
            i += 1
            continue

        parsed = parse_question_block(lines, i, log)
        if not parsed:
            i += 1
            continue
        qdict, next_i = parsed
        q_global += 1
        qdict["number_in_pdf"] = q_global
        qdict["page"] = current_page

        if qdict.get("options_are_images"):
            qdict["note"] = (
                "Options shown as images in the PDF; see images.* for this page."
            )

        main = categories[current_main]
        sub = ensure_sub(main, current_sub, current_sub_title)
        sub["questions"].append(qdict)
        i = next_i

    out = [categories[k] for k in order_main if k in categories]
    return out, q_global


def attach_images(
    categories: list[dict], page_to_images: dict[int, list[str]], log: list[str]
) -> None:
    """Mutate questions with options_are_images: assign images/a..d from page list."""
    for cat in categories:
        for sub in cat.get("subsections", []):
            for q in sub.get("questions", []):
                if not q.get("options_are_images"):
                    continue
                page = q.get("page", 0)
                imgs = page_to_images.get(page, [])
                if len(imgs) < 4:
                    log.append(
                        f"Page {page}: expected 4 images for image-options question, got {len(imgs)} (#{q.get('number_in_pdf')})"
                    )
                letters = ["a", "b", "c", "d"]
                q["images"] = {}
                for j, letter in enumerate(letters):
                    if j < len(imgs):
                        q["images"][letter] = imgs[j]
                    else:
                        q["images"][letter] = None


def _save_image_xref_as_png(doc: fitz.Document, xref: int, path: Path) -> None:
    pm = fitz.Pixmap(doc, xref)
    try:
        if pm.alpha:
            pm = fitz.Pixmap(fitz.csRGB, pm)
        path.parent.mkdir(parents=True, exist_ok=True)
        pm.save(path.as_posix())
    finally:
        pm = None


def attach_question_stem_images(
    pdf_path: Path,
    categories: list[dict],
    out_dir: Path,
    log: list[str],
) -> None:
    """
    For text-option questions whose stem mentions «abgebildet», pick the largest
    non-trivial embedded image on that page and save as question-images/NNN.png.
    """
    doc = fitz.open(pdf_path)
    try:
        for cat in categories:
            for sub in cat.get("subsections", []):
                for q in sub.get("questions", []):
                    if q.get("options_are_images"):
                        continue
                    if q.get("question_image"):
                        continue
                    stem = q.get("question") or ""
                    if not STEM_IMAGE_HINT.search(_stem_text_for_image_hint(stem)):
                        continue
                    page_no = int(q.get("page") or 0)
                    n = q.get("number_in_pdf")
                    if not page_no or n is None:
                        continue
                    n_int = int(n)
                    page = doc[page_no - 1]
                    candidates: list[tuple[int, int]] = []
                    for img in page.get_images(full=True):
                        xref = img[0]
                        try:
                            base = doc.extract_image(xref)
                        except Exception:
                            continue
                        w, h = base["width"], base["height"]
                        if min(w, h) < 80 or (w * h) < 25_000:
                            continue
                        rects = page.get_image_rects(xref)
                        if not rects:
                            continue
                        candidates.append((w * h, xref))
                    if not candidates:
                        log.append(
                            f"Q{n_int}: stem «abgebildet» but no large image on page {page_no}"
                        )
                        continue
                    candidates.sort(key=lambda t: -t[0])
                    _area, xref = candidates[0]
                    fname = f"{n_int:03d}.png"
                    rel = f"question-images/{fname}"
                    fpath = out_dir / fname
                    _save_image_xref_as_png(doc, xref, fpath)
                    q["question_image"] = rel
    finally:
        doc.close()


def apply_manual_question_images(categories: list[dict]) -> None:
    for cat in categories:
        for sub in cat.get("subsections", []):
            for q in sub.get("questions", []):
                n = q.get("number_in_pdf")
                if n is None:
                    continue
                if int(n) in MANUAL_QUESTION_IMAGES:
                    q["question_image"] = MANUAL_QUESTION_IMAGES[int(n)]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--pdf",
        type=Path,
        default=REPO_ROOT / "sources" / "grundkenntnistest_kanton_zuerich.pdf",
    )
    ap.add_argument(
        "--out-json",
        type=Path,
        default=REPO_ROOT / "grundkenntnistest_kanton_zuerich.json",
    )
    ap.add_argument(
        "--image-dir",
        type=Path,
        default=REPO_ROOT / "images",
        help="Directory for extracted PNGs (under images/)",
    )
    ap.add_argument(
        "--question-image-dir",
        type=Path,
        default=REPO_ROOT / "question-images",
        help="Directory for stem images (question-images/NNN.png)",
    )
    args = ap.parse_args()

    log: list[str] = []
    lines = extract_pdf_lines(args.pdf, log)
    categories, total = parse_document(lines, log)

    page_to_images = page_images_to_png(args.pdf, args.image_dir)
    attach_images(categories, page_to_images, log)
    attach_question_stem_images(args.pdf, categories, args.question_image_dir, log)
    apply_manual_question_images(categories)

    payload = {
        "source_pdf": args.pdf.name,
        "total_questions": total,
        "categories": categories,
        "extraction_notes": log,
    }
    args.out_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Wrote {args.out_json} ({total} questions)")
    if log:
        print(f"Notes ({len(log)}):", file=sys.stderr)
        for line in log[:30]:
            print(f"  {line}", file=sys.stderr)
        if len(log) > 30:
            print(f"  ... and {len(log) - 30} more", file=sys.stderr)


if __name__ == "__main__":
    main()
