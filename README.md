# 👁️ VisionNav - Voice-First Navigation Assistant for the Blind

An eyes-free, voice-controlled assistive web application tailored for blind pedestrians in Ethiopia, featuring high-contrast cyberpunk 2D graphics and a real-time Caregiver & Telemetry Analytics Dashboard.

The blind user talks directly to the application and listens to its voice replies — **hands-free, no typing, touching, or reading required**.

---

## 🌟 Features

### 1. 🗣️ 100% Hands-Free Trilingual Voice Interaction
- **Afaan Oromoo**, **Amharic (አማርኛ)**, and **English**.
- **Zero-Touch Auto-Start**: Welcomes the user immediately with voice upon launch without asking to touch or click the screen.
- **Continuous Listening Loop**: Automatically listens for responses and voice commands ("Stop", "Where am I?", "Status", "Repeat").
- **Caregiver Headset Audio**: Remote caregiver voice instructions and emergency SOS broadcasts speak directly into the user's headphones.

### 2. 📍 Voice Destination Setting & GPS Tracking
- Spoken destination recognition in Afaan Oromoo, Amharic, and English (Gemini NLP or local extractor).
- **High-Precision GPS**: Tracks live pedestrian coordinates with realistic Addis Ababa fallback simulation for testing.
- Calculates walking distances and prepares optimal pedestrian routes.

### 3. 🎨 Cyberpunk 2D UI Graphics Cockpit
- **2D Sonar Obstacle Radar Canvas**: 360° sweeping radar beam with 1m, 2m, and 5m range rings, danger cones, and real-time obstacle blips.
- **2D Cybernetic Compass & Spatial Bearing**: Circular digital heading gyro displaying current direction and destination vector.
- **2D Dynamic Sinusoidal Audio Waveform**: Smooth animated oscillating neon waveform reacting to speech output and microphone input.
- **2D Walking Runway Progress Bar**: Perspective runway showing walked distance, walking pedestrian avatar, and destination milestone beacons.

### 4. 📊 Caregiver & Telemetry Analytics Dashboard (`/dashboard/`)
- **Live Leaflet & OpenStreetMap**: Interactive dark-themed map tracking the blind user's live position, route polyline, and hazard alert markers.
- **Real-Time Telemetry HUD**: Walking speed (m/s), compass bearing, distance walked/remaining, battery level, and GPS accuracy.
- **2D Radar Mirror**: Caregivers can monitor camera obstacle scans in real time.
- **Caregiver Remote Dispatch**: Send custom voice instructions directly to the blind user's earphones or trigger an Emergency SOS alarm.
- **Historical Logs**: Tables tracking trip journeys, completed arrivals, and hazard encounter logs.

### 5. 📷 Camera Road Navigation & Obstacle Guidance
- **TensorFlow.js COCO-SSD**: Real-time on-device obstacle warnings (*"Warning! Person ahead, 2 meters! Stop or step aside."* / *"መኪና በቀኝ በኩል አለ"* / *"Namni fuuldura keessan jira"*).
- **Gemini Multimodal Vision**: Surface hazard inspection (potholes, ditches, open trenches, stairs).
- **Arrival Announcement**: Celebratory voice fanfare and tactile vibration when destination is reached.

---

## 🛠️ Tech Stack
- **Frontend**: HTML5, CSS3 (Cyberpunk High-Contrast Accessibility Theme), JavaScript (Web Speech API, Web Audio API, HTML5 Canvas 2D, Leaflet.js, TensorFlow.js).
- **Backend**: Python 3.14 + Django 6.0.
- **Database**: SQLite with `NavigationSession`, `HazardLog`, and `CaregiverAlert` models + Firebase Firestore sync.
- **AI / Vision**: Google Gemini API (`google-genai`).

---

## 🚀 How to Run

1. **Start the Django Server**:
   ```bash
   python manage.py runserver 0.0.0.0:8000
   ```

2. **Open in Browser**:
   - **Voice Navigator (Blind User View)**: `http://localhost:8000/`
   - **Caregiver & Telemetry Dashboard**: `http://localhost:8000/dashboard/`
   - **On Mobile Phone**: Connect to the same Wi-Fi and open `http://<YOUR_COMPUTER_IP>:8000`

3. **How to Use**:
   - Just open the app — the voice assistant starts speaking hands-free!
   - Say your preferred language (**English**, **Amharic**, or **Afaan Oromoo**).
   - Say where you want to go (e.g. *"St. George Church"*, *"Bole Hotel"*, *"ገበያ"*, *"suuqii"*).
   - Point your phone forward — the app guides your steps until you arrive safely!

---

## ⚙️ Adding Gemini & Firebase (When Ready)

- **Gemini API Key**: Set `GEMINI_API_KEY` in your environment, or paste it in the in-app settings modal (⚙️).
- **Firebase**: Drop your `firebase_credentials.json` file into this folder to automatically sync trips and hazard logs to Firebase Firestore.
