# gen-maps.py — visuel relance : carte Mapbox de la ville du prospect + VRAIS assets MY SEETY
# (smartphones image53 = apps, devanture image39 = vitrine/affichage). -> maps/<md5>.jpg + maps-index.json
# Les images sont EMBARQUEES dans le mail (cid inline) — jamais hebergees publiquement.
import os, io, json, hashlib, urllib.request, urllib.parse
from PIL import Image, ImageDraw, ImageFont, ImageOps

TOKEN = os.environ['MAPBOX_TOKEN']
BASE = r'C:\Users\mysee\Desktop\inbox-ionos'
MEDIA = BASE + r'\widely-media'
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

def paste_rounded(canvas, im, box, radius=8):
    x, y, w, h = box
    im = ImageOps.fit(im.convert('RGB'), (w, h), method=Image.LANCZOS)
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w, h], radius, fill=255)
    canvas.paste(im, (x, y), m)

PHONES = Image.open(MEDIA + r'\image53.png').convert('RGB')
PHONES = PHONES.crop((0, 0, PHONES.width, int(PHONES.height * 0.82)))
VITRINE = Image.open(MEDIA + r'\image39.png').convert('RGB')

def make(venue, city, lon, lat, out):
    W, H = 680, 466
    img = Image.new('RGB', (W, H), WHITE)
    d = ImageDraw.Draw(img, 'RGBA')
    mw, mh = 648, 196
    url = f"https://api.mapbox.com/styles/v1/mapbox/light-v11/static/{lon},{lat},11.2/{mw}x{mh}@2x?access_token={TOKEN}&logo=false"
    mapimg = Image.open(io.BytesIO(get(url))).convert('RGB').resize((mw, mh))
    mm = Image.new('L', (mw, mh), 0); ImageDraw.Draw(mm).rounded_rectangle([0, 0, mw, mh], 14, fill=255)
    img.paste(mapimg, (16, 14), mm)
    cx, cy = 16 + mw * 0.5, 14 + mh * 0.5
    for r, a in [(82, 36), (60, 60), (40, 95), (22, 150)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(200, 65, 44, a))
    px, py = int(cx), int(cy - 4)
    d.ellipse([px - 13, py - 13, px + 13, py + 13], fill=TEAL)
    d.polygon([(px - 10, py + 7), (px + 10, py + 7), (px, py + 24)], fill=TEAL)
    d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=WHITE)
    d.rounded_rectangle([28, 22, 28 + d.textlength('VOTRE PUBLIC ICI', font=font(12, True)) + 14, 46], radius=7, fill=(255, 255, 255, 225))
    d.text((35, 25), "VOTRE PUBLIC ICI", font=font(12, True), fill=RED)
    lbl = f"{venue}  ·  {city}"; lw = d.textlength(lbl, font=font(15, True))
    d.rounded_rectangle([28, 14 + mh - 40, 28 + lw + 26, 14 + mh - 12], radius=13, fill=TEAL)
    d.text((41, 14 + mh - 35), lbl, font=font(15, True), fill=WHITE)
    ty = 224
    t1 = "Votre public, "
    d.text((16, ty), t1, font=font(22, True), fill=TEAL)
    d.text((16 + d.textlength(t1, font=font(22, True)), ty), "cartographié.", font=font(22, True), fill=RED)
    d.text((16, ty + 30), "On le touche partout où il est :", font=font(13), fill=GREY)
    cy0 = 288; cH = 132; cW = 316
    d.rounded_rectangle([16, cy0, 16 + cW, cy0 + cH], radius=12, fill=LIGHT)
    d.ellipse([28, cy0 + 13, 42, cy0 + 27], fill=RED)
    d.text((50, cy0 + 12), "Sur les apps", font=font(14, True), fill=TEAL)
    d.text((50, cy0 + 30), "+ de 360 apps", font=font(10), fill=GREY)
    paste_rounded(img, PHONES, (28, cy0 + 50, cW - 24, cH - 60))
    x2 = 348
    d.rounded_rectangle([x2, cy0, x2 + cW, cy0 + cH], radius=12, fill=LIGHT)
    d.ellipse([x2 + 12, cy0 + 13, x2 + 26, cy0 + 27], fill=RED)
    d.text((x2 + 34, cy0 + 12), "En vitrine & affichage", font=font(14, True), fill=TEAL)
    d.text((x2 + 34, cy0 + 30), "au plus près de votre public", font=font(10), fill=GREY)
    paste_rounded(img, VITRINE, (x2 + 12, cy0 + 50, cW - 24, cH - 60))
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
