#!/usr/bin/env python3
"""Fabrique Penthouse.dmg à partir de mac/Penthouse.app.

Sur un Mac : image disque native (hdiutil). Ailleurs (Linux, CI) : image ISO 9660 + Rock Ridge, que macOS ouvre aussi
en double-cliquant, avec les droits d'exécution conservés ; il faut alors le module pycdlib (pip install pycdlib).
Usage : python3 mac/build-dmg.py [sortie.dmg]
"""
import io
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE / "Penthouse.app"
ICNS = APP / "Contents/Resources/Penthouse.icns"
README = """Penthouse pour Mac
==================

1. Glisse Penthouse dans le dossier Applications (raccourci à côté).
2. Ouvre-le depuis Applications. La première fois, macOS peut le bloquer car l'app n'est pas signée par Apple :
   clic droit sur Penthouse > Ouvrir > Ouvrir, ou Réglages Système > Confidentialité et sécurité > « Ouvrir quand même ».
3. Colle la clé de ton étage (site du penthouse > Relier mes agents), coche les outils à lancer : c'est prêt.

À chaque ouverture de session, Penthouse lance tes outils (Claude, Claude Code, Codex, Cursor, Grok…) et relance le
suivi : tes agents apparaissent dans la tour dès qu'ils travaillent.
Pour changer les outils ou tout arrêter : rouvre Penthouse > Réglages.
"""


def make_icon():
    """Icône : une tour dorée sur fond nuit (générée, aucun fichier externe)."""
    if ICNS.exists():
        return
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(19):  # ciel en dégradé, découpé ensuite en carré arrondi
        y = 40 + i * 50
        d.rectangle((40, y, size - 40, y + 50), fill=(16 + i * 2, 18 + i * 2, 34 + i * 4, 255))
    gold = (232, 194, 122, 255)
    d.polygon([(372, 860), (372, 330), (512, 190), (652, 330), (652, 860)], fill=(30, 34, 52, 255), outline=gold)
    for row in range(8):
        for col in range(3):
            x, y = 410 + col * 80, 360 + row * 60
            on = (row * 3 + col) % 4 != 1
            d.rectangle((x, y, x + 44, y + 34), fill=(255, 214, 140, 255) if on else (52, 58, 84, 255))
    d.rectangle((300, 860, 724, 900), fill=gold)
    d.ellipse((482, 150, 542, 210), fill=(255, 111, 216, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((40, 40, size - 40, size - 40), radius=210, fill=255)
    img.putalpha(mask)

    def png(px):
        out = io.BytesIO()
        img.resize((px, px), Image.LANCZOS).save(out, "PNG")
        return out.getvalue()

    entries = b"".join(kind + struct.pack(">I", len(data) + 8) + data for kind, data in
                       [(b"ic10", png(1024)), (b"ic09", png(512)), (b"ic08", png(256)), (b"ic07", png(128))])
    ICNS.parent.mkdir(parents=True, exist_ok=True)
    ICNS.write_bytes(b"icns" + struct.pack(">I", len(entries) + 8) + entries)


def build_with_hdiutil(out):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "Penthouse"
        root.mkdir()
        shutil.copytree(APP, root / "Penthouse.app", symlinks=True)
        (root / "Applications").symlink_to("/Applications")
        (root / "Lisez-moi.txt").write_text(README)
        subprocess.run(["hdiutil", "create", "-volname", "Penthouse", "-srcfolder", str(root), "-ov", "-format", "UDZO", str(out)], check=True)


def build_with_pycdlib(out):
    import pycdlib
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=3, rock_ridge="1.09", joliet=3, vol_ident="PENTHOUSE")
    counter = [0]

    def iso_name(directory=False):
        counter[0] += 1
        return f"D{counter[0]}" if directory else f"F{counter[0]}.;1"

    def add_tree(src, iso_dir, joliet_dir):
        for entry in sorted(src.iterdir()):
            iso_path = f"{iso_dir.rstrip('/')}/{iso_name(entry.is_dir())}"
            joliet = f"{joliet_dir.rstrip('/')}/{entry.name}"
            if entry.is_dir():
                iso.add_directory(iso_path, rr_name=entry.name, joliet_path=joliet, file_mode=0o40755)
                add_tree(entry, iso_path, joliet)
            else:
                data = entry.read_bytes()
                mode = 0o100755 if os.access(entry, os.X_OK) else 0o100644
                iso.add_fp(io.BytesIO(data), len(data), iso_path, rr_name=entry.name, joliet_path=joliet, file_mode=mode)

    app_iso = "/" + iso_name(True)
    iso.add_directory(app_iso, rr_name="Penthouse.app", joliet_path="/Penthouse.app", file_mode=0o40755)
    add_tree(APP, app_iso, "/Penthouse.app")
    data = README.encode()
    iso.add_fp(io.BytesIO(data), len(data), "/" + iso_name(), rr_name="Lisez-moi.txt", joliet_path="/Lisez-moi.txt", file_mode=0o100644)
    iso.add_symlink("/" + iso_name(), rr_symlink_name="Applications", rr_path="/Applications")
    iso.write(str(out))
    iso.close()


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "Penthouse.dmg").resolve()
    os.chmod(APP / "Contents/MacOS/Penthouse", 0o755)
    make_icon()
    if shutil.which("hdiutil"):
        build_with_hdiutil(out)
    else:
        build_with_pycdlib(out)
    print(f"Image prête : {out} ({out.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    main()
