// Logo concept for an idea card: an image model (Pollinations, free, no key) with a generated
// gradient-monogram fallback, uploaded to Linear's asset store and embedded in the description.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './sh.mjs';
import { gql } from './linear.mjs';

export async function generateLogo({ prompt, colors, name, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'logo.png');
  const full = `${prompt}, flat vector app icon, centered single symbol, rounded square, smooth gradient background, no text, no letters, no watermark, high contrast, 512x512`;
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?width=512&height=512&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 5000) {
        writeFileSync(join(outDir, 'logo.raw'), buf);
        const r = await run('python3', ['-I', '-c', PY_ROUND, join(outDir, 'logo.raw'), file], { timeoutMs: 60_000 });
        if (r.code === 0) return { file, how: 'pollinations' };
      }
    }
  } catch { /* fall back */ }
  const [c1, c2] = String(colors || '#0f766e #22d3ee').split(/\s+/);
  const r = await run('python3', ['-I', '-c', PY_MONOGRAM, file, name, c1 || '#0f766e', c2 || '#22d3ee'], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`logo fallback failed: ${r.err.slice(-300)}`);
  return { file, how: 'monogram' };
}

/** Upload a local file to Linear; returns the asset URL usable in markdown. */
export async function uploadToLinear(file, { contentType = 'image/png', filename = 'logo.png' } = {}) {
  const buf = readFileSync(file);
  const d = await gql('mutation($ct:String!,$fn:String!,$size:Int!){ fileUpload(contentType:$ct, filename:$fn, size:$size, makePublic:false){ success uploadFile{ uploadUrl assetUrl headers{ key value } } } }',
    { ct: contentType, fn: filename, size: buf.length });
  const u = d.fileUpload.uploadFile;
  const headers = { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000' };
  for (const h of u.headers) headers[h.key] = h.value;
  const res = await fetch(u.uploadUrl, { method: 'PUT', headers, body: buf, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Linear upload HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return u.assetUrl;
}

const PY_ROUND = `
import sys
from PIL import Image, ImageDraw
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA').resize((584, 584)).crop((36, 36, 548, 548))  # crop the provider watermark corner
mask = Image.new('L', (512, 512), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, 511, 511), radius=110, fill=255)
out = Image.new('RGBA', (512, 512), (0, 0, 0, 0)); out.paste(im, (0, 0), mask); out.save(dst, 'PNG')
`;
const PY_MONOGRAM = `
import sys
from PIL import Image, ImageDraw, ImageFont
dst, name, c1, c2 = sys.argv[1:5]
h = lambda c: tuple(int(c.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
a, b = h(c1), h(c2)
im = Image.new('RGBA', (512, 512))
px = im.load()
for y in range(512):
    for x in range(512):
        t = (x + y) / 1022
        px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
mask = Image.new('L', (512, 512), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, 511, 511), radius=110, fill=255)
out = Image.new('RGBA', (512, 512), (0, 0, 0, 0)); out.paste(im, (0, 0), mask)
d = ImageDraw.Draw(out)
initials = ''.join(w[0] for w in name.split()[:2]).upper() or 'A'
font = None
for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
    try: font = ImageFont.truetype(f, 230 if len(initials) == 1 else 180); break
    except Exception: pass
font = font or ImageFont.load_default()
bb = d.textbbox((0, 0), initials, font=font)
d.text(((512 - bb[2] + bb[0]) / 2 - bb[0], (512 - bb[3] + bb[1]) / 2 - bb[1]), initials, font=font, fill=(255, 255, 255, 235))
out.save(dst, 'PNG')
`;
