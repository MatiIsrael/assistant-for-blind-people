# 👁️ VisionNav - Voice-First Navigation Assistant for the Blind

An eyes-free, voice-controlled assistive web application tailored for blind pedestrians in Ethiopia.

The user talks directly to the application and listens to its voice replies — **no typing or reading required**.

---

## 🌟 Features

### 1. 🗣️ Trilingual Voice Interaction
- **Afaan Oromoo**, **Amharic (አማርኛ)**, and **English**.
- Upon opening, the app greets the user and asks by voice in all 3 languages to select their preferred language.
- Once selected, all subsequent interaction, alerts, and navigation guidance continue seamlessly in that language.

### 2. 📍 Voice Destination Setting
- Asks the user where they want to go (e.g. hotel, church, shop, market, hospital, or any custom location).
- Understands natural spoken destinations in Afaan Oromoo, Amharic, or English (powered by Gemini NLP or local rule extractor).
- Confirms the destination and prepares the walking route.

### 3. 📷 Camera Road Navigation & Obstacle Guidance
- Activates the phone's camera (rear environment lens).
- **Real-Time Obstacle Detection**: Detects people, vehicles, carts, bikes, and obstacles directly on device using TensorFlow.js COCO-SSD with instant audio warnings (e.g., *"Warning! Person ahead, 2 meters! Stop or step aside."* / *"መኪና በቀኝ በኩል አለ"* / *"Namni fuuldura keessan jira"*).
- **Gemini Multimodal Vision**: Inspects camera snapshots for surface hazards like holes, open ditches, potholes, and stairs.
- **Walking Progress**: Automatically measures and speaks how many meters have been walked and how many meters remain to the destination.
- **Arrival Announcement**: Announces arrival with sound and vibration when the destination is reached.

---

## 🛠️ Tech Stack
- **Frontend**: HTML5, CSS3 (high-contrast accessibility theme), JavaScript (Web Speech API, Web Audio API, Canvas, TensorFlow.js).
- **Backend**: Python 3.14 + Django 6.0.
- **Database**: Firebase Firestore (`firebase-admin`) + local SQLite fallback.
- **AI / Vision**: Google Gemini API (`google-genai`).

---

## 🚀 How to Run

1. **Start the Django Server**:
   ```bash
   python manage.py runserver 0.0.0.0:8000
   ```

2. **Open in Browser**:
   - On PC: Open `http://localhost:8000`
   - On Phone: Connect phone to the same Wi-Fi and open `http://<YOUR_COMPUTER_IP>:8000`

3. **How to Use**:
   - Tap anywhere on the screen to begin.
   - Speak your preferred language (**English**, **Amharic**, or **Afaan Oromoo**).
   - Say where you want to go (e.g. *"St. George Church"*, *"Bole Hotel"*, *"ገበያ"*, *"suuqii"*).
   - Hold the phone facing forward — the app guides your steps until you arrive!

---

## ⚙️ Adding Gemini & Firebase (When Ready)

- **Gemini API Key**: Set `GEMINI_API_KEY` in your environment, or paste it in the in-app settings modal (⚙️).
- **Firebase**: Drop your `firebase_credentials.json` file into this folder to automatically sync trips and hazard logs to Firebase Firestore.
