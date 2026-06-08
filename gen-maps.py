# gen-maps.py — visuel relance : carte Mapbox de la ville du prospect + mockups dessines (app + vitrine).
# -> maps/<md5>.jpg + maps-index.json. (Aucune image extraite d'un deck : 100% genere, publiable.)
import os, io, json, hashlib, urllib.request, urllib.parse
from PIL import Image, ImageDraw, ImageFont

TOKEN = os.environ['MAPBOX_TOKEN']
BASE = r'C:\Users\mysee\Desktop\inbox-ionos'
RED = (200, 65, 44); TEAL = (28, 74, 86); GREY = (120, 135, 140); WHITE = (255, 255, 255); LIGHT = (237, 241, 242)

def font(sz, bold=False):
    try:
        return ImageFont.truetype(r'C:\Windows\Fonts\arialbd.ttf' if bold else r'C:\Windows\Fonts\arial.ttf', sz)
    except Exception:
        return ImageFont.load_default()

def get(url):
    return urllib.request.urlopen(url, timeout=30).read()

def geocode(query):
    gq = urllib.parse.quote(query)
    geo = json.loads(get(f"https://api.mapbox.com/geocoding/v5/mapbox.places/{gq}.json?access_token={TOKEN}&limit=1&language=fr&country=fr"))
    f = geo['features'][0]; lon, lat = f['center']; city = ''
    for c in f.get('context', []):
        if str(c.get('id', '')).startswith('place'):
            city = c.get('text', ''); break
    if not city:
        city = f.get('text', '')
    return lon, lat, city

def phone(d, x, y):
    w, h = 56, 104
    d.rounded_rectangle([x, y, x + w, y + h], radius=11, fill=TEAL)
    d.rounded_rectangle([x + 5, y + 11, x + w - 5, y + h - 9], radius=4, fill=WHITE)
    d.rectangle([x + 9, y + 16, x + w - 9, y + 42], fill=RED)
    d.polygon([(x + 22, y + 24), (x + 22, y + 34), (x + 32, y + 29)], fill=WHITE)
    for i in range(3):
        yy = y + 50 + i * 9
        d.rounded_rectangle([x + 9, yy, x + w - 9, yy + 5], radius=2, fill=(214, 220, 222))
    d.rounded_rectangle([x + w // 2 - 9, y + h - 6, x + w // 2 + 9, y + h - 4], radius=1, fill=(180, 190, 192))

def shop(d, x, y):
    w, h = 168, 108
    d.rectangle([x, y + 26, x + w, y + h], fill=(246, 248, 249))
    sw = 21
    for i in range(0, w, sw):
        d.rectangle([x + i, y, x + min(i + sw, w), y + 26], fill=(RED if (i // sw) % 2 == 0 else WHITE))
    d.rectangle([x, y, x + w, y + 26], outline=TEAL, width=2)
    wx0, wy0, wx1, wy1 = x + 10, y + 36, x + w - 54, y + h - 8
    d.rectangle([wx0, wy0, wx1, wy1], fill=(224, 235, 240))
    d.rectangle([wx0, wy0, wx1, wy1], outline=TEAL, width=3)
    d.rectangle([wx0 + 9, wy0 + 8, wx1 - 9, wy1 - 8], fill=RED)
    d.ellipse([wx0 + 16, wy0 + 14, wx0 + 30, wy0 + 28], fill=WHITE)
    dx0 = x + w - 46
    d.rectangle([dx0, y + 34, x + w - 12, y + h - 8], fill=(214, 221, 224), outline=TEAL, width=2)
    d.ellipse([x + w - 20, y + 70, x + w - 16, y + 74], fill=TEAL)

def make(venue, city, lon, lat, out):
    W, H = 680, 300
    img = Image.new('RGB', (W, H), WHITE); d = ImageDraw.Draw(img, 'RGBA')
    mw, mh = 360, 230
    url = f"https://api.mapbox.com/styles/v1/mapbox/light-v11/static/{lon},{lat},11.4/{mw}x{mh}@2x?access_token={TOKEN}&logo=false"
    mapimg = Image.open(io.BytesIO(get(url))).convert('RGB').resize((mw, mh))
    mm = Image.new('L', (mw, mh), 0); ImageDraw.Draw(mm).rounded_rectangle([0, 0, mw, mh], 14, fill=255)
    img.paste(mapimg, (16, 16), mm)
    cx, cy = 16 + mw * 0.5, 16 + mh * 0.46
    for r, a in [(85, 38), (62, 62), (40, 95), (22, 150)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(200, 65, 44, a))
    px, py = int(cx), int(cy - 4)
    d.ellipse([px - 13, py - 13, px + 13, py + 13], fill=TEAL)
    d.polygon([(px - 10, py + 7), (px + 10, py + 7), (px, py + 24)], fill=TEAL)
    d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=WHITE)
    d.rounded_rectangle([28, 24, 28 + d.textlength('VOTRE PUBLIC ICI', font=font(12, True)) + 14, 48], radius=7, fill=(255, 255, 255, 225))
    d.text((35, 27), "VOTRE PUBLIC ICI", font=font(12, True), fill=RED)
    lbl = f"{venue}  ·  {city}"; lw = d.textlength(lbl, font=font(15, True))
    d.rounded_rectangle([28, 16 + mh - 40, 28 + lw + 26, 16 + mh - 12], radius=13, fill=TEAL)
    d.text((41, 16 + mh - 35), lbl, font=font(15, True), fill=WHITE)
    rx = 404
    d.text((rx, 30), "Votre public,", font=font(25, True), fill=TEAL)
    d.text((rx, 60), "cartographié.", font=font(25, True), fill=RED)
    d.text((rx, 92), "On le touche partout où il est :", font=font(12, True), fill=GREY)
    phone(d, rx, 108); shop(d, rx + 72, 108)
    d.text((rx + 2, 222), "Sur les apps", font=font(12, True), fill=TEAL)
    d.text((rx + 6, 237), "(+ de 360 apps)", font=font(10), fill=GREY)
    d.text((rx + 74, 222), "En vitrine & affichage", font=font(12, True), fill=TEAL)
    d.rectangle([0, H - 38, W, H], fill=TEAL)
    d.text((18, H - 28), "On cartographie votre public — et on le touche partout où il est.", font=font(14, True), fill=WHITE)
    try:
        logo = Image.open(BASE + r'\logo-sig.jpg').convert('RGB'); logo.thumbnail((92, 92))
        img.paste(logo, (W - logo.width - 14, H - 38 + (38 - logo.height) // 2))
    except Exception:
        pass
    img.save(out, quality=86, optimize=True)

venues = json.load(open(BASE + r'\venues.json', encoding='utf-8'))
os.makedirs(BASE + r'\maps', exist_ok=True)
index = {}
for v in venues:
    slug = hashlib.md5(v['email'].encode()).hexdigest()[:12]
    try:
        lon, lat, gcity = geocode(v['query']); city = v.get('city') or gcity
        make(v['venue'], city, lon, lat, BASE + rf'\maps\{slug}.jpg')
        index[v['email']] = slug
        print(f'OK   {v["venue"][:26]:26} -> {city}')
    except Exception as ex:
        print('FAIL', v['venue'], repr(ex))
json.dump(index, open(BASE + r'\maps-index.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('TOTAL', len(index), 'cartes')
