#!/usr/bin/env python3
"""Prepare a manually uploaded GitHub Release asset (no binary files in Git)."""
import argparse,hashlib,json,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0,str(ROOT))
POSSIBLE_IMAGE_EXTS=('.jpg','.jpeg','.png','.webp')

def catalog():
 raw=(ROOT/'catalog.js').read_text(encoding='utf-8')
 return json.loads(raw.removeprefix('window.EgyptAtlasCatalog = ').strip().removesuffix(';'))

def expected_ids():
 return [s['id'] for t in catalog() for s in t['stops']+t.get('extension',{}).get('stops',[])]

def expected_tour_ids():return [tour['id'] for tour in catalog()]

def expected_cartouche_ids():
 raw=(ROOT/'cartouche-integrated-data.js').read_text(encoding='utf-8')
 data=json.loads(raw.removeprefix('window.EgyptAtlasCartouchesInline = ').strip().removesuffix(';'))
 return list(data['photos'])

def photo_path(tid):
 return next((ROOT/'photos'/'real'/f'{tid}{ext}' for ext in POSSIBLE_IMAGE_EXTS if (ROOT/'photos'/'real'/f'{tid}{ext}').is_file()),None)

def digest(data):return hashlib.sha256(data).hexdigest()

def main():
 p=argparse.ArgumentParser(description='Package generated Egypt Atlas MP3, photos and optional maps for GitHub Releases')
 p.add_argument('--out',default=str(ROOT/'egypt-media.zip'))
 p.add_argument('--strict',action='store_true',help='Fail unless all audio, photos and 12 PMTiles maps are present')
 p.add_argument('--confirm-rights',action='store_true',help='I reviewed image permissions and TTS redistribution rights')
 args=p.parse_args()
 ids=expected_ids();assert len(ids)==len(set(ids))==82
 paths={}
 for tid in ids:
  audio=ROOT/'audio'/f'{tid}.mp3'
  if audio.is_file() and audio.stat().st_size>=2500:paths[f'audio/{tid}.mp3']=audio
  photo=photo_path(tid)
  if photo and photo.stat().st_size>=2500:paths[f'photos/real/{photo.name}']=photo
 for photo in (ROOT/'assets/cartouches').glob('*.jpg') if (ROOT/'assets/cartouches').is_dir() else []:
  if photo.stat().st_size>=2500:paths[f'assets/cartouches/{photo.name}']=photo
 for source in (ROOT/'maps/offline').glob('*.pmtiles') if (ROOT/'maps/offline').is_dir() else []:
  if source.stat().st_size>=100:paths[f'maps/offline/{source.name}']=source
 count_mp3=sum(k.endswith('.mp3') for k in paths)
 count_photos=sum(k.startswith('photos/real/') for k in paths)
 count_cart=sum(k.startswith('assets/cartouches/') for k in paths)
 count_maps=sum(k.endswith('.pmtiles') for k in paths)
 print(f'Found: {count_mp3}/82 MP3, {count_photos}/82 photos, {count_cart} cartouche photos, {count_maps} PMTiles')
 if args.strict and count_mp3!=len(ids):raise SystemExit('ERROR: missing MP3. Run GENERATE_ALL_WINDOWS.bat first.')
 if args.strict and count_photos!=len(ids):raise SystemExit('ERROR: missing photos. Run DOWNLOAD_PHOTOS_WINDOWS.bat again.')
 if args.strict and count_maps!=len(expected_tour_ids()):raise SystemExit('ERROR: missing PMTiles. Run DOWNLOAD_ALL_MAPS_WINDOWS.bat first.')
 if args.strict and count_cart!=len(expected_cartouche_ids()):raise SystemExit('ERROR: missing cartouche photos. Run DOWNLOAD_CARTOUCHE_PHOTOS_WINDOWS.bat first.')
 for tour_id in expected_tour_ids():
  map_path=ROOT/'maps'/'offline'/f'{tour_id}.pmtiles'
  if args.strict and (not map_path.is_file() or map_path.read_bytes()[:7]!=b'PMTiles'):
   raise SystemExit(f'ERROR: invalid PMTiles archive: {tour_id}')
 if args.strict:
  from tts_pronunciation import prepare_tts_text
  status_path=ROOT/'voice_status.json'
  if not status_path.is_file():raise SystemExit('Missing voice_status.json; run GENERATE_ALL_WINDOWS.bat.')
  status=json.loads(status_path.read_text(encoding='utf-8'))
  for tid in ids:
   source=(ROOT/'texts'/f'{tid}.txt').read_text(encoding='utf-8').strip()
   expected=digest(prepare_tts_text(tid,source).encode('utf-8'))
   item=status.get(tid,{})
   if item.get('status')!='ok' or item.get('sha256')!=expected:
    raise SystemExit(f'Stale audio for {tid}: run python generate_all.py --only {tid}')
  try:
   from mutagen.mp3 import MP3
  except ImportError:
   raise SystemExit('Install mutagen to validate MP3: python -m pip install mutagen')
  for tid in ids:
   mp3=ROOT/'audio'/f'{tid}.mp3'
   try:
    info=MP3(str(mp3)).info
    if info.length<10 or info.bitrate<=0:raise ValueError('Too short or invalid bitrate')
   except Exception as exc:
    raise SystemExit(f'Invalid MP3 for {tid}: {exc}')
 if not args.confirm_rights:raise SystemExit('Before publishing, audit Commons/GEM rights and TTS service terms; then rerun with --confirm-rights.')
 manifest={'format':2,'files':[], 'texts_sha256':{}}
 for tid in ids:
  content=(ROOT/'texts'/f'{tid}.txt').read_text(encoding='utf-8').strip()
  manifest['texts_sha256'][tid]=digest(content.encode('utf-8'))
 out=Path(args.out).resolve()
 with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
  for arc,path in sorted(paths.items()):
   data=path.read_bytes()
   manifest['files'].append({'path':arc,'bytes':len(data),'sha256':digest(data)})
   z.writestr(arc,data)
  z.writestr('media-package.json',json.dumps(manifest,ensure_ascii=False,indent=2))
 print('Created',out,out.stat().st_size,'bytes')
 return 0
if __name__=='__main__':raise SystemExit(main())
