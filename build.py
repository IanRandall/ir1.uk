#!/usr/bin/env python3
"""Build Ian's site.
  ian-randall-preview.html  single self-contained file (works from file://, local scoreboard fallback)
  dist/                     deployable site: index.html (CSS+JS inlined) + api/scores.php (global scoreboard)
  ian-randall-site.zip      dist/ zipped, with README.txt
"""
import shutil, zipfile
from pathlib import Path
d = Path(__file__).parent
idx = (d / "index.html").read_text(); css = (d / "styles.css").read_text(); js = (d / "script.js").read_text()
link, tag = '<link rel="stylesheet" href="styles.css" />', '<script src="script.js"></script>'
assert link in idx and tag in idx
out = idx.replace(link, "<style>\n" + css + "\n</style>").replace(tag, "<script>\n" + js + "\n</script>")
(d / "ian-randall-preview.html").write_text(out)
print("wrote", d / "ian-randall-preview.html")

dist = d / "dist"
if dist.exists(): shutil.rmtree(dist)
(dist / "api" / "data").mkdir(parents=True)
(dist / "index.html").write_text(out)
shutil.copy(d / "server/api/scores.php", dist / "api/scores.php")
shutil.copy(d / "server/api/data/.htaccess", dist / "api/data/.htaccess")
shutil.copy(d / "server/api/data/index.html", dist / "api/data/index.html")
shutil.copy(d / "server/README.txt", dist / "README.txt")
print("wrote", dist)

z = d / "ian-randall-site.zip"
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
    for p in sorted(dist.rglob("*")):
        rel = p.relative_to(dist).as_posix()
        if p.is_dir():
            zi = zipfile.ZipInfo(rel + "/"); zi.external_attr = (0o40775 << 16) | 0x10; zf.writestr(zi, "")
        else:
            zi = zipfile.ZipInfo.from_file(p, rel); zi.external_attr = (0o100664 << 16); zi.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(zi, p.read_bytes())
print("wrote", z)
