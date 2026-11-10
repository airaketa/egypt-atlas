#!/usr/bin/env python3
"""Generate every Atlas narration discovered in content/ with one command."""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
from pathlib import Path

from tts_pronunciation import prepare_tts_text
from tools.content_model import ContentTree


ROOT = Path(__file__).resolve().parent
STATUS_PATH = ROOT / "data" / "audio_generation_status.json"
REPORT_PATH = ROOT / "data" / "audio_generation_report.csv"
RATE = "+0%"
PITCH = "+0Hz"
BETWEEN_REQUESTS_SECONDS = 1.5
TRANSIENT_RETRY_DELAYS = (30, 90, 180)


def load_status() -> dict:
    if not STATUS_PATH.is_file():
        return {}
    try:
        return json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}


def save_status(status: dict, tracks) -> None:
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATUS_PATH.with_suffix(".json.part")
    temporary.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(STATUS_PATH)
    with REPORT_PATH.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["ID", "Пакет", "Статус", "Длительность (сек)", "Файл", "Примечание"])
        for track in tracks:
            record = status.get(track.id, {})
            writer.writerow(
                [
                    track.id,
                    track.package_id,
                    record.get("status", "not_started"),
                    record.get("duration_sec", ""),
                    track.output.relative_to(ROOT),
                    record.get("error", ""),
                ]
            )


def sidecar(track) -> Path:
    return track.output.with_suffix(".sha256")


def verify_mp3(path: Path) -> float:
    from mutagen.mp3 import MP3

    if not path.is_file() or path.stat().st_size < 2500:
        raise ValueError("файл отсутствует или слишком мал")
    info = MP3(str(path)).info
    if not 8 <= info.length <= 900 or info.bitrate <= 0:
        raise ValueError(f"неверная длительность/битрейт: {info.length:.1f}s / {info.bitrate}")
    return round(info.length, 2)


def is_transient_tts_error(error: Exception) -> bool:
    message = f"{type(error).__name__}: {error}".casefold()
    return any(
        marker in message
        for marker in (
            "noaudioreceived",
            "no audio was received",
            "429",
            "too many requests",
            "timed out",
            "timeout",
            "connection",
            "temporarily unavailable",
        )
    )


def select_tracks(tracks, value: str):
    query = value.strip().casefold()
    if not query:
        return tracks
    result = [
        track
        for track in tracks
        if query in track.id.casefold()
        or query in track.package_id.casefold()
        or query in str(track.source.relative_to(ROOT)).casefold()
    ]
    if not result:
        raise ValueError(f"Не найдены записи по фильтру {value!r}")
    return result


async def render(edge_tts, track) -> float:
    raw_text = track.text
    tts_text = prepare_tts_text(track.pronunciation_id, raw_text)
    track.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = track.output.with_suffix(".part.mp3")
    temporary.unlink(missing_ok=True)
    try:
        await edge_tts.Communicate(tts_text, track.voice, rate=RATE, pitch=PITCH).save(str(temporary))
        duration = verify_mp3(temporary)
        temporary.replace(track.output)
        sidecar(track).write_text(track.text_sha256 + "\n", encoding="ascii")
        return duration
    finally:
        temporary.unlink(missing_ok=True)


