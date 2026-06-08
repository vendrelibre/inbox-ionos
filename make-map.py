# make-map.py — visuel "carte d'audience" stylise MY SEETY (sans API).
# Usage : MAP_CITY="Paris" MAP_VENUE="Theatre 13" python make-map.py
from PIL import Image, ImageDraw, ImageFont
import os

CITY = os.environ.get('MAP_CITY', 'Paris')
VENUE = os.environ.get('MAP_VENUE', 'Theatre 13')
OUT = os.environ.get('MAP_OUT', r'C:\Users\mysee\Desktop\inbox-ionos\audience-map.png')

W, H = 680, 300
RED = (200, 65, 44); TEAL = (28, 74, 86); GREY = (120, 135, 140); LIGHT = (236, 240, 241); WHITE = (255, 255, 255)

def font(sz, bold=False):
    for p in ([r'C:\Windows\Fonts\arialbd.ttf'] if bold else [r'C:\Windows\Fonts\arial.ttf']):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()

img = Image.new('RGB', (W, H), WHITE)
d = ImageDraw.Draw(img, 'RGBA')

# ---- carte (gauche) ----
mx, my, mw, mh = 16, 16, 360, 230
d.rounded_rectangle([mx, my, mx + mw, my + mh], radius=14, fill=LIGHT)
for i in range(7):
    y = my + 26 + i * 30
    d.line([mx + 10, y, mx + mw - 10, y], fill=WHITE, width=6)
for i in range(9):
    x = mx + 26 + i * 40
    d.line([x, my + 10, x, my + mh - 10], fill=WHITE, width=6)
cx, cy = mx + mw * 0.56, my + mh * 0.46
for r, a in [(92, 45), (68, 70), (44, 100), (24, 150)]:
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(200, 65, 44, a))
px, py = int(cx), int(cy - 4)
d.ellipse([px - 13, py - 13, px + 13, py + 13], fill=TEAL)
d.polygon([(px - 10, py + 7), (px + 10, py + 7), (px, py + 24)], fill=TEAL)
d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=WHITE)
lbl = f"{VENUE}  ·  {CITY}"
lw = d.textlength(lbl, font=font(15, True))
d.rounded_rectangle([mx + 14, my + mh - 42, mx + 14 + lw + 26, my + mh - 12], radius=13, fill=TEAL)
d.text((mx + 27, my + mh - 37), lbl, font=font(15, True), fill=WHITE)
d.text((mx + 12, my + 8), "VOTRE PUBLIC ICI", font=font(12, True), fill=RED)

# ---- colonne droite ----
rx = 404
d.text((rx, 30), "Votre public,", font=font(25, True), fill=TEAL)
d.text((rx, 60), "cartographié.", font=font(25, True), fill=RED)

def chip(y, label):
    d.rounded_rectangle([rx, y, rx + 248, y + 34], radius=17, outline=TEAL, width=2, fill=WHITE)
    d.ellipse([rx + 9, y + 9, rx + 25, y + 25], fill=RED)
    d.text((rx + 38, y + 9), label, font=font(13, True), fill=TEAL)

chip(110, "Pub ciblée sur + de 360 apps")
chip(152, "Affichage urbain géolocalisé")
d.text((rx, 198), "Data  →  ciblage  →  public dans la salle", font=font(12), fill=GREY)

# ---- bandeau bas ----
d.rectangle([0, H - 46, W, H], fill=TEAL)
d.text((20, H - 33), "On cartographie votre public — et on le touche partout où il est.",
       font=font(15, True), fill=WHITE)
try:
    logo = Image.open(r'C:\Users\mysee\Desktop\inbox-ionos\logo-sig.jpg').convert('RGB')
    logo.thumbnail((104, 104))
    img.paste(logo, (W - logo.width - 16, H - 46 + (46 - logo.height) // 2))
except Exception:
    pass

img.save(OUT, quality=90)
print("OK", OUT, img.size)
