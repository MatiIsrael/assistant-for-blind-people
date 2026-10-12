import os
import json
import base64
import uuid
from django.shortcuts import render
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from .tts_service import get_tts_audio
from .gemini_service import understand_destination, analyze_camera_frame
from .firebase_service import is_firebase_ready, save_navigation_session, log_hazard_event
from .models import NavigationSession, HazardLog, CaregiverAlert

# Default Ethiopian landmarks for realistic GPS coordinates
LANDMARK_COORDS = {
    'church': (9.0345, 38.7516),      # St. George Cathedral / Arada
    'hotel': (9.0195, 38.7610),       # Sheraton Addis / Kazanchis
    'market': (9.0301, 38.7397),      # Merkato
    'hospital': (9.0412, 38.7621),    # Tikur Anbessa Hospital
    'shop': (9.0125, 38.7650),        # Bole Road Shop
    'bole': (8.9950, 38.7860),
    'piassa': (9.0330, 38.7520),
    'default': (9.0180, 38.7680),
}

def index(request):
    """
    Renders the accessible voice-first navigation interface for blind users.
    """
    context = {
        'gemini_configured': bool(os.environ.get('GEMINI_API_KEY')),
        'firebase_connected': is_firebase_ready(),
    }
    return render(request, 'index.html', context)

def dashboard(request):
    """
    Renders the Caregiver & Telemetry Analytics Dashboard (/dashboard/).
    """
    total_sessions = NavigationSession.objects.count()
    completed_sessions = NavigationSession.objects.filter(status='arrived').count()
    total_hazards = HazardLog.objects.count()
    recent_sessions = NavigationSession.objects.order_by('-created_at')[:10]
    recent_hazards = HazardLog.objects.order_by('-created_at')[:10]
    active_session = NavigationSession.objects.filter(status='active').order_by('-created_at').first()

    context = {
        'gemini_configured': bool(os.environ.get('GEMINI_API_KEY')),
        'firebase_connected': is_firebase_ready(),
        'total_sessions': total_sessions,
        'completed_sessions': completed_sessions,
        'total_hazards': total_hazards,
        'recent_sessions': recent_sessions,
        'recent_hazards': recent_hazards,
        'active_session': active_session,
    }
    return render(request, 'dashboard.html', context)

def api_dashboard_data(request):
    """
    Returns live JSON telemetry for the dashboard live map, gauges, and activity feeds.
    GET /api/dashboard-data/
    """
    active_session = NavigationSession.objects.filter(status='active').order_by('-created_at').first()
    if not active_session:
        active_session = NavigationSession.objects.order_by('-created_at').first()

    active_data = None
    if active_session:
        active_data = {
            'session_id': active_session.session_id,
            'destination': active_session.destination,
            'language': active_session.language,
            'category': active_session.category,
            'meters_walked': active_session.meters_walked,
            'distance_remaining': active_session.distance_remaining,
            'target_distance': active_session.target_distance,
            'status': active_session.status,
            'hazards_encountered': active_session.hazards_encountered,
            'current_lat': active_session.current_lat,
            'current_lng': active_session.current_lng,
            'dest_lat': active_session.dest_lat,
            'dest_lng': active_session.dest_lng,
            'speed_mps': active_session.speed_mps,
            'battery_level': active_session.battery_level,
            'last_user_speech': active_session.last_user_speech,
            'last_assistant_speech': active_session.last_assistant_speech,
            'updated_at': active_session.updated_at.isoformat(),
        }

    recent_sessions = list(NavigationSession.objects.order_by('-created_at')[:8].values(
        'session_id', 'destination', 'language', 'meters_walked', 'target_distance', 'status', 'hazards_encountered', 'created_at'
    ))

    recent_hazards = list(HazardLog.objects.order_by('-created_at')[:8].values(
        'hazard_type', 'distance_meters', 'direction', 'lat', 'lng', 'created_at'
    ))

    total_sessions = NavigationSession.objects.count()
    completed = NavigationSession.objects.filter(status='arrived').count()
    total_hazards = HazardLog.objects.count()
    total_meters = sum(NavigationSession.objects.values_list('meters_walked', flat=True))

    return JsonResponse({
        'active_session': active_data,
        'recent_sessions': recent_sessions,
        'recent_hazards': recent_hazards,
        'stats': {
            'total_sessions': total_sessions,
            'completed_sessions': completed,
            'total_hazards': total_hazards,
            'total_meters': total_meters,
        }
    })

