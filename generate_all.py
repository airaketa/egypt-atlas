# -*- coding: utf-8 -*-
"""Egypt Atlas batch TTS: generate and verify all 82 MP3 files.

Unofficial Edge consumer TTS endpoint. Use for local prototypes only until
licensing of publicly distributed audio is confirmed. Output can be re-generated
through a licensed TTS service without changing stable track IDs.
"""
import argparse
import asyncio
import csv
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from tts_pronunciation import prepare_tts_text

ROOT=Path(__file__).resolve().parent
TRACKS=json.loads((ROOT/'data'/'track_list.json').read_text(encoding='utf-8'))
if len(TRACKS)!=82 or len({track['id'] for track in TRACKS})!=82:
    raise RuntimeError('Ожидалось ровно 82 уникальные записи в data/track_list.json')
OUT=ROOT/'audio'
OUT.mkdir(exist_ok=True)
STATUS_PATH=ROOT/'voice_status.json'
VOICE='ru-RU-SvetlanaNeural'
RATE='+0%'
PITCH='+0Hz'

def load_status():
    if not STATUS_PATH.is_file():return {}
    try:return json.loads(STATUS_PATH.read_text(encoding='utf-8'))
    except (ValueError,OSError):return {}

def save_status(d):
    temp=STATUS_PATH.with_suffix('.json.part')
    temp.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temp.replace(STATUS_PATH)
    js='window.EGYPT_ATLAS_VOICE_STATUS = '+json.dumps(d,ensure_ascii=False)+';\n'
    (ROOT/'voice_status.js').write_text(js,encoding='utf-8')
    ready={'voice':VOICE,'ids':[t['id'] for t in TRACKS if d.get(t['id'],{}).get('status')=='ok' and (OUT/(t['id']+'.mp3')).exists()]}
    (ROOT/'audio-ready.js').write_text('window.EgyptAtlasAudioReady = '+json.dumps(ready,ensure_ascii=False)+';\n',encoding='utf-8')
    with (ROOT/'generation_report.csv').open('w',encoding='utf-8-sig',newline='') as handle:
        writer=csv.writer(handle)
        writer.writerow(['ID','Статус','Длительность (сек)','Примечание'])
        for t in TRACKS:
            rec=d.get(t['id'],{})
            writer.writerow([t['id'],rec.get('status','not_started'),rec.get('duration_sec',''),rec.get('error','')])

def verify_mp3(file):
    from mutagen.mp3 import MP3
    if not file.exists() or file.stat().st_size<2500:
        raise ValueError('Файл отсутствует или слишком мал')
    info=MP3(str(file)).info
    if not 10 <= info.length <= 160 or info.bitrate<=0:
        raise ValueError(f'Неверная длительность/битрейт: {info.length:.1f}s / {info.bitrate}')
    return round(info.length,2)

def wanted_tracks(only):
    only=only.strip().upper()
    if not only:return TRACKS
    matches=[t for t in TRACKS if t['id'].startswith(only) or only in t['group'].upper()]
    if not matches:raise ValueError(f'Не найдены точки по фильтру {only!r}')
    return matches

async def render(edge_tts,track,output):
    source=(ROOT/'texts'/f"{track['id']}.txt").read_text(encoding='utf-8').strip()
    text=prepare_tts_text(track['id'], source)
    current_hash=hashlib.sha256(text.encode('utf-8')).hexdigest()
    if hashlib.sha256(source.encode('utf-8')).hexdigest()!=track['sha256']:
        raise ValueError(f"{track['id']}: текст не совпадает с реестром, сначала синхронизируйте исходные файлы")
    tmp=output.with_suffix('.part.mp3')
    if tmp.exists():tmp.unlink()
    try:
        await edge_tts.Communicate(text,VOICE,rate=RATE,pitch=PITCH).save(str(tmp))
        duration=verify_mp3(tmp)
        tmp.replace(output)
        return duration,current_hash
    finally:
        if tmp.exists():tmp.unlink()