async def run(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="обработать весь контент (режим по умолчанию)")
    parser.add_argument("--only", default="", help="фильтр по ID, пакету или пути, например egypt-cairo")
    parser.add_argument("--force", action="store_true", help="перегенерировать даже актуальные MP3")
    parser.add_argument("--verify", action="store_true", help="только проверить локальные MP3, без сети")
    args = parser.parse_args(argv)

    tree = ContentTree()
    all_tracks = list(tree.audio_tracks())
    selected = all_tracks if args.all or not args.only else select_tracks(all_tracks, args.only)
    status = load_status()
    for track in all_tracks:
        status.setdefault(track.id, {"status": "not_started"})
    save_status(status, all_tracks)

    try:
        import mutagen.mp3  # noqa: F401
    except ImportError:
        print("Нет mutagen. Выполни: py -3 -m pip install edge-tts mutagen")
        return 2
    edge_tts = None
    if not args.verify:
        try:
            import edge_tts as edge_tts_module

            edge_tts = edge_tts_module
        except ImportError:
            print("Нет edge-tts. Выполни: py -3 -m pip install edge-tts mutagen")
            return 2

    print(f"Atlas: выбрано {len(selected)} из {len(all_tracks)} аудиозаписей; без музыки.")
    print("Генератор пропускает только MP3 с совпадающей контрольной суммой текста.")
    failed: list[str] = []
    skipped = 0
    generated = 0
    service_unavailable = False
    for index, track in enumerate(selected, 1):
        expected_hash = track.text_sha256
        current_sidecar = sidecar(track).read_text(encoding="ascii").strip() if sidecar(track).is_file() else ""
        if track.output.is_file() and not args.force:
            try:
                duration = verify_mp3(track.output)
                if current_sidecar == expected_hash:
                    status[track.id] = {
                        "status": "ok",
                        "duration_sec": duration,
                        "text_sha256": expected_hash,
                        "voice": track.voice,
                    }
                    save_status(status, all_tracks)
                    skipped += 1
                    print(f"[{index}/{len(selected)}] SKIP {track.id} · {duration}s")
                    continue
            except Exception:
                pass

        if args.verify:
            reason = "MP3 отсутствует, повреждён или создан для другой версии текста"
            status[track.id] = {"status": "missing_or_outdated", "error": reason}
            save_status(status, all_tracks)
            failed.append(track.id)
            print(f"[{index}/{len(selected)}] MISSING {track.id}")
            continue

        print(f"[{index}/{len(selected)}] {track.id}: {track.title}", flush=True)
        last_error = None
        last_error_was_transient = False
        attempts = len(TRANSIENT_RETRY_DELAYS) + 1
        for attempt in range(1, attempts + 1):
            try:
                duration = await render(edge_tts, track)
                status[track.id] = {
                    "status": "ok",
                    "duration_sec": duration,
                    "text_sha256": expected_hash,
                    "voice": track.voice,
                }
                save_status(status, all_tracks)
                generated += 1
                print(f"  OK: {duration}s", flush=True)
                last_error = None
                break
            except Exception as error:
                last_error = f"{type(error).__name__}: {error}"
                last_error_was_transient = is_transient_tts_error(error)
                print(f"  Ошибка {attempt}/{attempts}: {last_error}", flush=True)
                if attempt < attempts:
                    delay = TRANSIENT_RETRY_DELAYS[attempt - 1] if last_error_was_transient else min(10 * attempt, 30)
                    print(f"  Повтор через {delay} сек.", flush=True)
                    await asyncio.sleep(delay)
        if last_error:
            failed.append(track.id)
            status[track.id] = {"status": "error", "error": last_error}
            save_status(status, all_tracks)
            if last_error_was_transient:
                service_unavailable = True
                print(
                    "Edge TTS временно не отдаёт аудио. Очередь остановлена, чтобы не усилить ограничение. "
                    "Подождите 10–20 минут и запустите скрипт снова: готовые MP3 будут пропущены.",
                    flush=True,
                )
                break
        await asyncio.sleep(BETWEEN_REQUESTS_SECONDS)

    print(f"Готово. Создано: {generated}; уже актуальны: {skipped}; проблемы: {len(failed)}.")
    print(f"Отчёт: {REPORT_PATH.relative_to(ROOT)}")
    if failed:
        print("Не готовы:", ", ".join(failed))
        if service_unavailable:
            print("Причина остановки: временная недоступность или ограничение частоты Edge TTS.")
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(run()))
    except KeyboardInterrupt:
        print("\nОстановлено. Готовые файлы сохранены.")
        raise SystemExit(130)