@csrf_exempt
def api_caregiver_action(request):
    """
    Caregiver triggers remote voice instruction, SOS, or step simulation.
    POST /api/caregiver-action/
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        data = {}

    session_id = data.get('session_id')
    action = data.get('action', 'message')  # message, sos, step, reset
    message = data.get('message', '').strip()

    session = None
    if session_id:
        session = NavigationSession.objects.filter(session_id=session_id).first()
    if not session:
        session = NavigationSession.objects.filter(status='active').order_by('-created_at').first()

    if not session:
        return JsonResponse({'error': 'No active session found'}, status=404)

    if action == 'message' and message:
        CaregiverAlert.objects.create(
            session=session,
            message=message,
            alert_type='caregiver_voice',
            is_delivered=False
        )
        return JsonResponse({'status': 'sent', 'message': f'Caregiver voice prompt queued: {message}'})

    elif action == 'sos':
        CaregiverAlert.objects.create(
            session=session,
            message='EMERGENCY ALERT: Stop walking immediately! Assistance is checking your location.',
            alert_type='emergency_sos',
            is_delivered=False
        )
        return JsonResponse({'status': 'sent', 'message': 'Emergency SOS broadcast sent to blind user.'})

    elif action == 'step':
        step_val = int(data.get('step', 10))
        session.meters_walked += step_val
        session.distance_remaining = max(0, session.distance_remaining - step_val)
        if session.distance_remaining == 0:
            session.status = 'arrived'
        session.save()
        return JsonResponse({
            'status': 'updated',
            'meters_walked': session.meters_walked,
            'distance_remaining': session.distance_remaining
        })

    return JsonResponse({'error': 'Unknown action'}, status=400)

def api_tts(request):
    """
    Serves streaming TTS audio for Amharic, Afaan Oromoo, or English.
    GET /api/tts/?text=...&lang=...
    """
    text = request.GET.get('text', '').strip()
    lang = request.GET.get('lang', 'en').strip()

    if not text:
        return JsonResponse({'error': 'No text provided'}, status=400)

    audio_bytes = get_tts_audio(text, lang)
    if not audio_bytes:
        return JsonResponse({'error': 'TTS audio synthesis unavailable for offline mode, use Web Speech'}, status=204)

    response = HttpResponse(audio_bytes, content_type='audio/mpeg')
    response['Cache-Control'] = 'public, max-age=86400'
    response['Content-Length'] = len(audio_bytes)
    return response

@csrf_exempt
def api_destination(request):
    """
    Understands user's spoken destination in any of the 3 languages.
    POST /api/destination/
    Body: {"speech": "...", "language": "am|om|en", "lat": 9.0108, "lng": 38.7613}
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        data = {}

    user_speech = data.get('speech', '').strip()
    language = data.get('language', 'en').lower()
    start_lat = float(data.get('lat', 9.0108))
    start_lng = float(data.get('lng', 38.7613))

    if not user_speech:
        return JsonResponse({'error': 'No speech provided'}, status=400)

    # Process with Gemini / Rule parser
    result = understand_destination(user_speech, language)
    session_id = f"trip_{uuid.uuid4().hex[:8]}"

    target_distance = result.get('estimated_meters', 100)
    category = result.get('category', 'place').lower()

    # Determine destination coordinates
    dest_coord = LANDMARK_COORDS.get(category, LANDMARK_COORDS['default'])
    # Add a slight distance-proportional offset from start coordinates
    ratio = min(1.0, target_distance / 200.0)
    dest_lat = start_lat + (dest_coord[0] - 9.0108) * ratio + 0.0012
    dest_lng = start_lng + (dest_coord[1] - 38.7613) * ratio + 0.0010

    spoken_conf = result.get('spoken_confirmation', f'Heading to {result.get("destination")}')

    # Save to local database
    session_obj = NavigationSession.objects.create(
        session_id=session_id,
        language=language,
        destination=result.get('destination', 'Destination'),
        category=category,
        meters_walked=0,
        distance_remaining=target_distance,
        target_distance=target_distance,
        status='active',
        current_lat=start_lat,
        current_lng=start_lng,
        dest_lat=dest_lat,
        dest_lng=dest_lng,
        speed_mps=1.2,
        battery_level=95,
        last_user_speech=user_speech,
        last_assistant_speech=spoken_conf
    )

    # Sync to Firebase if configured
    firebase_payload = {
        'session_id': session_id,
        'language': language,
        'destination': result.get('destination'),
        'category': category,
        'meters_walked': 0,
        'target_distance': target_distance,
        'status': 'active',
        'current_lat': start_lat,
        'current_lng': start_lng,
        'dest_lat': dest_lat,
        'dest_lng': dest_lng,
        'created_at': timezone.now().isoformat(),
    }
    save_navigation_session(firebase_payload)

    return JsonResponse({
        'session_id': session_id,
        'destination': result.get('destination'),
        'category': category,
        'target_distance': target_distance,
        'spoken_confirmation': spoken_conf,
        'current_lat': start_lat,
        'current_lng': start_lng,
        'dest_lat': dest_lat,
        'dest_lng': dest_lng,
    })