async def main():
    parser=argparse.ArgumentParser(description='Egypt Atlas: озвучить все 82 текста Светланой одним запуском')
    targets=parser.add_mutually_exclusive_group()
    targets.add_argument('--all',action='store_true',help='Обработать все 82 записи (режим GENERATE_ALL_WINDOWS.bat)')
    targets.add_argument('--only',default='',help='Обработать только группу или ID, например KAR или KAR-04')
    parser.add_argument('--force',action='store_true',help='Перегенерировать даже уже готовые MP3')
    parser.add_argument('--verify',action='store_true',help='Проверить MP3 без сети и не генерировать новые')
    args=parser.parse_args()
    selected=TRACKS if args.all or not args.only else wanted_tracks(args.only)
    if not selected:
        print('Нет рассказов, подходящих под фильтр')
        return 2
    status=load_status()
    for t in TRACKS:
        status.setdefault(t['id'],{'status':'not_started'})
    save_status(status)

    if not args.verify:
        try:import edge_tts
        except ImportError:
            print('Нет edge-tts. Выполни: py -3 -m pip install edge-tts mutagen')
            return 2
    try:import mutagen.mp3
    except ImportError:
        print('Нет mutagen. Выполни: py -3 -m pip install edge-tts mutagen')
        return 2

    print(f'Egypt Atlas: {len(selected)} рассказов; голос {VOICE}; темп {RATE}; без музыки.')
    print(f'Выходная папка: {OUT}')
    failed=[]; skipped=0
    for idx,t in enumerate(selected,1):
        tid=t['id']; out=OUT/f'{tid}.mp3'
        body=(ROOT/'texts'/f'{tid}.txt').read_text(encoding='utf-8').strip()
        tts_body=prepare_tts_text(tid,body)
        current_hash=hashlib.sha256(tts_body.encode('utf-8')).hexdigest()
        existing=status.get(tid,{})
        if out.exists():
            try:
                duration=verify_mp3(out)
                if existing.get('sha256')==current_hash and not args.force:
                    status[tid]={'status':'ok','duration_sec':duration,'sha256':current_hash,'voice':VOICE}
                    save_status(status);skipped+=1
                    print(f'[{idx}/{len(selected)}] SKIP {tid} · {duration}s (уже готов)')
                    continue
            except Exception:
                pass
        if args.verify:
            status[tid]={'status':'missing_or_invalid','error':'MP3 отсутствует или не прошёл проверку'}
            save_status(status)
            failed.append(tid)
            print(f'[{idx}/{len(selected)}] MISSING {tid}')
            continue

        print(f'[{idx}/{len(selected)}] {tid}: {t["title"]}',flush=True)
        last_error=None
        for attempt in (1,2,3):
            try:
                duration,sha=await render(edge_tts,t,out)
                status[tid]={'status':'ok','duration_sec':duration,'sha256':sha,'voice':VOICE}
                save_status(status)
                print(f'  OK: {duration}s',flush=True)
                last_error=None
                break
            except Exception as exc:
                last_error=f'{type(exc).__name__}: {exc}'
                print(f'  Ошибка ({attempt}/3): {last_error}',flush=True)
                if attempt<3:
                    await asyncio.sleep(5*attempt)
        if last_error is not None:
            failed.append(tid)
            status[tid]={'status':'failed','error':last_error[:300]}
            save_status(status)
            print('  Переходим к следующей записи; остальные треки всё равно будут обработаны.',flush=True)
        await asyncio.sleep(1.5)
    ready=sum(1 for t in TRACKS if status.get(t['id'],{}).get('status')=='ok')
    print(f'\nГотово: {ready}/{len(TRACKS)}. Пропущено готовых в этом запуске: {skipped}. Ошибки этого запуска: {len(failed)}.')
    print('Сводка: generation_report.csv. Для прослушивания откройте index.html.')
    if failed:print('Проблемные ID: '+', '.join(failed))
    return 0 if not failed and all(status.get(t['id'],{}).get('status') == 'ok' for t in selected) else 1

if __name__=='__main__':
    try:sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        print('\nОстановлено. Частично готовые аудиофайлы сохранены. Запусти BAT снова для продолжения.')
        sys.exit(130)
