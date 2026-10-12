import json
from django.test import TestCase, Client
from django.urls import reverse
from .models import NavigationSession

class VoiceNavigationTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_homepage_renders(self):
        response = self.client.get(reverse('index'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'VISION NAV')
        self.assertContains(response, 'appContainer')
        self.assertContains(response, 'cameraVideo')

    def test_api_status(self):
        response = self.client.get(reverse('api_status'))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('supported_languages', data)
        codes = [l['code'] for l in data['supported_languages']]
        self.assertIn('om', codes)
        self.assertIn('am', codes)
        self.assertIn('en', codes)

    def test_destination_english(self):
        payload = {
            'speech': 'I want to go to Hilton Hotel',
            'language': 'en'
        }
        response = self.client.post(
            reverse('api_destination'),
            data=json.dumps(payload),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('session_id', data)
        self.assertIn('Hilton Hotel', data['destination'])
        self.assertGreater(data['target_distance'], 0)
        self.assertIn('Destination set to', data['spoken_confirmation'])

    def test_destination_amharic(self):
        payload = {
            'speech': 'ወደ ጊዮርጊስ ቤተክርስቲያን',
            'language': 'am'
        }
        response = self.client.post(
            reverse('api_destination'),
            data=json.dumps(payload),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('session_id', data)
        self.assertIn('ጊዮርጊስ ቤተክርስቲያን', data['destination'])
        self.assertIn('መዳረሻዎ', data['spoken_confirmation'])

    def test_destination_oromo(self):
        payload = {
            'speech': 'Gara gabaa deemuu barbaada',
            'language': 'om'
        }
        response = self.client.post(
            reverse('api_destination'),
            data=json.dumps(payload),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('session_id', data)
        self.assertIn('gabaa', data['destination'].lower())
        self.assertIn('Bakki deemtan', data['spoken_confirmation'])

    def test_update_trip_and_arrival(self):
        # Create session first
        session = NavigationSession.objects.create(
            session_id='test_session_123',
            language='en',
            destination='Bole Mall',
            meters_walked=0,
            distance_remaining=100,
            target_distance=100
        )

        update_payload = {
            'session_id': 'test_session_123',
            'meters_walked': 100,
            'distance_left': 0,
            'arrived': True,
            'language': 'en'
        }
        response = self.client.post(
            reverse('api_update_trip'),
            data=json.dumps(update_payload),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['arrived'])
        self.assertIn('arrived safely', data['arrival_message'])

        # Verify DB updated
        session.refresh_from_db()
        self.assertEqual(session.status, 'arrived')
        self.assertEqual(session.meters_walked, 100)

    def test_analyze_frame_fallback(self):
        payload = {
            'image': '',
            'language': 'am',
            'meters_walked': 10,
            'distance_left': 90
        }
        response = self.client.post(
            reverse('api_analyze_frame'),
            data=json.dumps(payload),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('spoken_message', data)
        self.assertIn('መንገዱ ክፍት ነው', data['spoken_message'])

    def test_dashboard_renders(self):
        response = self.client.get(reverse('dashboard'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'CAREGIVER')
        self.assertContains(response, 'liveMap')
        self.assertContains(response, 'dashRadarCanvas')

    def test_dashboard_data_api(self):
        NavigationSession.objects.create(
            session_id='dash_test_001',
            language='en',
            destination='Piassa',
            meters_walked=20,
            distance_remaining=80,
            target_distance=100,
            status='active'
        )
        response = self.client.get(reverse('api_dashboard_data'))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('active_session', data)
        self.assertEqual(data['active_session']['session_id'], 'dash_test_001')
        self.assertIn('stats', data)
        self.assertGreaterEqual(data['stats']['total_sessions'], 1)

    def test_caregiver_action_and_alert_delivery(self):
        session = NavigationSession.objects.create(
            session_id='alert_test_001',
            language='en',
            destination='Sheraton',
            status='active'
        )

        # 1. Send caregiver message
        resp = self.client.post(
            reverse('api_caregiver_action'),
            data=json.dumps({
                'session_id': 'alert_test_001',
                'action': 'message',
                'message': 'Caregiver: Stop right now, road is closed'
            }),
            content_type='application/json'
        )
        self.assertEqual(resp.status_code, 200)

        # 2. Update trip should deliver pending alert to blind user's device
        update_resp = self.client.post(
            reverse('api_update_trip'),
            data=json.dumps({
                'session_id': 'alert_test_001',
                'meters_walked': 10,
                'distance_left': 90,
                'arrived': False
            }),
            content_type='application/json'
        )
        self.assertEqual(update_resp.status_code, 200)
        update_data = update_resp.json()
        self.assertIn('pending_alerts', update_data)
        self.assertEqual(len(update_data['pending_alerts']), 1)
        self.assertIn('Stop right now', update_data['pending_alerts'][0]['message'])

