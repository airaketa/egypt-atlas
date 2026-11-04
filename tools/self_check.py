#!/usr/bin/env python3
"""Fast source-only check before pushing; MP3 are not needed."""
import hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def read_js(filename,prefix):
    raw=(ROOT/filename).read_text(encoding='utf-8')
    if not raw.startswith(prefix): raise RuntimeError(f'{filename}: unexpected JS export')
    return json.loads(raw[len(prefix):].strip().removesuffix(';'))

def main():
    tours=read_js('catalog.js','window.EgyptAtlasCatalog = ')
    voice=read_js('voice-catalog.js','window.EGYPT_ATLAS_TRACKS = ')
    tracks=json.loads((ROOT/'data/track_list.json').read_text(encoding='utf-8'))
    assert len(tours)==12, f'Expected 12 tours: {len(tours)}'
    stops=[s for t in tours for s in (t['stops'] + t.get('extension',{}).get('stops',[]))]
    assert len(stops)==len(tracks)==len(voice)==82, 'Expected 82 catalog/track/voice entries'
    stop_index={s['id']:s for s in stops}
    voice_index={s['id']:s for s in voice}
    track_index={s['id']:s for s in tracks}
    assert len(stop_index)==len(voice_index)==len(track_index)==82, 'Duplicate stop IDs'
    assert stop_index.keys()==voice_index.keys()==track_index.keys(), 'IDs differ'
    assert len(list((ROOT/'texts').glob('*.txt')))==82, 'Expected 82 source scripts'
    for id,stop in stop_index.items():
        source=(ROOT/'texts'/f'{id}.txt').read_text(encoding='utf-8').strip()
        assert source==stop['script']==voice_index[id]['text']==track_index[id]['text'], f'Text drift for {id}'
        assert hashlib.sha256(source.encode('utf-8')).hexdigest()==track_index[id]['sha256'], f'SHA mismatch for {id}'
    for name in ('index.html','manifest.webmanifest','sw.js','.github/workflows/pages.yml','tools/build_site.py','tools/pack_media.py','PACK_MEDIA_WINDOWS.bat','vendor/maplibre-gl.js','vendor/maplibre-gl.css','vendor/pmtiles.js'):
        assert (ROOT/name).is_file(), f'Missing {name}'
    assert "pmtiles://" in (ROOT/'map-logic.js').read_text(encoding='utf-8'), 'Local PMTiles map integration missing'
    assert "--require-complete" in (ROOT/'.github/workflows/pages.yml').read_text(encoding='utf-8'), 'Pages must require a complete offline package'
    ignored=(ROOT/'.gitignore').read_text(encoding='utf-8')
    for rule in ('/audio/','/photos/real/','/maps/offline/','/egypt-media.zip'):
        assert rule in ignored, f'Missing .gitignore rule: {rule}'
    print('PASS: 12 tours, 82 matching texts, complete offline Pages workflow and local PMTiles runtime')
    return 0
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:print('FAIL:',str(e));sys.exit(1)
