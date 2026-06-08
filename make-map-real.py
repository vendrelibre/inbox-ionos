# make-map-real.py — visuel "carte d'audience" MY SEETY avec VRAIE carte Mapbox.
# Usage : MAP_QUERY="Theatre 13, Paris" MAP_VENUE="Theatre 13" MAP_CITY="Paris" python make-map-real.py
import os, io, json, urllib.request, urllib.parse
from PIL import Image, ImageDraw, ImageFont

TOKEN = os.environ.get('MAPBOX_TOKEN')
CITY = os.environ.get('MAP_CITY', 'Paris')
VENUE = os.environ.get('MAP_VENUE', 'Theatre 13')
QUERY = os.environ.get('MAP_QUERY', f"{VENUE}, {CITY}")
OUT = os.environ.get('MAP_OUT', r'C:\Users\mysee\Desktop\inbox-ionos\audience-map-real.png')
if not TOKEN:
    raise SystemExit('MAPBOX_TOKEN manquant')

def get(url):
    return urllib.request.urlopen(url, timeout=30).read()

# 1) geocodage
gq = urllib.parse.quote(QUERY)
geo = json.loads(get(f"https://api.mapbox.com/geocoding/v5/mapbox.places/{gq}.json?access_token={TOKEN}&limit=1&language=fr"))
lon, lat = geo['features'][0]['center']
print('geocode', QUERY, '->', lon, lat)

# 2) carte statique (style clair)
mw, mh = 360, 230
zoom = 12.3
url = (f"https://api.mapbox.com/styles/v1/mapbox/light-v11/static/"
       f"{lon},{lat},{zoom}/{mw}x{mh}@2x?access_token={TOKEN}&logo=false")
mapimg = Image.open(io.BytesIO(get(url))).convert('RGB').resize((mw, mh))

# 3) composition MY SEETY
W, H = 680, 300
RED = (200, 65, 44); TEAL = (28, 74, 86); GREY = (120, 135, 140); WHITE = (255, 255, 255)

def font(sz, bold=False):
    try:
        return ImageFont.truetype(r'C:\Windows\Fonts\arialbd.ttf' if bold else r'C:\Windows\Fonts\arial.ttf', sz)
    except Exception:
        return ImageFont.load_default()

img = Image.new('RGB', (W, H), WHITE)
mask = Image.new('L', (mw, mh), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, mw, mh], 14, fill=255)
img.paste(mapimg, (16, 16), mask)
d = ImageDraw.Draw(img, 'RGBA')

cx, cy = 16 + mw * 0.5, 16 + mh * 0.46
for r, a in [(85, 38), (62, 62), (40, 95), (22, 150)]:
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(200, 65, 44, a))
px, py = int(cx), int(cy - 4)
d.ellipse([px - 13, py - 13, px + 13, py + 13], fill=TEAL)
d.polygon([(px - 10, py + 7), (px + 10, py + 7), (px, py + 24)], fill=TEAL)
d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=WHITE)
d.rounded_rectangle([28, 24, 28 + d.textlength('VOTRE PUBLIC ICI', font=font(12, True)) + 14, 48], radius=7, fill=(255, 255, 255, 220))
d.text((35, 27), "VOTRE PUBLIC ICI", font=font(12, True), fill=RED)
lbl = f"{VENUE}  ·  {CITY}"
lw = d.textlength(lbl, font=font(15, True))
d.rounded_rectangle([28, 16 + mh - 42, 28 + lw + 26, 16 + mh - 12], radius=13, fill=TEAL)
d.text((41, 16 + mh - 37), lbl, font=font(15, True), fill=WHITE)

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

d.rectangle([0, H - 46, W, H], fill=TEAL)
d.text((20, H - 33), "On cartographie votre public — et on le touche partout où il est.", font=font(15, True), fill=WHITE)
try:
    logo = Image.open(r'C:\Users\mysee\Desktop\inbox-ionos\logo-sig.jpg').convert('RGB')
    logo.thumbnail((104, 104))
    img.paste(logo, (W - logo.width - 16, H - 46 + (46 - logo.height) // 2))
except Exception:
    pass

img.save(OUT, quality=90)
print('OK', OUT, img.size)
