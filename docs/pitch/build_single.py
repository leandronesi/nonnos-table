#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Assembla il deck multi-file (index + 01 + 02 + 03 + assets/pitch.css|js) in UN
unico HTML self-contained, mobile-compliant, da condividere: il-tavolo-del-nonno.html

Scroll singolo, nav ad ancore, i tre racconti come capitoli. Niente asset esterni
(CSS/JS inline). Rigenerabile: modifica i sorgenti e rilancia `python build_single.py`.
"""
import re, pathlib

HERE = pathlib.Path(__file__).parent
OUT  = HERE / "il-tavolo-del-nonno.html"

def read(p): return (HERE / p).read_text(encoding="utf-8")

def inner(tag, html):
    m = re.search(r"<%s\b[^>]*>(.*?)</%s>" % (tag, tag), html, re.S)
    return m.group(1).strip() if m else ""

css      = read("assets/pitch.css")
idx      = read("index.html")
anima    = inner("main", read("01-anima.html"))
moneta   = inner("main", read("02-moneta.html"))
prova    = inner("main", read("03-prova.html"))

# stili specifici di ciascun file (vanno fusi nello <style> unico)
styles = "\n".join(inner("style", read(f)) for f in
                   ["index.html", "01-anima.html", "02-moneta.html", "03-prova.html"])

# La copertina: dalle 4 band di index tengo cover (0) + ribaltamento (1),
# scarto la TOC "tre racconti" (2) che in single-page non ha senso,
# e sposto la chiusura (3) in fondo.
idx_main = inner("main", idx)
idx_secs = re.findall(r"<section\b.*?</section>", idx_main, re.S)
assert len(idx_secs) >= 4, f"attese >=4 section in index, trovate {len(idx_secs)}"
cover_top = idx_secs[0] + "\n" + idx_secs[1]
chiusura  = idx_secs[3]

NAV = """<nav class="topnav"><div class="inner">
  <a class="brand" href="#top">il Tavolo del <span class="o">Nonno</span></a>
  <div class="links">
    <a href="#top">Copertina</a>
    <a href="#anima">L'Anima</a>
    <a href="#moneta">La Moneta</a>
    <a href="#prova">La Prova</a>
  </div>
</div></nav>"""

FOOTER = """<footer class="wrap">
  <div class="pager">
    <span class="faint" style="font-size:0.85rem;">il Tavolo del Nonno &middot; pitch di prodotto</span>
    <a class="next" href="#top"><span class="lbl">Torna su &uarr;</span><span class="t mono">Copertina</span></a>
  </div>
</footer>"""

EXTRA_CSS = """
/* ---- single-file ---- */
#top { scroll-margin-top: 0; }
.chapter { display: block; }
"""

SCRIPT = """(function(){
  var els=document.querySelectorAll('.reveal');
  if('IntersectionObserver' in window && els.length){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:0.12,rootMargin:'0px 0px -8% 0px'});
    els.forEach(function(el){io.observe(el);});
  } else { els.forEach(function(el){el.classList.add('in');}); }
  var links={};
  document.querySelectorAll('.topnav .links a').forEach(function(a){var h=a.getAttribute('href');if(h&&h.charAt(0)==='#')links[h.slice(1)]=a;});
  var secs=['top','anima','moneta','prova'].map(function(id){return document.getElementById(id);}).filter(Boolean);
  if('IntersectionObserver' in window && secs.length){
    var spy=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var id=e.target.id;Object.keys(links).forEach(function(k){links[k].classList.toggle('active',k===id);});}});},{rootMargin:'-45% 0px -50% 0px'});
    secs.forEach(function(s){spy.observe(s);});
  }
})();"""

html = """<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>il Tavolo del Nonno &middot; Pitch di prodotto</title>
<style>
%s

/* ===== stili dei capitoli (fusi) ===== */
%s
%s
</style>
</head>
<body>

%s

<main>
  <div id="top">
%s
  </div>

  <div id="anima" class="chapter">
%s
  </div>

  <div id="moneta" class="chapter">
%s
  </div>

  <div id="prova" class="chapter">
%s
  </div>

%s
</main>

%s

<script>
%s
</script>
</body>
</html>
""" % (css, styles, EXTRA_CSS, NAV, cover_top, anima, moneta, prova, chiusura, FOOTER, SCRIPT)

# link file -> ancore (single page)
for old, new in [("index.html", "#top"), ("01-anima.html", "#anima"),
                 ("02-moneta.html", "#moneta"), ("03-prova.html", "#prova")]:
    html = html.replace('href="%s"' % old, 'href="%s"' % new)

OUT.write_text(html, encoding="utf-8")
print("scritto:", OUT.name)
print("bytes:", len(html))
print("sezioni:", html.count("<section"))
print("svg:", html.count("<svg"))
print("href file residui:", len(re.findall(r'href="[^"#][^"]*\.html"', html)))
