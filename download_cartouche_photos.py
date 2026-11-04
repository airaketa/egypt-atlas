"""Download five credited Commons photographs (real images) for offline use."""
from pathlib import Path
import json,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parent
photos=json.loads((ROOT/'data/cartouche_photo_sources.json').read_text(encoding='utf-8'))
out=ROOT/'assets/cartouches';out.mkdir(parents=True,exist_ok=True)
for key,p in photos.items():
 path=out/(key+'.jpg')
 if path.exists() and path.stat().st_size>10000:
  print('SKIP',key);continue
 request=urllib.request.Request(p['thumb'],headers={'User-Agent':'EgyptAtlasEducationalGuide/0.20 (Wikimedia Commons photographs)'})
 try:
  with urllib.request.urlopen(request,timeout=35) as resp:
   body=resp.read()
   if not body.startswith(b'\xff\xd8') or len(body)<10000:raise ValueError('not a JPEG or too small')
  path.write_bytes(body)
  print('OK',key,len(body),'bytes')
 except Exception as exc:
  print('ERROR',key,type(exc).__name__,str(exc)[:200]);print('Source:',p['source'])
print('Images will now show offline when present. Attribution is inside the app.')
