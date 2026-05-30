"""Build the deck — concatenate modular sources into dist/index.html.

Usage:
    python build.py

Reads:
    template.html         shell con {{CSS}}, {{CONTENT}}, {{JS}}, {{GIFT_MD_JSON}}
    assets/deck.css       full CSS
    assets/deck.js        progress + nav highlight + gift download handler
    assets/visualizer.js  visualizer state machines (loop + fs nav)
    content/*.html        slide blocks in order
    CLAUDE-starter.md     il regalo finale, embeddato come stringa JSON

Writes:
    dist/index.html       single-file deck (autocontenuto, spedibile da solo)
    dist/CLAUDE.md        copia del regalo (fallback per chi apre da dist/)

Niente dipendenze esterne. Stdlib only.
"""
import json
from pathlib import Path

BASE = Path(__file__).parent

# Indent helper — il template e' indentato a 4 spazi, il contenuto incollato
# deve seguire la stessa colonna per non sembrare disallineato.
def indent(text: str, spaces: int) -> str:
    prefix = " " * spaces
    return "\n".join((prefix + line) if line else line for line in text.splitlines())


def main() -> None:
    template = (BASE / "template.html").read_text(encoding="utf-8")

    # ---- CSS ----
    css = (BASE / "assets" / "deck.css").read_text(encoding="utf-8").rstrip()
    css_indented = indent(css, 4)

    # ---- JS (deck.js + visualizer.js concatenati) ----
    deck_js = (BASE / "assets" / "deck.js").read_text(encoding="utf-8").rstrip()
    visualizer_js = (BASE / "assets" / "visualizer.js").read_text(encoding="utf-8").rstrip()
    js_combined = deck_js + "\n\n" + visualizer_js
    js_indented = indent(js_combined, 4)

    # ---- CONTENT (5 file in ordine numerico) ----
    content_files = sorted((BASE / "content").glob("*.html"))
    if not content_files:
        raise RuntimeError("No content files found in content/")
    content_blocks = []
    for f in content_files:
        block = f.read_text(encoding="utf-8").rstrip()
        content_blocks.append(block)
    content_joined = "\n\n".join(content_blocks)
    # Content blocks gia' indentati a 6 spazi (figli di <main>); template ne aspetta 6 pure
    # Pero' il primo carattere di ciascun blocco ha gia' la sua indentazione.
    # Niente reindent: lascia come sta.

    # ---- Gift payload (CLAUDE-starter.md embedded come stringa JSON) ----
    gift_src = BASE / "CLAUDE-starter.md"
    if gift_src.exists():
        gift_md = gift_src.read_text(encoding="utf-8")
        gift_json = json.dumps(gift_md)
    else:
        gift_json = '""'

    # ---- Assemble ----
    out = (
        template
        .replace("{{CSS}}", css_indented)
        .replace("{{CONTENT}}", content_joined)
        .replace("{{JS}}", js_indented)
        .replace("{{GIFT_MD_JSON}}", gift_json)
    )

    dist_dir = BASE / "dist"
    dist_dir.mkdir(exist_ok=True)
    out_file = dist_dir / "index.html"
    out_file.write_text(out, encoding="utf-8")

    # Il regalo: CLAUDE-starter.md copiato in dist/CLAUDE.md per il download
    # diretto dalla slide finale del deck.
    gift_src = BASE / "CLAUDE-starter.md"
    gift_dst = dist_dir / "CLAUDE.md"
    if gift_src.exists():
        gift_dst.write_text(gift_src.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"  Gift:   {len(gift_src.read_text(encoding='utf-8')):>7} chars -> dist/CLAUDE.md")

    size_kb = len(out) / 1024
    print(f"Built: {out_file.relative_to(BASE.parent.parent)} ({size_kb:.1f} KB)")
    print(f"  CSS:    {len(css):>7} chars")
    print(f"  JS:     {len(js_combined):>7} chars")
    print(f"  Content:{len(content_joined):>7} chars ({len(content_files)} files)")


if __name__ == "__main__":
    main()
