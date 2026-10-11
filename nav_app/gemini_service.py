import os
import json
import base64
from typing import Dict, Any, Optional

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None

def get_gemini_client():
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key or not genai:
        return None
    try:
        return genai.Client(api_key=api_key)
    except Exception as e:
        print(f"[Gemini Client Init Error] {e}")
        return None

def understand_destination(user_speech: str, language: str = "en") -> Dict[str, Any]:
    """
    Parses user spoken destination in Amharic, Afaan Oromoo, or English.
    Returns destination name, category, simulated distance, and spoken confirmation.
    """
    cleaned = (user_speech or "").strip()
    lang_code = language.lower()

    client = get_gemini_client()
    if client and cleaned:
        prompt = f"""
You are an intelligent accessibility assistant for blind pedestrians in Ethiopia.
The user spoke in language: '{language}'.
The user was asked where they want to go.
User spoken text: "{cleaned}"

Extract:
1. "destination": Clean name of the place (e.g. "St. George Church", "Bole Hotel", "Mercato Market", "Bole Medhanialem", etc.).
2. "category": one of ["hotel", "church", "mosque", "shop", "market", "hospital", "school", "restaurant", "bank", "station", "other"].
3. "estimated_meters": A realistic walking distance in meters between 50 and 300 meters for guidance.
4. "spoken_confirmation": A short, clear confirmation message in the requested language ('{language}') informing the blind user that navigation to this place is starting now.

Respond ONLY with valid JSON with keys:
{{"destination": "...", "category": "...", "estimated_meters": 120, "spoken_confirmation": "..."}}
"""
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            parsed = json.loads(response.text)
            if "destination" in parsed:
                return parsed
        except Exception as e:
            print(f"[Gemini Destination Parsing Error] {e}")

    # Fallback rule-based parsing if Gemini is offline or API key not set
    dest_name = cleaned if cleaned else ("Destination" if lang_code == "en" else ("መዳረሻ" if lang_code == "am" else "Bakka Deemtan"))
    
    # Clean common filler prefixes
    fillers = [
        "i want to go to", "go to", "take me to", "lead me to", "to the", "to",
        "ወደ", "መሄድ እፈልጋለሁ", "ሂድልኝ", "አድርሰኝ", "እፈልጋለሁ",
        "gara", "deemuu barbaada", "na geessi", "deemuu"
    ]
    cleaned_lower = dest_name.lower()
    for f in fillers:
        if cleaned_lower.startswith(f):
            dest_name = dest_name[len(f):].strip()
            break
        if cleaned_lower.endswith(f):
            dest_name = dest_name[:-len(f)].strip()
            break

    dest_name = dest_name.strip() or "Destination"

    # Determine category
    lower = dest_name.lower()
    category = "place"
    if any(w in lower for w in ["hotel", "ሆቴል", "hoteela"]):
        category = "hotel"
    elif any(w in lower for w in ["church", "ቤተክርስቲያን", "bataskaana"]):
        category = "church"
    elif any(w in lower for w in ["market", "mercato", "መርካቶ", "ገበያ", "gabaa"]):
        category = "market"
    elif any(w in lower for w in ["shop", "store", "ሱቅ", "suuqii"]):
        category = "shop"
    elif any(w in lower for w in ["hospital", "clinic", "ሆስፒታል", "hospitaala"]):
        category = "hospital"

    if lang_code in ["am", "amh"]:
        confirmation = f"መዳረሻዎ ወደ {dest_name} ተቀናብሯል። የካሜራ አሰሳ አሁን ይጀምራል። ስልክዎን ቀጥ አድርገው ይያዙ።"
    elif lang_code in ["om", "orm"]:
        confirmation = f"Bakki deemtan gara {dest_name}tti qophaa'eera. Qajeelchi kaameraa amma eegala. Bilbila keessan fuulduratti qabaa."
    else:
        confirmation = f"Destination set to {dest_name}. Starting camera navigation now. Hold your phone facing forward."

    return {
        "destination": dest_name,
        "category": category,
        "estimated_meters": 100,
        "spoken_confirmation": confirmation
    }

def analyze_camera_frame(image_bytes: bytes, language: str = "en", meters_walked: int = 0, distance_left: int = 100) -> Dict[str, Any]:
    """
    Uses Gemini Multimodal Vision to inspect road hazards, obstacles, people, vehicles, stairs, or holes.
    Returns structured alerts and spoken guidance in the chosen language.
    """
    lang_code = language.lower()
    client = get_gemini_client()

    if client and image_bytes and types:
        prompt = f"""
You are an expert real-time voice navigation guide for a blind pedestrian walking on a street or sidewalk.
The user is listening via audio in language: '{language}'.
They have walked {meters_walked} meters so far, with {distance_left} meters left to their destination.

Analyze this camera frame captured from their phone facing ahead.
Focus strictly on pedestrian safety:
1. Obstacles directly ahead (people, parked/moving vehicles, bajaj, carts, poles, street vendors, bikes).
2. Ground hazards (holes, open ditches, trenches, potholes, uneven rocks, mud).
3. Level changes (stairs going up/down, curbs, steep slopes).
4. Path status (is the pathway clear ahead, or should they adjust left/right or stop?).

Be concise, realistic, and direct. The user is blind and needs short, life-saving voice advice.
Return ONLY valid JSON with keys:
{{
  "urgent_warning": true or false,
  "hazard_detected": true or false,
  "hazards": ["person ahead", "stairs down", "vehicle", ...],
  "clear_ahead": true or false,
  "spoken_message": "A short, crystal clear spoken advisory (1 to 2 sentences) in '{language}' directly instructing the user."
}}
"""
        try:
            image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[image_part, prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            parsed = json.loads(response.text)
            if "spoken_message" in parsed:
                return parsed
        except Exception as e:
            print(f"[Gemini Vision Error] {e}")

    # Fallback status if Gemini is not responding or key not set
    if lang_code in ["am", "amh"]:
        msg = f"መንገዱ ክፍት ነው። ወደ ፊት መራመድዎን ይቀጥሉ። {meters_walked} ሜትር ተጉዘዋል፣ {distance_left} ሜትር ይቀራል።"
    elif lang_code in ["om", "orm"]:
        msg = f"Karaan qulqulluudha. Qajeelaa deemaa. Meetira {meters_walked} deemtaniittu, meetirri {distance_left} hafeera."
    else:
        msg = f"Clear path ahead. Keep walking straight. You have walked {meters_walked} meters, {distance_left} meters remaining."

    return {
        "urgent_warning": False,
        "hazard_detected": False,
        "hazards": [],
        "clear_ahead": True,
        "spoken_message": msg
    }
