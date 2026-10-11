import os
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:
    firebase_admin = None
    credentials = None
    firestore = None

_db = None
_firebase_initialized = False

def init_firebase():
    global _db, _firebase_initialized
    if _firebase_initialized:
        return _db

    if not firebase_admin or not credentials:
        print("[Firebase] firebase-admin package not loaded")
        return None

    # Check potential credential file paths
    base_dir = Path(__file__).resolve().parent.parent
    possible_paths = [
        os.environ.get("FIREBASE_CREDENTIALS"),
        base_dir / "firebase_credentials.json",
        base_dir / "serviceAccountKey.json",
        base_dir / "firebase-adminsdk.json",
    ]

    cred_path = None
    for p in possible_paths:
        if p and Path(p).exists():
            cred_path = str(p)
            break

    if not cred_path:
        # Check if already initialized by default
        if firebase_admin._apps:
            _db = firestore.client()
            _firebase_initialized = True
            return _db
        return None

    try:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        _db = firestore.client()
        _firebase_initialized = True
        print(f"[Firebase] Successfully initialized with {cred_path}")
        return _db
    except Exception as e:
        print(f"[Firebase Init Error] {e}")
        return None

def is_firebase_ready() -> bool:
    db = init_firebase()
    return db is not None

def save_navigation_session(session_data: Dict[str, Any]) -> bool:
    """
    Saves or updates a trip session in Firestore.
    """
    db = init_firebase()
    if not db:
        return False

    session_id = session_data.get("session_id", f"trip_{int(datetime.now().timestamp())}")
    try:
        doc_ref = db.collection("navigation_sessions").document(session_id)
        payload = dict(session_data)
        payload["updated_at"] = firestore.SERVER_TIMESTAMP
        doc_ref.set(payload, merge=True)
        return True
    except Exception as e:
        print(f"[Firebase Save Error] {e}")
        return False

def log_hazard_event(session_id: str, hazard_info: Dict[str, Any]) -> bool:
    """
    Logs an obstacle/hazard detection event to Firebase.
    """
    db = init_firebase()
    if not db:
        return False
    try:
        col_ref = db.collection("navigation_sessions").document(session_id).collection("hazards")
        hazard_payload = dict(hazard_info)
        hazard_payload["timestamp"] = firestore.SERVER_TIMESTAMP
        col_ref.add(hazard_payload)
        return True
    except Exception as e:
        print(f"[Firebase Hazard Log Error] {e}")
        return False
