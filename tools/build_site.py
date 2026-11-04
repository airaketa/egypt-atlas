#!/usr/bin/env python3
"""Build static GitHub Pages site from code + separately uploaded media ZIP."""
import argparse,hashlib,json,shutil,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
IMAGE_EXT=('.jpg','.jpeg','.png','.webp')
BASENAME='window.EgyptAtlasCatalog = '

def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for part in iter(lambda:f.read(2**20),b''):h.update(part)
 return h.hexdigest()

def read_catalog(path):
 raw=path.read_text(encoding='utf-8')
 assert raw.startswith(BASENAME)
 return json.loads(raw[len(BASENAME):].strip().removesuffix(';'))

def collect(tours):return [s for t in tours for s in t['stops']+t.get('extension',{}).get('stops',[])]

def safe_extract(media,out):
 with zipfile.ZipFile(media) as z:
  names=z.namelist()
  if len(names)!=len(set(names)):raise ValueError('Duplicate entries in media ZIP')
  if 'media-package.json' not in names:raise ValueError('Use tools/pack_media.py for the release ZIP')
  index=json.loads(z.read('media-package.json'))
  if index.get('format')!=2 or not isinstance(index.get('texts_sha256'),dict):
   raise ValueError('Outdated media ZIP: rerun tools/pack_media.py to bind recordings to script versions')
  track_texts={t['id']:(ROOT/'texts'/f"{t['id']}.txt").read_text(encoding='utf-8').strip() for t in json.loads((ROOT/'data/track_list.json').read_text(encoding='utf-8'))}
  for track_id,body in track_texts.items():
   if index['texts_sha256'].get(track_id)!=hashlib.sha256(body.encode('utf-8')).hexdigest():
    raise ValueError('Media ZIP was generated with a different script: '+track_id)
  entries={x['path']:x for x in index['files']}
  if set(names)!=(set(entries)|{'media-package.json'}):raise ValueError('Unexpected archive members')
  for entry in index['files']:
   rel=Path(entry['path'])
   allowed=(len(rel.parts)==2 and rel.parts[0]=='audio' and rel.suffix.lower()=='.mp3') or (len(rel.parts)==3 and rel.parts[:2]==('photos','real') and rel.suffix.lower() in IMAGE_EXT) or (len(rel.parts)==3 and rel.parts[:2]==('assets','cartouches') and rel.suffix.lower()=='.jpg') or (len(rel.parts)==3 and rel.parts[:2]==('maps','offline') and rel.suffix.lower()=='.pmtiles')
   if rel.is_absolute() or '..' in rel.parts or not allowed:
    raise ValueError('Unsafe archive entry: '+entry['path'])
   dest=out/rel;dest.parent.mkdir(parents=True,exist_ok=True)
   with z.open(entry['path']) as source, dest.open('wb') as target:shutil.copyfileobj(source,target)
   if dest.stat().st_size!=entry['bytes'] or sha(dest)!=entry['sha256']:
    raise ValueError('Integrity check failed: '+entry['path'])

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--media',type=Path,help='egypt-media.zip from the media-v1 Release')
 parser.add_argument('--out',type=Path,default=ROOT/'_site')
 parser.add_argument('--require-audio',action='store_true')
 parser.add_argument('--require-complete',action='store_true',help='require all audio, photos, cartouche images and PMTiles')
 args=parser.parse_args();dest=args.out.resolve();
 if dest==ROOT:raise SystemExit('Output must differ from source directory')
 if dest.exists():shutil.rmtree(dest)
 dest.mkdir(parents=True)
 # Only files actually used by the browser go into the deployable site.
 for filename in ('index.html','styles.css','app.js','catalog.js','audio-ready.js','voice-catalog.js',
     'sw.js','manifest.webmanifest','map-logic.js','nearby.js','cartouche-integrated-data.js',
     'cartouche-inline-ui.js','listen.html','voice_status.js','photo-sources.html'):
  src=ROOT/filename
  if src.exists():shutil.copy2(src,dest/filename)
 for folder in ('assets','photos','maps','icons','vendor'):
  src=ROOT/folder
  if src.exists():
   shutil.copytree(src,dest/folder,ignore=shutil.ignore_patterns('real','offline','cartouches'))
 for runtime in ('vendor/maplibre-gl.js','vendor/maplibre-gl.css','vendor/pmtiles.js'):
  if not (dest/runtime).is_file():raise FileNotFoundError('Missing offline map runtime: '+runtime)
 if args.media:
  if not args.media.is_file():raise FileNotFoundError(args.media)
  safe_extract(args.media,dest)
 (dest/'.nojekyll').write_text('',encoding='utf-8')
 tours=read_catalog(dest/'catalog.js');stops=collect(tours);ids={s['id'] for s in stops}
 if len(stops)!=len(ids) or len(ids)!=82:raise ValueError('Expected 82 unique stops')
 files=[]
 def record(path):
  file=dest/path
  files.append({'path':'./'+path,'bytes':file.stat().st_size,'sha256':sha(file)})
 missingAudio=[];missingPhotos=[];missingCartouches=[];missingMaps=[];offlineMaps=[]
 audio_ready=[]
 for stop in stops:
  tid=stop['id'];mp3=f'audio/{tid}.mp3'
  if (dest/mp3).is_file() and (dest/mp3).stat().st_size>2500:
   record(mp3);audio_ready.append(tid)
  else:missingAudio.append(tid)
  photo=next((f'photos/real/{tid}{ext}' for ext in IMAGE_EXT if (dest/'photos/real'/f'{tid}{ext}').is_file()),None)
  if photo and (dest/photo).stat().st_size>2500:
   stop['photo']='./'+photo
   stop['photoPlaceholder']=False
   record(photo)
  else:
   # Never advertise remote images as fully offline.
   stop['photo']='./photos/visual-fallback.svg';stop['photoPlaceholder']=True
   missingPhotos.append(tid)
 # Offline cartouche explanations work even when photographs are absent, but avoid missing files.
 cart=json.loads((dest/'cartouche-integrated-data.js').read_text(encoding='utf-8').removeprefix('window.EgyptAtlasCartouchesInline = ').strip().removesuffix(';'))
 for key in cart['photos']:
  path=f'assets/cartouches/{key}.jpg'
  if (dest/path).is_file() and (dest/path).stat().st_size>2500:record(path)
  else:missingCartouches.append(key)
 for tour in tours:
  path=f'maps/offline/{tour["id"]}.pmtiles'
  file=dest/path
  if file.is_file() and file.stat().st_size>=127 and file.read_bytes()[:7]==b'PMTiles':
   record(path)
   offlineMaps.append({'id':tour['id'],'path':'./'+path,'bytes':file.stat().st_size,'sha256':sha(file)})
  else:missingMaps.append(tour['id'])
 # Deduplicate manifest resource entries and sort for stable builds.
 files=sorted({x['path']:x for x in files}.values(),key=lambda x:x['path'])
 (dest/'catalog.js').write_text(BASENAME+json.dumps(tours,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
 (dest/'audio-ready.js').write_text('window.EgyptAtlasAudioReady = '+json.dumps({'voice':'ru-RU-SvetlanaNeural','ids':audio_ready},ensure_ascii=False)+';\n',encoding='utf-8')
 manifest={'version':1,'files':files,'expectedAudio':82,'expectedPhotos':82,'expectedMaps':len(tours),
  'missingAudio':missingAudio,'missingPhotos':missingPhotos,'missingCartouches':missingCartouches,
  'missingMaps':missingMaps,'maps':offlineMaps,
  'note':'Audio, photos and PMTiles use same-origin relative URLs and can be cached for offline use.'}
 (dest/'offline-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 if args.require_audio and missingAudio:raise RuntimeError(f'Cannot deploy without all 82 MP3: {missingAudio[:12]}')
 if args.require_complete and (missingAudio or missingPhotos or missingCartouches or missingMaps):
  raise RuntimeError(f'Incomplete offline package: audio={len(missingAudio)}, photos={len(missingPhotos)}, cartouches={len(missingCartouches)}, maps={len(missingMaps)}')
 size=sum(f.stat().st_size for f in dest.rglob('*') if f.is_file())
 if size > 950_000_000:raise RuntimeError(f'Site too large for GitHub Pages: {size/1e9:.2f} GB. Shrink audio/maps.')
 print(f'Built {dest}: MP3 {len(audio_ready)}/82; photos {82-len(missingPhotos)}/82; cartouches {len(cart["photos"])-len(missingCartouches)}/{len(cart["photos"])}; maps {len(offlineMaps)}/{len(tours)}')
 print('Missing Photos:',', '.join(missingPhotos[:15]))
 print('Map: local PMTiles when packaged; OpenFreeMap fallback otherwise')
 return 0
if __name__=='__main__':raise SystemExit(main())
