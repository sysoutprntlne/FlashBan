"""Package the fork prototype without credentials, dependencies or raw recordings."""
from pathlib import Path
import hashlib
import zipfile

repo = Path(__file__).resolve().parents[2]
artifacts = repo / "prototype" / "artifacts"
archive = artifacts / "flashban-prototype.zip"
excluded = {"node_modules", "raw", ".git", ".board", "__pycache__"}
paths = [repo / "README.md"]
for folder in ["demo", "prototype"]:
    paths.extend(p for p in (repo / folder).rglob("*") if p.is_file())
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
    for p in sorted(paths):
        relative = p.relative_to(repo)
        if excluded.intersection(relative.parts) or p == archive:
            continue
        if p.name in {".DS_Store", "SHA256SUMS"} or p.suffix in {".aiff", ".wav"}:
            continue
        bundle.write(p, str(Path("FlashBan-prototype") / relative))
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert "FlashBan-prototype/prototype/extension/manifest.json" in bundle.namelist()
    assert "FlashBan-prototype/prototype/artifacts/flashban-walkthrough.mp4" in bundle.namelist()
lines = []
for p in [archive, artifacts / "flashban-walkthrough.mp4"]:
    lines.append(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}")
(artifacts / "SHA256SUMS").write_text("\n".join(lines) + "\n")
print(f"Verified {archive.name}: {archive.stat().st_size:,} bytes")
