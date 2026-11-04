#!/usr/bin/env python3
# Fetch candidate Commons thumbnails into local photos/real, without guessing licenses.
# Uses standard Python. Requires internet. Generated images require license approval before distribution.
import json,csv,time,urllib.request,urllib.error,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parent
src=(ROOT/'catalog.js').read_text(encoding='utf-8');a=json.loads(src[src.index('['):src.rfind(']')+1]);out=ROOT/'photos'/'real';out.mkdir(parents=True,exist_ok=True)
rows=[]
for t in a:
 for s in t['stops']+t.get('extension',{}).get('stops',[]):
  url=s.get('photo','')
  if not url.startswith('https://') :continue
  cached=next((f for f in (out/(s['id']+ext) for ext in ('.jpg','.png','.webp')) if f.exists() and f.stat().st_size>2500),None)
  dest=cached or (out/(s['id']+'.jpg'))
  if cached:status='cached'
  else:
   try:
    req=urllib.request.Request(url,headers={'User-Agent':'EgyptAtlasDraft/0.16 (manual media audit; noncommercial test)', 'Accept':'image/jpeg,image/png,image/webp,image/*'})
    with urllib.request.urlopen(req,timeout=25) as r:
     mime=r.headers.get('Content-Type','')
     if not mime.startswith('image/'):raise ValueError('not an image: '+mime)
     content=r.read(8*1024*1024+1)
     if not 2500<len(content)<8*1024*1024:raise ValueError('image size unexpected')
     ext={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}.get(mime.split(';')[0].strip(),'.jpg')
     dest=out/(s['id']+ext)
     dest.write_bytes(content)
    status='downloaded'
   except Exception as e:status='FAILED '+str(e)[:200]
   time.sleep(.35)
  print(s['id'],status)
  rows.append([s['id'],s.get('photoSource',''),str(dest.relative_to(ROOT)),status])
with (ROOT/'data'/'photo_download_results.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(['ID','Commons','Local path','Result']);w.writerows(rows)
print('Completed:',sum(r[-1] in ('downloaded','cached') for r in rows),'/',len(rows))
print('IMPORTANT: these are candidate assets; verify author/license before shipping offline.')
