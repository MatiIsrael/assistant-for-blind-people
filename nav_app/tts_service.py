import os
import hashlib
import urllib.parse
from pathlib import Path
import requests

CACHE_DIR = Path(__file__).resolve().parent.parent / "tts_cache"
CACHE_DIR.mkdir(exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def get_tts_audio(text: str, lang: str = "en") -> bytes:
    """
    Generate or retrieve cached TTS audio bytes.
    Supports:
      - 'am': Amharic
      - 'om': Afaan Oromoo
      - 'en': English
    """
    if not text or not text.strip():
        return b""

    cleaned_text = text.strip()
    norm_lang = lang.lower()

    # Map language codes for audio synthesis
    if norm_lang in ["am", "amh", "amharic"]:
        tts_lang = "am"
    elif norm_lang in ["om", "orm", "oromo", "afaan oromoo"]:
        # Swahili / East African Bantu TTS engine shares vowel/consonant phonetics with Latin Oromo
        tts_lang = "sw"
    else:
        tts_lang = "en"

    # Compute cache key
    cache_key = hashlib.md5(f"{tts_lang}:{cleaned_text}".encode("utf-8")).hexdigest()
    cache_file = CACHE_DIR / f"{cache_key}.mp3"

    if cache_file.exists():
        try:
            return cache_file.read_bytes()
        except Exception:
            pass

    # Split long text if necessary (Google TTS allows ~200 characters per chunk)
    chunks = []
    if len(cleaned_text) > 180:
        words = cleaned_text.split(" ")
        current = ""
        for word in words:
            if len(current) + len(word) + 1 > 180:
                chunks.append(current.strip())
                current = word + " "
            else:
                current += word + " "
        if current.strip():
            chunks.append(current.strip())
    else:
        chunks = [cleaned_text]

    audio_data = bytearray()
    for chunk in chunks:
        encoded_query = urllib.parse.quote(chunk)
        url = f"https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl={tts_lang}&q={encoded_query}"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=1.5)
            if resp.status_code == 200 and len(resp.content) > 100:
                audio_data.extend(resp.content)
            else:
                # If specialized code fails, fallback to English synthesis
                fallback_url = f"https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q={encoded_query}"
                fb_resp = requests.get(fallback_url, headers=HEADERS, timeout=1.5)
                if fb_resp.status_code == 200:
                    audio_data.extend(fb_resp.content)
        except Exception as e:
            # Quick failover to let browser Web Speech take over with 0ms delay
            pass

    result_bytes = bytes(audio_data)
    if result_bytes:
        try:
            cache_file.write_bytes(result_bytes)
        except Exception:
            pass

    return result_bytes
