# -*- coding: utf-8 -*-
"""Единственный слой адаптации дикторского текста для Edge Svetlana.

В приложении (catalog.js, texts/*.txt) сохраняются корректные написания.
Подмены применяются только на входе TTS и учитываются в кэше MP3.
"""
import json
import re
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name('tts-pronunciation.json')

def prepare_tts_text(track_id: str, text: str) -> str:
    conf = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    for rule in conf.get('global_prefixes', []):
        # «Рамсес» в любых падежах: Рамсеса, Рамсесом, Рамсесе и т. п.
        # Явная граница слова исключает замену внутри других имён.
        text = re.sub(r'\b' + re.escape(rule['from']), rule['to'], text)
    for rule in conf.get('per_track', {}).get(track_id, []):
        text = text.replace(rule['from'], rule['to'])
    return text