@csrf_exempt
def api_analyze_frame(request):
    """
    Multimodal Vision: Analyzes a camera frame for obstacles, holes, stairs, people, vehicles.
    POST /api/analyze-frame/
    Body: {"image": "data:image/jpeg;base64,...", "language": "...", "session_id": "...", "meters_walked": 10, "distance_left": 90, "lat": 9.0108, "lng": 38.7613}
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        data = {}

    image_b64 = data.get('image', '')
    language = data.get('language', 'en')
    session_id = data.get('session_id', '')
    meters_walked = int(data.get('meters_walked', 0))
    distance_left = int(data.get('distance_left', 100))
    lat = float(data.get('lat', 9.0108))
    lng = float(data.get('lng', 38.7613))

    image_bytes = None
    if image_b64:
        try:
            if ',' in image_b64:
                image_b64 = image_b64.split(',', 1)[1]
            image_bytes = base64.b64decode(image_b64)
        except Exception as e:
            print(f"[Image Decode Error] {e}")

    result = analyze_camera_frame(
        image_bytes=image_bytes,
        language=language,
        meters_walked=meters_walked,
        distance_left=distance_left
    )

    if result.get('hazard_detected'):
        session = None
        if session_id:
            session = NavigationSession.objects.filter(session_id=session_id).first()
            if session:
                session.hazards_encountered += 1
                session.save(update_fields=['hazards_encountered'])

        hazards_list = result.get('hazards', [])
        primary_hazard = hazards_list[0] if hazards_list else {'type': 'Obstacle', 'distance': 2.0, 'direction': 'center'}
        h_type = primary_hazard.get('type', 'Obstacle') if isinstance(primary_hazard, dict) else str(primary_hazard)
        h_dist = primary_hazard.get('distance', 2.0) if isinstance(primary_hazard, dict) else 2.0
        h_dir = primary_hazard.get('direction', 'center') if isinstance(primary_hazard, dict) else 'center'

        HazardLog.objects.create(
            session=session,
            hazard_type=h_type,
            distance_meters=h_dist,
            direction=h_dir,
            description=result.get('spoken_message', 'Hazard detected ahead'),
            lat=lat,
            lng=lng
        )

        if session_id:
            log_hazard_event(session_id, {
                'hazards': hazards_list,
                'meters_walked': meters_walked,
                'message': result.get('spoken_message', ''),
                'lat': lat,
                'lng': lng
            })

    return JsonResponse(result)

@csrf_exempt
def api_update_trip(request):
    """
    Updates walking distance, GPS, telemetry, and returns any pending caregiver alerts.
    POST /api/update-trip/
    Body: {"session_id": "...", "meters_walked": 15, "distance_left": 85, "arrived": false, "lat": 9.0108, "lng": 38.7613, ...}
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        data = {}

    session_id = data.get('session_id')
    meters_walked = int(data.get('meters_walked', 0))
    distance_left = int(data.get('distance_left', 0))
    arrived = bool(data.get('arrived', False))
    language = data.get('language', 'en').lower()
    lat = float(data.get('lat', 9.0108))
    lng = float(data.get('lng', 38.7613))
    speed_mps = float(data.get('speed_mps', 1.2))
    battery_level = int(data.get('battery_level', 95))
    user_speech = data.get('user_speech', '')
    assistant_speech = data.get('assistant_speech', '')

    pending_alerts = []

    if session_id:
        try:
            session = NavigationSession.objects.filter(session_id=session_id).first()
            if session:
                session.meters_walked = meters_walked
                session.distance_remaining = distance_left
                session.current_lat = lat
                session.current_lng = lng
                session.speed_mps = speed_mps
                session.battery_level = battery_level
                if user_speech:
                    session.last_user_speech = user_speech
                if assistant_speech:
                    session.last_assistant_speech = assistant_speech
                if arrived:
                    session.status = 'arrived'
                session.save()

                # Check for undelivered caregiver messages
                alerts = CaregiverAlert.objects.filter(session=session, is_delivered=False)
                for alert in alerts:
                    pending_alerts.append({
                        'type': alert.alert_type,
                        'message': alert.message
                    })
                    alert.is_delivered = True
                    alert.save(update_fields=['is_delivered'])

        except Exception as e:
            print(f"[DB Update Error] {e}")

        # Update Firebase
        save_navigation_session({
            'session_id': session_id,
            'meters_walked': meters_walked,
            'distance_remaining': distance_left,
            'current_lat': lat,
            'current_lng': lng,
            'speed_mps': speed_mps,
            'battery_level': battery_level,
            'status': 'arrived' if arrived else 'active'
        })

    # Prepare speech message if arrived
    arrival_message = ""
    if arrived:
        if language in ['am', 'amh']:
            arrival_message = "እንኳን ደስ አለዎት! መዳረሻዎ በሰላም ደርሰዋል።"
        elif language in ['om', 'orm']:
            arrival_message = "Baga gammaddan! Bakka yaaddan nagaan geessaniittu."
        else:
            arrival_message = "Congratulations! You have arrived safely at your destination."

    return JsonResponse({
        'status': 'updated',
        'arrived': arrived,
        'arrival_message': arrival_message,
        'pending_alerts': pending_alerts
    })

def api_status(request):
    """
    System status endpoint.
    """
    return JsonResponse({
        'service': 'VisionNav Ethiopia Accessibility',
        'gemini_api': bool(os.environ.get('GEMINI_API_KEY')),
        'firebase': is_firebase_ready(),
        'supported_languages': [
            {'code': 'om', 'name': 'Afaan Oromoo'},
            {'code': 'am', 'name': 'አማርኛ (Amharic)'},
            {'code': 'en', 'name': 'English'}
        ]
    })

