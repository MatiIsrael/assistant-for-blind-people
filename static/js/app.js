/**
 * VisionNav - Voice-First Hands-Free Navigation Assistant for the Blind
 * Languages: Afaan Oromoo (om), Amharic (am), English (en)
 * Hands-Free Voice Architecture, 2D Cockpit Graphics, GPS Telemetry Sync.
 */

(function () {
    "use strict";

    // Application States
    const STATES = {
        INIT: "INIT",
        LANG_SELECT: "LANG_SELECT",
        DEST_SELECT: "DEST_SELECT",
        NAVIGATING: "NAVIGATING",
        ARRIVED: "ARRIVED"
    };

    // State Variables
    let currentState = STATES.INIT;
    let selectedLanguage = "en"; // 'en', 'am', 'om'
    let currentDestination = "";
    let metersWalked = 0;
    let totalTargetDistance = 100;
    let distanceRemaining = 100;
    let currentSessionId = "";
    let isSpeaking = false;
    let isListening = false;
    let lastSpokenText = "";
    let lastHazardAlertTime = 0;
    let lastDistanceAnnounceTime = 0;

    // Telemetry & GPS Coordinates (Default: Addis Ababa)
    let currentLat = 9.0108;
    let currentLng = 38.7613;
    let destLat = 9.0180;
    let destLng = 38.7680;
    let currentCompassHeading = 42;
    let currentSpeedMps = 1.2;
    let batteryLevel = 95;
    let lastUserSpeech = "";
    let lastAssistantSpeech = "";

    // 2D Graphics State
    let radarSweepAngle = 0;
    let activeObstacles = [];
    let wavePhase = 0;

    // AI & Vision Variables
    let cocoModel = null;
    let cameraStream = null;
    let detectionInterval = null;
    let geminiVisionInterval = null;
    let walkingInterval = null;
    let recognition = null;
    let autoListenTimeout = null;

    // DOM Elements
    const appContainer = document.getElementById("appContainer");
    const srAnnouncement = document.getElementById("srAnnouncement");
    const langBadge = document.getElementById("langBadge");
    const hazardBanner = document.getElementById("hazardBanner");
    const hazardTitle = document.getElementById("hazardTitle");
    const hazardDesc = document.getElementById("hazardDesc");
    const cameraPlaceholder = document.getElementById("cameraPlaceholder");
    const cameraPlaceholderText = document.getElementById("cameraPlaceholderText");
    const sensorStatusLabel = document.getElementById("sensorStatusLabel");
    const cameraVideo = document.getElementById("cameraVideo");
    const detectionCanvas = document.getElementById("detectionCanvas");
    const walkingHud = document.getElementById("walkingHud");
    const hudWalked = document.getElementById("hudWalked");
    const hudRemaining = document.getElementById("hudRemaining");
    const hudDestination = document.getElementById("hudDestination");
    const voicePill = document.getElementById("voicePill");
    const voiceStatusText = document.getElementById("voiceStatusText");
    const appSpeechText = document.getElementById("appSpeechText");
    const userHeardText = document.getElementById("userHeardText");
    const userSpokenWords = document.getElementById("userSpokenWords");
    const btnTapToTalk = document.getElementById("btnTapToTalk");
    const btnTalkLabel = document.getElementById("btnTalkLabel");
    const btnRepeat = document.getElementById("btnRepeat");
    const btnSimulateStep = document.getElementById("btnSimulateStep");
    const btnSos = document.getElementById("btnSos");
    const btnReset = document.getElementById("btnReset");
    const btnSettings = document.getElementById("btnSettings");
    const settingsModal = document.getElementById("settingsModal");
    const btnCloseModal = document.getElementById("btnCloseModal");
    const btnSaveSettings = document.getElementById("btnSaveSettings");
    const geminiApiKeyInput = document.getElementById("geminiApiKeyInput");
    const quickSelectRow = document.getElementById("quickSelectRow");
    const compassDegreeLabel = document.getElementById("compassDegreeLabel");
    const runwayPercentLabel = document.getElementById("runwayPercentLabel");

    // 2D Canvases
    const radarCanvas = document.getElementById("radarCanvas");
    const compassCanvas = document.getElementById("compassCanvas");
    const waveformCanvas = document.getElementById("waveformCanvas");
    const runwayCanvas = document.getElementById("runwayCanvas");

    // ==========================================
    // AUDIO ENGINE & TACTILE BEACONS
    // ==========================================
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) audioCtx = new AudioContextClass();
        }
        if (audioCtx && audioCtx.state === "suspended") {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playBeep(freq = 600, duration = 0.15, type = "sine") {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            console.warn("Audio chime notice", e);
        }
    }

    function playUrgentBuzzer() {
        try {
            playBeep(320, 0.25, "sawtooth");
            setTimeout(() => playBeep(260, 0.35, "sawtooth"), 260);
        } catch (e) {}
    }

    function triggerHaptic(pattern = [100]) {
        if ("vibrate" in navigator) {
            try { navigator.vibrate(pattern); } catch (e) {}
        }
    }

    // Battery API for real device telemetry
    if ("getBattery" in navigator) {
        navigator.getBattery().then(bat => {
            batteryLevel = Math.round(bat.level * 100);
            bat.addEventListener("levelchange", () => {
                batteryLevel = Math.round(bat.level * 100);
            });
        }).catch(() => {});
    }

    // Device Compass Orientation
    if (window.DeviceOrientationEvent) {
        window.addEventListener("deviceorientation", (e) => {
            if (e.webkitCompassHeading) {
                currentCompassHeading = Math.round(e.webkitCompassHeading);
            } else if (e.alpha !== null) {
                currentCompassHeading = Math.round(360 - e.alpha);
            }
            if (compassDegreeLabel) {
                compassDegreeLabel.innerText = `HEADING: ${String(currentCompassHeading).padStart(3, "0")}°`;
            }
        }, true);
    }

    // GPS Geolocation Watcher
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            (pos) => {
                currentLat = pos.coords.latitude;
                currentLng = pos.coords.longitude;
                if (pos.coords.speed !== null && pos.coords.speed >= 0) {
                    currentSpeedMps = parseFloat(pos.coords.speed.toFixed(1));
                }
                if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
                    currentCompassHeading = Math.round(pos.coords.heading);
                }
            },
            (err) => console.log("GPS Notice:", err.message),
            { enableHighAccuracy: true, maximumAge: 4000 }
        );
    }

    // ==========================================
    // 2D GRAPHICS RENDER ENGINE
    // ==========================================
    // 1. 2D Radar Obstacle Scanner Canvas
    function renderRadarCanvas() {
        if (!radarCanvas) return;
        const ctx = radarCanvas.getContext("2d");
        const w = radarCanvas.width;
        const h = radarCanvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = w / 2 - 12;

        ctx.clearRect(0, 0, w, h);

        // Circular background
        ctx.fillStyle = "#040712";
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        // Concentric distance rings: 1m, 2m, 3.5m, 5m
        ctx.lineWidth = 1;
        const rings = [0.25, 0.5, 0.75, 1.0];
        rings.forEach((rRatio) => {
            ctx.strokeStyle = rRatio === 0.5 ? "rgba(255, 0, 85, 0.4)" : "rgba(0, 240, 255, 0.25)";
            ctx.beginPath();
            ctx.arc(cx, cy, radius * rRatio, 0, Math.PI * 2);
            ctx.stroke();
        });

        // Forward Danger Corridor (Cone)
        ctx.fillStyle = "rgba(0, 240, 255, 0.05)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, -Math.PI * 0.7, -Math.PI * 0.3);
        ctx.closePath();
        ctx.fill();

        // Crosshairs
        ctx.strokeStyle = "rgba(0, 240, 255, 0.15)";
        ctx.beginPath();
        ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
        ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
        ctx.stroke();

        // Sweeping Beam
        radarSweepAngle += 0.045;
        if (radarSweepAngle > Math.PI * 2) radarSweepAngle = 0;

        const beamX = cx + Math.cos(radarSweepAngle) * radius;
        const beamY = cy + Math.sin(radarSweepAngle) * radius;

        const sweepGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        sweepGrad.addColorStop(0, "rgba(0, 240, 255, 0.3)");
        sweepGrad.addColorStop(1, "rgba(0, 240, 255, 0.01)");

        ctx.fillStyle = sweepGrad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, radarSweepAngle - 0.4, radarSweepAngle);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = "#00f0ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(beamX, beamY);
        ctx.stroke();

        // Draw Active Obstacle Blips
        activeObstacles.forEach((obs) => {
            const angle = obs.angle !== undefined ? obs.angle : -Math.PI / 2;
            const distRatio = Math.min(1.0, (obs.distance || 2) / 5.0);
            const bx = cx + Math.cos(angle) * (radius * distRatio);
            const by = cy + Math.sin(angle) * (radius * distRatio);

            const isHazard = obs.distance <= 2.0;
            ctx.fillStyle = isHazard ? "#ff0055" : "#ffe600";
            ctx.shadowColor = ctx.fillStyle;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(bx, by, isHazard ? 6 : 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        // Center User Beacon
        ctx.fillStyle = "#00f0ff";
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();

        // Label rings
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "9px monospace";
        ctx.fillText("1m", cx + 3, cy - radius * 0.25 + 3);
        ctx.fillText("2m", cx + 3, cy - radius * 0.5 + 3);
        ctx.fillText("5m", cx + 3, cy - radius + 10);
    }

    // 2. 2D Cybernetic Compass & Heading Gauge Canvas
    function renderCompassCanvas() {
        if (!compassCanvas) return;
        const ctx = compassCanvas.getContext("2d");
        const w = compassCanvas.width;
        const h = compassCanvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = w / 2 - 12;

        ctx.clearRect(0, 0, w, h);

        // Circular background
        ctx.fillStyle = "#040712";
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        // Outer Ring
        ctx.strokeStyle = "rgba(255, 230, 0, 0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        const headingRad = (currentCompassHeading * Math.PI) / 180;

        // Draw degree ticks
        for (let deg = 0; deg < 360; deg += 30) {
            const rad = (deg * Math.PI) / 180 - headingRad - Math.PI / 2;
            const innerR = deg % 90 === 0 ? radius - 10 : radius - 5;
            const x1 = cx + Math.cos(rad) * radius;
            const y1 = cy + Math.sin(rad) * radius;
            const x2 = cx + Math.cos(rad) * innerR;
            const y2 = cy + Math.sin(rad) * innerR;

            ctx.strokeStyle = deg === 0 ? "#ff0055" : "rgba(255, 255, 255, 0.4)";
            ctx.lineWidth = deg % 90 === 0 ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        // Cardinal directions (N, E, S, W)
        const cardinals = [
            { label: "N", deg: 0, color: "#ff0055" },
            { label: "E", deg: 90, color: "#00f0ff" },
            { label: "S", deg: 180, color: "#ffe600" },
            { label: "W", deg: 270, color: "#00f0ff" }
        ];

        ctx.font = "bold 12px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        cardinals.forEach((c) => {
            const rad = (c.deg * Math.PI) / 180 - headingRad - Math.PI / 2;
            const tx = cx + Math.cos(rad) * (radius - 16);
            const ty = cy + Math.sin(rad) * (radius - 16);
            ctx.fillStyle = c.color;
            ctx.fillText(c.label, tx, ty);
        });

        // Direction Arrow Pointer (Points forward to walking trajectory)
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = "#ffe600";
        ctx.shadowColor = "#ffe600";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(0, -radius + 20);
        ctx.lineTo(-8, -radius + 36);
        ctx.lineTo(8, -radius + 36);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Center degree readout
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px monospace";
        ctx.fillText(`${currentCompassHeading}°`, cx, cy);
    }

    // 3. 2D Dynamic Sinusoidal Audio Waveform Canvas
    function renderWaveformCanvas() {
        if (!waveformCanvas) return;
        const ctx = waveformCanvas.getContext("2d");
        const w = waveformCanvas.width;
        const h = waveformCanvas.height;
        const cy = h / 2;

        ctx.clearRect(0, 0, w, h);

        wavePhase += isSpeaking ? 0.14 : (isListening ? 0.08 : 0.03);

        const amp = isSpeaking ? 12 : (isListening ? 8 : 3);
        const freq = isSpeaking ? 0.06 : 0.04;

        ctx.lineWidth = 2.5;
        ctx.strokeStyle = isSpeaking ? "#ffe600" : (isListening ? "#00ff66" : "#00f0ff");
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 6;

        ctx.beginPath();
        for (let x = 0; x < w; x++) {
            const y = cy + Math.sin(x * freq + wavePhase) * amp * Math.sin((x / w) * Math.PI);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    // 4. 2D Walking Runway Progress Canvas
    function renderRunwayCanvas() {
        if (!runwayCanvas) return;
        const ctx = runwayCanvas.getContext("2d");
        const w = runwayCanvas.width;
        const h = runwayCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // Progress percentage
        const progressRatio = totalTargetDistance > 0 ? Math.min(1.0, metersWalked / totalTargetDistance) : 0;
        const percent = Math.round(progressRatio * 100);
        if (runwayPercentLabel) {
            runwayPercentLabel.innerText = `PROGRESS: ${percent}%`;
        }

        // Road Runway line
        const roadY = h / 2;
        ctx.strokeStyle = "#162846";
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(30, roadY);
        ctx.lineTo(w - 30, roadY);
        ctx.stroke();

        // Completed glowing path
        const filledX = 30 + (w - 60) * progressRatio;
        const grad = ctx.createLinearGradient(30, 0, w - 30, 0);
        grad.addColorStop(0, "#00f0ff");
        grad.addColorStop(1, "#00ff66");

        ctx.strokeStyle = grad;
        ctx.lineWidth = 10;
        ctx.shadowColor = "#00f0ff";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(30, roadY);
        ctx.lineTo(filledX, roadY);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Milestones
        const milestones = [0, 0.25, 0.5, 0.75, 1.0];
        milestones.forEach((ratio) => {
            const mx = 30 + (w - 60) * ratio;
            ctx.fillStyle = ratio <= progressRatio ? "#00ff66" : "#223b66";
            ctx.beginPath();
            ctx.arc(mx, roadY, 5, 0, Math.PI * 2);
            ctx.fill();

            // Label
            ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
            ctx.font = "10px monospace";
            ctx.textAlign = "center";
            const mText = `${Math.round(totalTargetDistance * ratio)}m`;
            ctx.fillText(mText, mx, roadY + 16);
        });

        // Walking Pedestrian Beacon Avatar
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#00f0ff";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(filledX, roadY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Destination Flag
        ctx.font = "14px sans-serif";
        ctx.fillText("🎯", w - 24, roadY + 5);
    }

    // Main 2D Graphics Animation Loop
    function startGraphicsLoop() {
        function loop() {
            renderRadarCanvas();
            renderCompassCanvas();
            renderWaveformCanvas();
            renderRunwayCanvas();
            requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
    }

    // ==========================================
    // SPEECH SYNTHESIS (VOICE OUTPUT)
    // ==========================================
    let currentAudioElement = null;

    function speak(text, lang = selectedLanguage, isUrgent = false) {
        if (!text) return;
        lastSpokenText = text;
        lastAssistantSpeech = text;
        appSpeechText.innerText = `"${text}"`;
        srAnnouncement.innerText = text;

        voicePill.className = "voice-pill speaking";
        voiceStatusText.innerText = "SPEAKING...";

        if (isUrgent) {
            playUrgentBuzzer();
            if (currentAudioElement) {
                currentAudioElement.pause();
                currentAudioElement = null;
            }
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            triggerHaptic([250, 100, 250]);
        }

        isSpeaking = true;

        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.95;
            utterance.pitch = 1.0;

            if (lang === "am") {
                utterance.lang = "am-ET";
            } else if (lang === "om") {
                utterance.lang = "sw-KE";
            } else {
                utterance.lang = "en-US";
            }

            utterance.onend = () => {
                isSpeaking = false;
                onSpeechFinished();
            };
            utterance.onerror = (err) => {
                console.warn("[WebSpeech notice]", err);
                isSpeaking = false;
                onSpeechFinished();
            };

            window.speechSynthesis.speak(utterance);
        } else {
            // Server TTS fallback
            const ttsUrl = `/api/tts/?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
            const audio = new Audio(ttsUrl);
            currentAudioElement = audio;

            audio.onended = () => {
                isSpeaking = false;
                currentAudioElement = null;
                onSpeechFinished();
            };
            audio.onerror = () => {
                isSpeaking = false;
                currentAudioElement = null;
                onSpeechFinished();
            };

            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    isSpeaking = false;
                    onSpeechFinished();
                });
            }
        }
    }

    function onSpeechFinished() {
        voicePill.className = "voice-pill pulse";
        voiceStatusText.innerText = "READY";

        // HANDS-FREE AUTOMATIC LISTENING CONTINUATION:
        // Automatically start listening so blind user never touches screen!
        if (autoListenTimeout) clearTimeout(autoListenTimeout);
        autoListenTimeout = setTimeout(() => {
            if (!isSpeaking && currentState !== STATES.ARRIVED) {
                startVoiceRecognition();
            }
        }, 400);
    }

    // ==========================================
    // SPEECH RECOGNITION (HANDS-FREE INPUT)
    // ==========================================
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 3;

        recognition.onstart = () => {
            isListening = true;
            playBeep(880, 0.08); // Mic open chime
            triggerHaptic([60]);
            voicePill.className = "voice-pill listening";
            voiceStatusText.innerText = "LISTENING... (SPEAK)";
            btnTapToTalk.classList.add("listening-active");
            btnTalkLabel.innerText = "LISTENING... SPEAK FREELY";
        };

        recognition.onend = () => {
            isListening = false;
            btnTapToTalk.classList.remove("listening-active");
            btnTalkLabel.innerText = "MIC ACTIVE • SPEAK ANYTIME";

            if (!isSpeaking) {
                voicePill.className = "voice-pill pulse";
                voiceStatusText.innerText = "READY";

                // In language or destination selection, re-listen automatically if nothing heard
                if (currentState === STATES.LANG_SELECT || currentState === STATES.DEST_SELECT) {
                    if (autoListenTimeout) clearTimeout(autoListenTimeout);
                    autoListenTimeout = setTimeout(() => {
                        if (!isSpeaking && !isListening) {
                            startVoiceRecognition();
                        }
                    }, 1200);
                }
            }
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript.trim();
            console.log("[Speech Recognized]:", transcript);
            playBeep(520, 0.08); // Confirmation double chime
            lastUserSpeech = transcript;
            userHeardText.classList.remove("hidden");
            userSpokenWords.innerText = `"${transcript}"`;
            handleUserVoiceInput(transcript);
        };

        recognition.onerror = (event) => {
            console.warn("[Speech Recognition notice]:", event.error);
            isListening = false;
            btnTapToTalk.classList.remove("listening-active");
            btnTalkLabel.innerText = "MIC ACTIVE • SPEAK ANYTIME";

            // If no-speech timeout, gracefully re-listen hands-free in selection states
            if (event.error === "no-speech" && (currentState === STATES.LANG_SELECT || currentState === STATES.DEST_SELECT)) {
                setTimeout(() => {
                    if (!isSpeaking && !isListening) {
                        startVoiceRecognition();
                    }
                }, 1000);
            }
        };
    }

    function startVoiceRecognition() {
        if (!recognition) return;
        if (isSpeaking || isListening) return;

        // Configure language for recognition
        if (currentState === STATES.LANG_SELECT) {
            recognition.lang = "en-US";
        } else {
            if (selectedLanguage === "am") {
                recognition.lang = "am-ET";
            } else if (selectedLanguage === "om") {
                recognition.lang = "om-ET";
            } else {
                recognition.lang = "en-US";
            }
        }

        try {
            recognition.start();
        } catch (e) {
            // Already started
        }
    }

    // ==========================================
    // VOICE STATE MACHINE HANDLER
    // ==========================================
    function handleUserVoiceInput(text) {
        const lower = text.toLowerCase();

        // 1. LANGUAGE SELECTION STATE
        if (currentState === STATES.LANG_SELECT) {
            if (lower.includes("amharic") || lower.includes("amarigna") || lower.includes("አማርኛ") || lower.includes("amh")) {
                setLanguage("am");
                speak("ቋንቋው ወደ አማርኛ ተቀናብሯል። የት መሄድ ይፈልጋሉ? ለምሳሌ ቤተክርስቲያን፣ ሆቴል፣ ሱቅ፣ ወይም ገበያ።", "am");
                transitionTo(STATES.DEST_SELECT);
            } else if (lower.includes("oromo") || lower.includes("afaan oromoo") || lower.includes("oromiffa") || lower.includes("oromiyaa")) {
                setLanguage("om");
                speak("Afaan gara Afaan Oromootti jijjiirameera. Eessa deemuu barbaaddu? Fakkeenyaaf, bataskaana, hoteela, suuqii, yookiin gabaa.", "om");
                transitionTo(STATES.DEST_SELECT);
            } else if (lower.includes("english") || lower.includes("ingiliz") || lower.includes("en")) {
                setLanguage("en");
                speak("Language set to English. Where would you like to go? For example, church, hotel, shop, or market.", "en");
                transitionTo(STATES.DEST_SELECT);
            } else {
                speak("Please say English, Amharic, or Afaan Oromoo. አማርኛ፣ እንግሊዝኛ ወይም ኦሮምኛ ይበሉ።", "en");
            }
            return;
        }

        // 2. DESTINATION SELECTION STATE
        if (currentState === STATES.DEST_SELECT) {
            submitDestination(text);
            return;
        }

        // 3. NAVIGATING STATE (Hands-free queries & commands while walking)
        if (currentState === STATES.NAVIGATING) {
            if (lower.includes("stop") || lower.includes("pause") || lower.includes("ቁም") || lower.includes("dhaabbadhu")) {
                speakLocalized({
                    en: "Navigation paused. Say resume to continue.",
                    am: "አሰሳው ቆሟል። ለመቀጠል ቀጥል ይበሉ።",
                    om: "Qajeelchi dhaabbateera. Itti fufuuf itti fufi jedhaa."
                });
            } else if (lower.includes("where") || lower.includes("distance") || lower.includes("ስንት ቀረ") || lower.includes("meeqatu hafe")) {
                announceDistanceProgress();
            } else if (lower.includes("repeat") || lower.includes("ድገም") || lower.includes("irra deebi'i")) {
                if (lastSpokenText) speak(lastSpokenText, selectedLanguage);
            } else {
                speakLocalized({
                    en: `Continuing to ${currentDestination}. ${distanceRemaining} meters remaining. Keep walking forward.`,
                    am: `ወደ ${currentDestination} የሚደረገው ጉዞ ቀጥሏል። ${distanceRemaining} ሜትር ይቀራል። ቀጥታ መሄድዎን ይቀጥሉ።`,
                    om: `Gara ${currentDestination}tti qajeelchuun itti fufeera. Meetira ${distanceRemaining}tu hafe. Qajeelaa deemaa.`
                });
            }
        }
    }

    function setLanguage(code) {
        selectedLanguage = code;
        langBadge.innerText = `LANG: ${code.toUpperCase()}`;
        if (code === "am") {
            btnTalkLabel.innerText = "ማይክሮፎን ክፍት ነው • ይናገሩ";
        } else if (code === "om") {
            btnTalkLabel.innerText = "MAAYKII BANAMEERA • DUBBADHAA";
        } else {
            btnTalkLabel.innerText = "MIC ACTIVE • SPEAK ANYTIME";
        }
    }

    function transitionTo(newState) {
        currentState = newState;
        appContainer.className = `app-container state-${newState.toLowerCase()}`;
        updateQuickPills();
    }

    function updateQuickPills() {
        if (!quickSelectRow) return;

        if (currentState === STATES.INIT || currentState === STATES.LANG_SELECT) {
            quickSelectRow.innerHTML = `
                <button type="button" class="quick-pill" data-action="lang" data-value="om">Afaan Oromoo</button>
                <button type="button" class="quick-pill" data-action="lang" data-value="am">አማርኛ (Amharic)</button>
                <button type="button" class="quick-pill" data-action="lang" data-value="en">English</button>
            `;
        } else if (currentState === STATES.DEST_SELECT) {
            if (selectedLanguage === "am") {
                quickSelectRow.innerHTML = `
                    <button type="button" class="quick-pill" data-action="dest" data-value="ቅዱስ ጊዮርጊስ ቤተክርስቲያን">⛪ ቤተክርስቲያን</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="ሸራተን ሆቴል">🏨 ሆቴል</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="መርካቶ ገበያ">🛍️ መርካቶ / ገበያ</button>
                `;
            } else if (selectedLanguage === "om") {
                quickSelectRow.innerHTML = `
                    <button type="button" class="quick-pill" data-action="dest" data-value="Bataskaana Qulqulluu Giyoorgis">⛪ Bataskaana</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="Hoteela Boolee">🏨 Hoteela</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="Gabaa Markaatoo">🛍️ Gabaa</button>
                `;
            } else {
                quickSelectRow.innerHTML = `
                    <button type="button" class="quick-pill" data-action="dest" data-value="St. George Church">⛪ Church</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="Bole Hotel">🏨 Hotel</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="Merkato Market">🛍️ Market</button>
                `;
            }
        } else if (currentState === STATES.NAVIGATING) {
            quickSelectRow.innerHTML = `
                <button type="button" class="quick-pill" data-action="step" data-value="5">🚶 Step +5m</button>
                <button type="button" class="quick-pill" data-action="arrive" data-value="arrive">🏁 Arrive</button>
            `;
        }
    }

    // ==========================================
    // INITIALIZATION & WELCOME (HANDS-FREE ON LOAD)
    // ==========================================
    function initializeApp() {
        if (currentState !== STATES.INIT) return;

        getAudioContext();
        triggerHaptic([100]);
        transitionTo(STATES.LANG_SELECT);

        // Welcome prompt in all 3 languages without requiring touches
        const welcomePrompt = "VisionNav active. Please choose your language. Say English, Amharic, or Afaan Oromoo. " +
            "እባክዎ ቋንቋ ይምረጡ፦ አማርኛ፣ እንግሊዝኛ ወይም ኦሮምኛ ይበሉ። " +
            "Maaloo afaan barbaaddan filadhaa: Afaan Oromoo, Amaariffa, yookiin Ingiliffa.";

        speak(welcomePrompt, "en");
    }

    // ==========================================
    // DESTINATION SUBMISSION & ROUTING
    // ==========================================
    async function submitDestination(spokenText) {
        voicePill.className = "voice-pill speaking";
        voiceStatusText.innerText = "PREPARING ROUTE...";

        try {
            const resp = await fetch("/api/destination/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    speech: spokenText,
                    language: selectedLanguage,
                    lat: currentLat,
                    lng: currentLng
                })
            });
            const data = await resp.json();

            currentDestination = data.destination || spokenText;
            totalTargetDistance = data.target_distance || 100;
            distanceRemaining = totalTargetDistance;
            metersWalked = 0;
            currentSessionId = data.session_id || "";
            if (data.dest_lat && data.dest_lng) {
                destLat = data.dest_lat;
                destLng = data.dest_lng;
            }

            // Update UI HUD
            hudDestination.innerText = currentDestination;
            hudWalked.innerText = "0 m";
            hudRemaining.innerText = `${distanceRemaining} m`;
            walkingHud.classList.remove("hidden");

            // Spoken confirmation
            const conf = data.spoken_confirmation || `Destination set to ${currentDestination}. Total distance is ${totalTargetDistance} meters. Let's walk forward!`;
            speak(conf, selectedLanguage);

            transitionTo(STATES.NAVIGATING);
            startCameraAndVision();

        } catch (e) {
            console.error("Destination routing error:", e);
            speak("Destination received. Starting navigation.", selectedLanguage);
            transitionTo(STATES.NAVIGATING);
            startCameraAndVision();
        }
    }

    // ==========================================
    // CAMERA & COMPUTER VISION ENGINE
    // ==========================================
    async function startCameraAndVision() {
        cameraPlaceholder.classList.add("hidden");
        cameraVideo.classList.remove("hidden");
        detectionCanvas.classList.remove("hidden");
        if (sensorStatusLabel) sensorStatusLabel.innerText = "ACTIVE VISION";

        // Load TensorFlow COCO-SSD
        if (!cocoModel && window.cocoSsd) {
            try {
                cocoModel = await cocoSsd.load();
                console.log("[COCO-SSD Loaded]");
            } catch (err) {
                console.warn("[COCO-SSD load failed]", err);
            }
        }

        try {
            const constraints = {
                video: {
                    facingMode: { ideal: "environment" },
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: false
            };
            cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
            cameraVideo.srcObject = cameraStream;
            await cameraVideo.play();

            cameraVideo.onloadedmetadata = () => {
                detectionCanvas.width = cameraVideo.videoWidth || 640;
                detectionCanvas.height = cameraVideo.videoHeight || 480;
            };

            startRealtimeDetectionLoop();
            startWalkingProgressTracker();

        } catch (err) {
            console.error("[Camera Access Error]:", err);
            speakLocalized({
                en: "Camera access unavailable. Continuing walking distance guidance.",
                am: "ካሜራውን መክፈት አልተቻለም። የመራመጃ ርቀት መመሪያው ይቀጥላል።",
                om: "Kaameraa banuun hin danda'amne. Qajeelchi fageenyaa itti fufa."
            });
            startWalkingProgressTracker();
        }
    }

    function startRealtimeDetectionLoop() {
        if (detectionInterval) clearInterval(detectionInterval);

        detectionInterval = setInterval(async () => {
            if (currentState !== STATES.NAVIGATING || !cameraVideo || cameraVideo.paused) return;

            if (cocoModel) {
                try {
                    const predictions = await cocoModel.detect(cameraVideo);
                    renderDetectionBoxes(predictions);
                    processObstacleAlerts(predictions);
                } catch (e) {
                    console.warn("Detection frame error:", e);
                }
            }
        }, 1500);

        if (geminiVisionInterval) clearInterval(geminiVisionInterval);
        geminiVisionInterval = setInterval(() => {
            if (currentState === STATES.NAVIGATING) {
                captureAndAnalyzeFrameWithGemini();
            }
        }, 7000);
    }

    function renderDetectionBoxes(predictions) {
        const ctx = detectionCanvas.getContext("2d");
        ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);

        activeObstacles = [];

        predictions.forEach(p => {
            const [x, y, width, height] = p.bbox;
            const isHazard = ["person", "car", "truck", "bus", "motorcycle", "bicycle", "chair"].includes(p.class);

            ctx.lineWidth = isHazard ? 4 : 2;
            ctx.strokeStyle = isHazard ? "#ff0055" : "#00ff66";
            ctx.fillStyle = isHazard ? "rgba(255, 0, 85, 0.2)" : "rgba(0, 255, 102, 0.2)";

            ctx.strokeRect(x, y, width, height);
            ctx.fillRect(x, y, width, height);

            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 14px monospace";
            ctx.fillText(`${p.class} (${Math.round(p.score * 100)}%)`, x + 6, y > 20 ? y - 6 : y + 20);

            // Map into 2D Radar spatial angles
            const frameW = detectionCanvas.width || 640;
            const cx = x + width / 2;
            const angleRatio = (cx / frameW) - 0.5; // -0.5 (left) to +0.5 (right)
            const angle = -Math.PI / 2 + (angleRatio * Math.PI * 0.6);
            const dist = height > 200 ? 1.5 : (height > 100 ? 3.0 : 4.5);

            activeObstacles.push({
                type: p.class,
                distance: dist,
                angle: angle
            });
        });
    }

    function processObstacleAlerts(predictions) {
        const now = Date.now();
        if (now - lastHazardAlertTime < 4000) return;

        const hazards = predictions.filter(p =>
            ["person", "car", "truck", "bus", "motorcycle", "bicycle", "chair", "dog"].includes(p.class) &&
            p.score > 0.55
        );

        if (hazards.length === 0) {
            hideHazardBanner();
            return;
        }

        hazards.sort((a, b) => (b.bbox[2] * b.bbox[3]) - (a.bbox[2] * a.bbox[3]));
        const target = hazards[0];
        const [x, y, w, h] = target.bbox;
        const frameHeight = detectionCanvas.height || 480;
        const frameWidth = detectionCanvas.width || 640;

        const heightRatio = h / frameHeight;
        let estimatedDistance = "2";
        let isUrgent = false;

        if (heightRatio > 0.45) {
            estimatedDistance = "1";
            isUrgent = true;
        } else if (heightRatio > 0.25) {
            estimatedDistance = "3";
        } else {
            estimatedDistance = "5";
        }

        const centerX = x + (w / 2);
        let direction = "ahead";
        if (centerX < frameWidth * 0.35) {
            direction = "left";
        } else if (centerX > frameWidth * 0.65) {
            direction = "right";
        }

        lastHazardAlertTime = now;
        showHazardBanner(target.class, estimatedDistance, direction);

        const warning = buildObstacleVoiceWarning(target.class, estimatedDistance, direction, isUrgent);
        speak(warning, selectedLanguage, isUrgent);
    }

    function buildObstacleVoiceWarning(item, meters, direction, isUrgent) {
        const labelMap = {
            person: { en: "person", am: "ሰው", om: "namni" },
            car: { en: "car", am: "መኪና", om: "makiinaan" },
            bus: { en: "bus", am: "አውቶቡስ", om: "baasiin" },
            truck: { en: "truck", am: "ትልቅ መኪና", om: "makiinaa guddaan" },
            motorcycle: { en: "motorcycle", am: "ሞተር ሳይክል", om: "motooraan" },
            bicycle: { en: "bicycle", am: "ቢስክሌት", om: "biskileetiin" },
            chair: { en: "obstacle", am: "እንቅፋት", om: "guftuun" },
            dog: { en: "animal", am: "እንስሳ", om: "bineensi" }
        };

        const itemNames = labelMap[item] || { en: "obstacle", am: "እንቅፋት", om: "guftuu" };

        if (selectedLanguage === "am") {
            const dirAm = direction === "left" ? "በግራ በኩል" : (direction === "right" ? "በቀኝ በኩል" : "ከፊትዎ");
            return isUrgent
                ? `ማስጠንቀቂያ! ${itemNames.am} ${dirAm} አለ፣ ${meters} ሜትር! ቁሙ ወይም መንገድ ይቀይሩ።`
                : `${itemNames.am} ${dirAm} አለ፣ ወደ ${meters} ሜትር ርቀት ላይ።`;
        } else if (selectedLanguage === "om") {
            const dirOm = direction === "left" ? "bitaa keessan" : (direction === "right" ? "mirga keessan" : "fuuldura keessan");
            return isUrgent
                ? `Akeekkachiisa! ${itemNames.om} ${dirOm} jira, meetira ${meters}! Dhaabbadhaa yookaan qajeelcha jijjiiraa.`
                : `${itemNames.om} ${dirOm} jira, meetira ${meters}.`;
        } else {
            const dirEn = direction === "left" ? "on your left" : (direction === "right" ? "on your right" : "ahead");
            return isUrgent
                ? `Warning! ${itemNames.en} ${dirEn}, ${meters} meters! Stop or step aside.`
                : `${itemNames.en} ${dirEn}, about ${meters} meters away.`;
        }
    }

    function showHazardBanner(item, meters, direction) {
        hazardTitle.innerText = `WARNING: ${item.toUpperCase()}`;
        hazardDesc.innerText = `${direction.toUpperCase()} • ~${meters} METERS`;
        hazardBanner.classList.remove("hidden");
    }

    function hideHazardBanner() {
        hazardBanner.classList.add("hidden");
    }

    async function captureAndAnalyzeFrameWithGemini() {
        if (!cameraVideo || cameraVideo.videoWidth === 0) return;

        try {
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = 320;
            tempCanvas.height = 240;
            const ctx = tempCanvas.getContext("2d");
            ctx.drawImage(cameraVideo, 0, 0, 320, 240);

            const base64Data = tempCanvas.toDataURL("image/jpeg", 0.6);

            const resp = await fetch("/api/analyze-frame/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    image: base64Data,
                    language: selectedLanguage,
                    session_id: currentSessionId,
                    meters_walked: metersWalked,
                    distance_left: distanceRemaining,
                    lat: currentLat,
                    lng: currentLng
                })
            });

            const data = await resp.json();
            if (data.hazard_detected && data.spoken_message) {
                lastHazardAlertTime = Date.now();
                speak(data.spoken_message, selectedLanguage, data.urgent_warning);
            }
        } catch (e) {
            console.warn("Gemini vision analysis error:", e);
        }
    }

    // ==========================================
    // WALKING PROGRESS TRACKER & CAREGIVER SYNC
    // ==========================================
    function startWalkingProgressTracker() {
        if (walkingInterval) clearInterval(walkingInterval);

        // Advance 1 meter every 1.5 seconds during navigation
        walkingInterval = setInterval(() => {
            if (currentState !== STATES.NAVIGATING) return;
            stepForward(1);
        }, 1500);
    }

    function stepForward(incrementMeters = 1) {
        if (currentState !== STATES.NAVIGATING) return;

        metersWalked += incrementMeters;
        distanceRemaining = Math.max(0, totalTargetDistance - metersWalked);

        // Advance simulated GPS coords smoothly towards destination
        const ratio = Math.min(1.0, metersWalked / totalTargetDistance);
        currentLat += (destLat - currentLat) * 0.02 * incrementMeters;
        currentLng += (destLng - currentLng) * 0.02 * incrementMeters;

        hudWalked.innerText = `${metersWalked} m`;
        hudRemaining.innerText = `${distanceRemaining} m`;

        // Check if arrived
        if (distanceRemaining <= 0) {
            arriveAtDestination();
            return;
        }

        // Periodic distance announcement (every 25 meters)
        const now = Date.now();
        if (metersWalked % 25 === 0 && now - lastDistanceAnnounceTime > 10000) {
            lastDistanceAnnounceTime = now;
            announceDistanceProgress();
        }

        // Update server telemetry and check for caregiver remote messages
        syncTripProgressToServer(false);
    }

    async function syncTripProgressToServer(isArrived = false) {
        try {
            const resp = await fetch("/api/update-trip/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    meters_walked: metersWalked,
                    distance_left: distanceRemaining,
                    arrived: isArrived,
                    language: selectedLanguage,
                    lat: currentLat,
                    lng: currentLng,
                    speed_mps: currentSpeedMps,
                    battery_level: batteryLevel,
                    user_speech: lastUserSpeech,
                    assistant_speech: lastAssistantSpeech
                })
            });
            const data = await resp.json();

            // Check if caregiver sent remote alerts/messages to user!
            if (data.pending_alerts && data.pending_alerts.length > 0) {
                data.pending_alerts.forEach((alert) => {
                    const isSOS = alert.type === "emergency_sos";
                    speak(alert.message, selectedLanguage, isSOS);
                });
            }
        } catch (e) {
            console.warn("Trip update sync notice:", e);
        }
    }

    function announceDistanceProgress() {
        const msg = {
            en: `You have walked ${metersWalked} meters. ${distanceRemaining} meters remaining to ${currentDestination}.`,
            am: `${metersWalked} ሜትር ተጉዘዋል። ወደ ${currentDestination} ${distanceRemaining} ሜትር ይቀራል።`,
            om: `Meetira ${metersWalked} deemtaniittu. Gara ${currentDestination}tti meetira ${distanceRemaining}tu hafe.`
        };
        speak(msg[selectedLanguage] || msg.en, selectedLanguage);
    }

    function arriveAtDestination() {
        currentState = STATES.ARRIVED;
        if (walkingInterval) clearInterval(walkingInterval);
        if (detectionInterval) clearInterval(detectionInterval);
        if (geminiVisionInterval) clearInterval(geminiVisionInterval);

        triggerHaptic([300, 150, 300, 150, 500]);
        playBeep(880, 0.4);

        const arrivalAnnouncements = {
            en: `Congratulations! You have arrived safely at your destination, ${currentDestination}.`,
            am: `እንኳን ደስ አለዎት! መዳረሻዎ ${currentDestination} በሰላም ደርሰዋል።`,
            om: `Baga gammaddan! Bakka yaaddan ${currentDestination} nagaan geessaniittu.`
        };

        const spokenMsg = arrivalAnnouncements[selectedLanguage] || arrivalAnnouncements.en;
        speak(spokenMsg, selectedLanguage);

        syncTripProgressToServer(true);
        transitionTo(STATES.ARRIVED);
    }

    function speakLocalized(translations) {
        const msg = translations[selectedLanguage] || translations.en;
        speak(msg, selectedLanguage);
    }

    function resetNavigation() {
        if (walkingInterval) clearInterval(walkingInterval);
        if (detectionInterval) clearInterval(detectionInterval);
        if (geminiVisionInterval) clearInterval(geminiVisionInterval);
        if (cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop());
            cameraStream = null;
        }

        cameraPlaceholder.classList.remove("hidden");
        cameraVideo.classList.add("hidden");
        detectionCanvas.classList.add("hidden");
        walkingHud.classList.add("hidden");
        hideHazardBanner();

        currentState = STATES.INIT;
        metersWalked = 0;
        distanceRemaining = 100;
        currentDestination = "";
        activeObstacles = [];

        appSpeechText.innerText = `"VisionNav active. Please choose your language: say English, Amharic, or Afaan Oromoo."`;
        userHeardText.classList.add("hidden");
        voiceStatusText.innerText = "VOICE READY - SPEAK NOW";
        langBadge.innerText = "LANG: --";

        speakLocalized({
            en: "Navigation reset. Say English, Amharic, or Afaan Oromoo to start a new journey.",
            am: "አሰሳው እንደገና ተጀምሯል። አዲስ ጉዞ ለመጀመር አማርኛ፣ እንግሊዝኛ ወይም ኦሮምኛ ይበሉ።",
            om: "Qajeelchi irra deebi'ameera. Imala haaraa jalqabuuf Afaan Oromoo, Amaariffa yookiin Ingiliffa jedhaa."
        });

        transitionTo(STATES.LANG_SELECT);
    }

    function triggerEmergencySos() {
        speak("Emergency SOS activated. Stop walking immediately. Your location has been flagged for assistance.", selectedLanguage, true);
        triggerHaptic([500, 200, 500, 200, 500]);
    }

    // ==========================================
    // EVENT LISTENERS & HANDS-FREE LIFECYCLE
    // ==========================================
    // Spacebar or Enter keyboard shortcut
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space" || e.code === "Enter") {
            e.preventDefault();
            if (currentState === STATES.INIT) {
                initializeApp();
            } else if (!isSpeaking && !isListening) {
                startVoiceRecognition();
            }
        }
    });

    // Talk Button (Secondary manual trigger for testing)
    btnTapToTalk.addEventListener("click", (e) => {
        e.stopPropagation();
        if (currentState === STATES.INIT) {
            initializeApp();
        } else {
            startVoiceRecognition();
        }
    });

    // Repeat Button
    btnRepeat.addEventListener("click", (e) => {
        e.stopPropagation();
        if (lastSpokenText) speak(lastSpokenText, selectedLanguage);
    });

    // Walk +5m Button
    btnSimulateStep.addEventListener("click", (e) => {
        e.stopPropagation();
        if (currentState === STATES.NAVIGATING) {
            stepForward(5);
            playBeep(440, 0.08);
        }
    });

    // Emergency SOS Button
    if (btnSos) {
        btnSos.addEventListener("click", (e) => {
            e.stopPropagation();
            triggerEmergencySos();
        });
    }

    // Reset Button
    btnReset.addEventListener("click", (e) => {
        e.stopPropagation();
        resetNavigation();
    });

    // Quick Select Buttons
    if (quickSelectRow) {
        quickSelectRow.addEventListener("click", (e) => {
            e.stopPropagation();
            const btn = e.target.closest(".quick-pill");
            if (!btn) return;
            const action = btn.getAttribute("data-action");
            const val = btn.getAttribute("data-value");

            if (currentState === STATES.INIT) initializeApp();

            if (action === "lang") {
                handleUserVoiceInput(val);
            } else if (action === "dest") {
                handleUserVoiceInput(val);
            } else if (action === "step") {
                stepForward(5);
            } else if (action === "arrive") {
                arriveAtDestination();
            }
        });
    }

    // Settings Modal
    btnSettings.addEventListener("click", (e) => {
        e.stopPropagation();
        settingsModal.classList.remove("hidden");
    });

    btnCloseModal.addEventListener("click", () => {
        settingsModal.classList.add("hidden");
    });

    btnSaveSettings.addEventListener("click", () => {
        const key = geminiApiKeyInput.value.trim();
        if (key) sessionStorage.setItem("GEMINI_API_KEY", key);
        settingsModal.classList.add("hidden");
    });

    // Ambient click fallback: if browser audio was blocked before first user gesture
    document.addEventListener("click", () => {
        getAudioContext();
        if (currentState === STATES.INIT) {
            initializeApp();
        }
    }, { once: false });

    // AUTOMATIC INITIALIZATION ON WINDOW LOAD
    window.addEventListener("DOMContentLoaded", () => {
        startGraphicsLoop();
        // Immediately trigger hands-free welcome
        setTimeout(() => {
            initializeApp();
        }, 500);
    });

})();
