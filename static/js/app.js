/**
 * VisionNav - Voice-First Navigation Assistant for the Blind
 * Languages: Afaan Oromoo (om), Amharic (am), English (en)
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

    // AI & Vision Variables
    let cocoModel = null;
    let cameraStream = null;
    let detectionInterval = null;
    let geminiVisionInterval = null;
    let walkingInterval = null;

    // DOM Elements
    const appContainer = document.getElementById("appContainer");
    const srAnnouncement = document.getElementById("srAnnouncement");
    const langBadge = document.getElementById("langBadge");
    const hazardBanner = document.getElementById("hazardBanner");
    const hazardTitle = document.getElementById("hazardTitle");
    const hazardDesc = document.getElementById("hazardDesc");
    const cameraPlaceholder = document.getElementById("cameraPlaceholder");
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
    const btnReset = document.getElementById("btnReset");
    const btnSettings = document.getElementById("btnSettings");
    const settingsModal = document.getElementById("settingsModal");
    const btnCloseModal = document.getElementById("btnCloseModal");
    const btnSaveSettings = document.getElementById("btnSaveSettings");
    const geminiApiKeyInput = document.getElementById("geminiApiKeyInput");

    // Audio Context for tactile chimes & beeps
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
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            console.warn("Audio chime error", e);
        }
    }

    function triggerHaptic(pattern = [100]) {
        if ("vibrate" in navigator) {
            try { navigator.vibrate(pattern); } catch (e) {}
        }
    }

    // ==========================================
    // SPEECH SYNTHESIS (VOICE OUTPUT)
    // ==========================================
    let currentAudioElement = null;

    function speak(text, lang = selectedLanguage, isUrgent = false) {
        if (!text) return;
        lastSpokenText = text;
        appSpeechText.innerText = `"${text}"`;
        srAnnouncement.innerText = text;

        voicePill.className = "voice-pill speaking";
        voiceStatusText.innerText = "SPEAKING...";

        // If something urgent (hazard), stop any ongoing audio immediately
        if (isUrgent) {
            if (currentAudioElement) {
                currentAudioElement.pause();
                currentAudioElement = null;
            }
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            triggerHaptic([200, 100, 200]);
        }

        isSpeaking = true;

        // Use Web Speech API first for instant 0ms latency speech response
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
            // Server TTS fallback if browser lacks Web Speech API
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

        // Auto-listen when in language or destination selection states
        if (currentState === STATES.LANG_SELECT || currentState === STATES.DEST_SELECT) {
            setTimeout(() => {
                startVoiceRecognition();
            }, 300);
        }
    }

    // ==========================================
    // SPEECH RECOGNITION (VOICE INPUT)
    // ==========================================
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 3;

        recognition.onstart = () => {
            isListening = true;
            playBeep(880, 0.1);
            triggerHaptic([60]);
            voicePill.className = "voice-pill listening";
            voiceStatusText.innerText = "LISTENING...";
            btnTapToTalk.classList.add("listening-active");
            btnTalkLabel.innerText = "LISTENING... (SPEAK)";
        };

        recognition.onend = () => {
            isListening = false;
            btnTapToTalk.classList.remove("listening-active");
            btnTalkLabel.innerText = "TAP TO TALK";
            if (!isSpeaking) {
                voicePill.className = "voice-pill pulse";
                voiceStatusText.innerText = "READY";
            }
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript.trim();
            console.log("[Speech Recognized]:", transcript);
            userHeardText.classList.remove("hidden");
            userSpokenWords.innerText = `"${transcript}"`;
            handleUserVoiceInput(transcript);
        };

        recognition.onerror = (event) => {
            console.warn("[Speech Recognition Error]:", event.error);
            isListening = false;
            btnTapToTalk.classList.remove("listening-active");
            btnTalkLabel.innerText = "TAP TO TALK";
            voicePill.className = "voice-pill";
            voiceStatusText.innerText = "TAP TO RETRY";
        };
    }

    function startVoiceRecognition() {
        if (!recognition) {
            alert("Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
            return;
        }
        if (isSpeaking) {
            // Cancel speech to listen
            if (currentAudioElement) currentAudioElement.pause();
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            isSpeaking = false;
        }

        // Configure language for recognition
        if (currentState === STATES.LANG_SELECT) {
            // Multilingual / English recognition matches language names
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
            console.log("Recognition start skipped or already running", e);
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
                speak("ቋንቋው ወደ አማርኛ ተቀናብሯል። የት መሄድ ይፈልጋሉ? ለምሳሌ ሆቴል፣ ቤተክርስቲያን፣ ሱቅ፣ ወይም ገበያ።", "am");
                transitionTo(STATES.DEST_SELECT);
            } else if (lower.includes("oromo") || lower.includes("afaan oromoo") || lower.includes("oromiffa") || lower.includes("oromiyaa")) {
                setLanguage("om");
                speak("Afaan gara Afaan Oromootti jijjiirameera. Eessa deemuu barbaaddu? Fakkeenyaaf, hoteela, bataskaana, suuqii, yookiin gabaa.", "om");
                transitionTo(STATES.DEST_SELECT);
            } else if (lower.includes("english") || lower.includes("ingiliz") || lower.includes("en")) {
                setLanguage("en");
                speak("Language set to English. Where would you like to go? For example, a hotel, church, shop, market, or any other place.", "en");
                transitionTo(STATES.DEST_SELECT);
            } else {
                // Clarify in 3 languages
                speak("Please say English, Amharic, or Afaan Oromoo. አማርኛ፣ እንግሊዝኛ ወይም ኦሮምኛ ይበሉ።", "en");
            }
            return;
        }

        // 2. DESTINATION SELECTION STATE
        if (currentState === STATES.DEST_SELECT) {
            submitDestination(text);
            return;
        }

        // 3. NAVIGATING STATE (Voice commands while walking)
        if (currentState === STATES.NAVIGATING) {
            if (lower.includes("stop") || lower.includes("pause") || lower.includes("ቁም") || lower.includes("dhaabbadhu")) {
                speakLocalized({
                    en: "Navigation paused. Tap screen to resume.",
                    am: "አሰሳው ለጊዜው ቆሟል። ለመቀጠል ስክሪኑን ይንኩ።",
                    om: "Qajeelchi dhaabbateera. Itti fufuuf iskiriinii tuqaa."
                });
            } else if (lower.includes("where") || lower.includes("distance") || lower.includes("ስንት ቀረ") || lower.includes("meeqatu hafe")) {
                announceDistanceProgress();
            } else {
                speakLocalized({
                    en: `Continuing navigation to ${currentDestination}. Keep walking straight.`,
                    am: `ወደ ${currentDestination} የሚደረገው ጉዞ ቀጥሏል። ቀጥታ መሄድዎን ይቀጥሉ።`,
                    om: `Gara ${currentDestination}tti qajeelchuun itti fufeera. Qajeelaa deemaa.`
                });
            }
        }
    }

    function setLanguage(code) {
        selectedLanguage = code;
        langBadge.innerText = `LANG: ${code.toUpperCase()}`;
        if (code === "am") {
            btnTalkLabel.innerText = "ለመናገር ስክሪኑን ይንኩ";
        } else if (code === "om") {
            btnTalkLabel.innerText = "DUBBACHUUF TUQAA";
        } else {
            btnTalkLabel.innerText = "TAP TO TALK";
        }
    }

    function transitionTo(newState) {
        currentState = newState;
        appContainer.className = `app-container state-${newState.toLowerCase()}`;
        updateQuickPills();
    }

    function updateQuickPills() {
        const row = document.getElementById("quickSelectRow");
        if (!row) return;

        if (currentState === STATES.INIT || currentState === STATES.LANG_SELECT) {
            row.innerHTML = `
                <button type="button" class="quick-pill" data-action="lang" data-value="om">Afaan Oromoo</button>
                <button type="button" class="quick-pill" data-action="lang" data-value="am">አማርኛ (Amharic)</button>
                <button type="button" class="quick-pill" data-action="lang" data-value="en">English</button>
            `;
        } else if (currentState === STATES.DEST_SELECT) {
            if (selectedLanguage === "am") {
                row.innerHTML = `
                    <button type="button" class="quick-pill" data-action="dest" data-value="ቅዱስ ጊዮርጊስ ቤተክርስቲያን">⛪ ቤተክርስቲያን</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="ሸራተን ሆቴል">🏨 ሆቴል</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="መርካቶ ገበያ">🛍️ መርካቶ / ገበያ</button>
                `;
            } else if (selectedLanguage === "om") {
                row.innerHTML = `
                    <button type="button" class="quick-pill" data-action="dest" data-value="Bataskaana Qiddus Giyoorgis">⛪ Bataskaana</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="Hoteela Boolee">🏨 Hoteela</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="Gabaa">🛍️ Gabaa</button>
                `;
            } else {
                row.innerHTML = `
                    <button type="button" class="quick-pill" data-action="dest" data-value="St. George Church">⛪ Church</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="Hilton Hotel">🏨 Hotel</button>
                    <button type="button" class="quick-pill" data-action="dest" data-value="Mercato Market">🛍️ Market</button>
                `;
            }
        } else if (currentState === STATES.NAVIGATING) {
            row.innerHTML = `
                <button type="button" class="quick-pill" data-action="hazard">⚠️ Person Ahead</button>
                <button type="button" class="quick-pill" data-action="step">🚶 Walk +10m</button>
                <button type="button" class="quick-pill" data-action="arrive">🏁 Arrive Now</button>
            `;
        } else if (currentState === STATES.ARRIVED) {
            row.innerHTML = `
                <button type="button" class="quick-pill" data-action="reset">🔄 Start New Journey</button>
            `;
        }
    }

    function speakLocalized(translations, isUrgent = false) {
        const text = translations[selectedLanguage] || translations["en"];
        speak(text, selectedLanguage, isUrgent);
    }

    // ==========================================
    // INITIALIZATION & WELCOME
    // ==========================================
    function initializeApp() {
        if (currentState !== STATES.INIT) return;

        getAudioContext();
        triggerHaptic([100]);
        transitionTo(STATES.LANG_SELECT);

        // Sequence welcome speech in all 3 languages as requested
        const welcomePrompt = "Welcome. Please choose your language. Say English, Amharic, or Afaan Oromoo. " +
            "እባክዎ ቋንቋ ይምረጡ፦ አማርኛ፣ እንግሊዝኛ ወይም ኦሮምኛ ይበሉ። " +
            "Maaloo afaan barbaaddan filadhaa: Afaan Oromoo, Amaariffa, yookiin Ingiliffa.";

        speak(welcomePrompt, "en");
    }

    // ==========================================
    // DESTINATION SUBMISSION & ROUTING
    // ==========================================
    async function submitDestination(spokenText) {
        voicePill.className = "voice-pill speaking";
        voiceStatusText.innerText = "SETTING DESTINATION...";

        try {
            const resp = await fetch("/api/destination/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    speech: spokenText,
                    language: selectedLanguage
                })
            });
            const data = await resp.json();

            currentDestination = data.destination || spokenText;
            totalTargetDistance = data.target_distance || 100;
            distanceRemaining = totalTargetDistance;
            metersWalked = 0;
            currentSessionId = data.session_id || "";

            // Update UI HUD
            hudDestination.innerText = currentDestination;
            hudWalked.innerText = "0 m";
            hudRemaining.innerText = `${distanceRemaining} m`;
            walkingHud.classList.remove("hidden");

            // Spoken confirmation
            speak(data.spoken_confirmation, selectedLanguage);

            // Transition to Navigation & Start Camera
            transitionTo(STATES.NAVIGATING);
            setTimeout(() => {
                startCameraNavigation();
            }, 1000);

        } catch (e) {
            console.error("Destination API error:", e);
            currentDestination = spokenText;
            totalTargetDistance = 100;
            distanceRemaining = 100;
            metersWalked = 0;
            walkingHud.classList.remove("hidden");
            hudDestination.innerText = currentDestination;

            speakLocalized({
                en: `Destination set to ${spokenText}. Starting camera navigation now.`,
                am: `መዳረሻዎ ወደ ${spokenText} ተቀናብሯል። የካሜራ አሰሳ አሁን ይጀምራል።`,
                om: `Bakki deemtan gara ${spokenText}tti qophaa'eera. Qajeelchi kaameraa amma eegala.`
            });

            transitionTo(STATES.NAVIGATING);
            setTimeout(() => {
                startCameraNavigation();
            }, 1000);
        }
    }

    // ==========================================
    // CAMERA & VISION DETECTION ENGINE
    // ==========================================
    async function startCameraNavigation() {
        cameraPlaceholder.classList.add("hidden");
        cameraVideo.classList.remove("hidden");
        detectionCanvas.classList.remove("hidden");

        // Load TensorFlow.js COCO-SSD model in background if not yet loaded
        if (!cocoModel && window.cocoSsd) {
            try {
                cocoModel = await cocoSsd.load();
                console.log("[COCO-SSD] Model loaded successfully");
            } catch (err) {
                console.warn("[COCO-SSD] Model load error, using server vision:", err);
            }
        }

        // Open Rear Phone Camera (environment facing) with fallback
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

            // Set canvas dimensions
            cameraVideo.onloadedmetadata = () => {
                detectionCanvas.width = cameraVideo.videoWidth || 640;
                detectionCanvas.height = cameraVideo.videoHeight || 480;
            };

            // Start detection loops
            startRealtimeDetectionLoop();
            startWalkingProgressTracker();

        } catch (err) {
            console.error("[Camera Error]:", err);
            speakLocalized({
                en: "Camera access unavailable. Continuing walking distance guidance.",
                am: "ካሜራውን መክፈት አልተቻለም። የመራመጃ ርቀት መመሪያው ይቀጥላል።",
                om: "Kaameraa banuun hin danda'amne. Qajeelchi fageenyaa itti fufa."
            });
            startWalkingProgressTracker();
        }
    }

    // Real-time local object detection loop (every 1.5 seconds)
    function startRealtimeDetectionLoop() {
        if (detectionInterval) clearInterval(detectionInterval);

        detectionInterval = setInterval(async () => {
            if (currentState !== STATES.NAVIGATING || !cameraVideo || cameraVideo.paused) return;

            // 1. Fast local COCO-SSD detection
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

        // 2. Periodic Multimodal Gemini Vision snapshot (every 7 seconds)
        if (geminiVisionInterval) clearInterval(geminiVisionInterval);
        geminiVisionInterval = setInterval(() => {
            if (currentState === STATES.NAVIGATING) {
                captureAndAnalyzeFrameWithGemini();
            }
        }, 7000);
    }

    // Draw bounding boxes on canvas for sighted caregivers & visual inspection
    function renderDetectionBoxes(predictions) {
        const ctx = detectionCanvas.getContext("2d");
        ctx.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);

        predictions.forEach(p => {
            const [x, y, width, height] = p.bbox;
            const isHazard = ["person", "car", "truck", "bus", "motorcycle", "bicycle", "chair"].includes(p.class);

            ctx.lineWidth = isHazard ? 4 : 2;
            ctx.strokeStyle = isHazard ? "#ff3b30" : "#3fb950";
            ctx.fillStyle = isHazard ? "rgba(255, 59, 48, 0.2)" : "rgba(63, 185, 80, 0.2)";

            ctx.strokeRect(x, y, width, height);
            ctx.fillRect(x, y, width, height);

            // Label
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 16px sans-serif";
            ctx.fillText(`${p.class} (${Math.round(p.score * 100)}%)`, x + 6, y > 20 ? y - 6 : y + 20);
        });
    }

    // Process detected obstacles and provide immediate voice warning if dangerous
    function processObstacleAlerts(predictions) {
        const now = Date.now();
        // Prevent spamming alerts more often than once every 4 seconds
        if (now - lastHazardAlertTime < 4000) return;

        const hazards = predictions.filter(p =>
            ["person", "car", "truck", "bus", "motorcycle", "bicycle", "chair", "dog"].includes(p.class) &&
            p.score > 0.55
        );

        if (hazards.length === 0) {
            hideHazardBanner();
            return;
        }

        // Find closest / largest obstacle
        hazards.sort((a, b) => (b.bbox[2] * b.bbox[3]) - (a.bbox[2] * a.bbox[3]));
        const target = hazards[0];
        const [x, y, w, h] = target.bbox;
        const frameHeight = detectionCanvas.height || 480;
        const frameWidth = detectionCanvas.width || 640;

        // Estimate distance: larger box = closer
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

        // Estimate direction (Left, Ahead, Right)
        const centerX = x + (w / 2);
        let direction = "ahead";
        if (centerX < frameWidth * 0.35) {
            direction = "left";
        } else if (centerX > frameWidth * 0.65) {
            direction = "right";
        }

        lastHazardAlertTime = now;
        showHazardBanner(target.class, estimatedDistance, direction);

        // Speak localized warning
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

    // Capture snapshot for Gemini Vision (detects potholes, stairs, ground hazards)
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
                    distance_left: distanceRemaining
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
    // WALKING PROGRESS & ARRIVAL ENGINE
    // ==========================================
    function startWalkingProgressTracker() {
        if (walkingInterval) clearInterval(walkingInterval);

        // Geolocation GPS watcher when outdoors
        if ("geolocation" in navigator) {
            try {
                let lastPos = null;
                navigator.geolocation.watchPosition((pos) => {
                    if (lastPos) {
                        const dist = calculateGpsDistance(
                            lastPos.coords.latitude, lastPos.coords.longitude,
                            pos.coords.latitude, pos.coords.longitude
                        );
                        if (dist > 1 && dist < 50) {
                            stepForward(Math.round(dist));
                        }
                    }
                    lastPos = pos;
                }, (err) => console.log("GPS watcher notice:", err.message), {
                    enableHighAccuracy: true,
                    maximumAge: 5000
                });
            } catch (e) {}
        }

        // Walking loop: Increments distance smoothly during walking
        walkingInterval = setInterval(() => {
            if (currentState !== STATES.NAVIGATING) return;

            // Natural walking pace: 1 meter every 1.5 seconds
            stepForward(1);

            // Announce distance every 15 seconds or when milestone reached
            const now = Date.now();
            if (now - lastDistanceAnnounceTime > 15000 && !isSpeaking) {
                lastDistanceAnnounceTime = now;
                announceDistanceProgress();
            }

        }, 1500);
    }

    function stepForward(meters = 1) {
        if (currentState !== STATES.NAVIGATING) return;

        metersWalked += meters;
        distanceRemaining = Math.max(0, totalTargetDistance - metersWalked);

        hudWalked.innerText = `${metersWalked} m`;
        hudRemaining.innerText = `${distanceRemaining} m`;

        if (distanceRemaining <= 0) {
            arriveAtDestination();
        }
    }

    function announceDistanceProgress() {
        if (distanceRemaining <= 0) return;

        if (selectedLanguage === "am") {
            speak(`${metersWalked} ሜትር ተጉዘዋል። ወደ ${currentDestination} ${distanceRemaining} ሜትር ይቀራል።`, "am");
        } else if (selectedLanguage === "om") {
            speak(`Meetira ${metersWalked} deemtaniittu. Gara ${currentDestination} meetirri ${distanceRemaining} hafeera.`, "om");
        } else {
            speak(`You have walked ${metersWalked} meters. ${distanceRemaining} meters remaining to ${currentDestination}.`, "en");
        }
    }

    async function arriveAtDestination() {
        transitionTo(STATES.ARRIVED);
        if (walkingInterval) clearInterval(walkingInterval);
        if (detectionInterval) clearInterval(detectionInterval);
        if (geminiVisionInterval) clearInterval(geminiVisionInterval);

        playBeep(523.25, 0.2);
        setTimeout(() => playBeep(659.25, 0.2), 200);
        setTimeout(() => playBeep(783.99, 0.4), 400);
        triggerHaptic([300, 150, 300, 150, 500]);

        let arrivalText = "";
        if (selectedLanguage === "am") {
            arrivalText = `እንኳን ደስ አለዎት! መዳረሻዎ ${currentDestination} በሰላም ደርሰዋል።`;
        } else if (selectedLanguage === "om") {
            arrivalText = `Baga gammaddan! Bakka yaaddan ${currentDestination} nagaan geessaniittu.`;
        } else {
            arrivalText = `Congratulations! You have safely arrived at ${currentDestination}.`;
        }

        speak(arrivalText, selectedLanguage, true);

        // Notify server & Firebase
        try {
            await fetch("/api/update-trip/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    meters_walked: metersWalked,
                    distance_left: 0,
                    arrived: true,
                    language: selectedLanguage
                })
            });
        } catch (e) {}
    }

    function calculateGpsDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    function resetNavigation() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        if (walkingInterval) clearInterval(walkingInterval);
        if (detectionInterval) clearInterval(detectionInterval);
        if (geminiVisionInterval) clearInterval(geminiVisionInterval);

        cameraPlaceholder.classList.remove("hidden");
        cameraVideo.classList.add("hidden");
        detectionCanvas.classList.add("hidden");
        walkingHud.classList.add("hidden");
        hideHazardBanner();

        currentState = STATES.INIT;
        metersWalked = 0;
        distanceRemaining = 100;
        currentDestination = "";

        appSpeechText.innerText = `"Tap anywhere on the screen to begin. You can speak English, Amharic, or Afaan Oromoo."`;
        userHeardText.classList.add("hidden");
        voiceStatusText.innerText = "TAP SCREEN TO START";
        langBadge.innerText = "LANG: --";

        speakLocalized({
            en: "Navigation reset. Tap screen to start again.",
            am: "አሰሳው እንደገና ተጀምሯል። ለመጀመር ስክሪኑን ይንኩ።",
            om: "Qajeelchi irra deebi'ameera. Jalqabuuf iskiriinii tuqaa."
        });
    }

    // ==========================================
    // EVENT LISTENERS & INTERACTION
    // ==========================================
    // Whole Screen Tap Target
    appContainer.addEventListener("click", (e) => {
        // Don't intercept settings button or secondary buttons
        if (e.target.closest("#btnSettings") || e.target.closest(".secondary-btn-row")) {
            return;
        }

        if (currentState === STATES.INIT) {
            initializeApp();
        } else if (!isSpeaking && !isListening) {
            startVoiceRecognition();
        }
    });

    // Spacebar or Enter keyboard shortcut for accessible desktop testing
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

    // Talk Button
    btnTapToTalk.addEventListener("click", (e) => {
        e.stopPropagation();
        if (currentState === STATES.INIT) {
            initializeApp();
        } else {
            startVoiceRecognition();
        }
    });

    // Quick Select Interactive Row
    const quickSelectRow = document.getElementById("quickSelectRow");
    if (quickSelectRow) {
        quickSelectRow.addEventListener("click", (e) => {
            e.stopPropagation();
            const btn = e.target.closest(".quick-pill");
            if (!btn) return;
            const action = btn.getAttribute("data-action");
            const val = btn.getAttribute("data-value");

            if (currentState === STATES.INIT) {
                initializeApp();
            }

            if (action === "lang") {
                handleUserVoiceInput(val);
            } else if (action === "dest") {
                handleUserVoiceInput(val);
            } else if (action === "hazard") {
                const sampleHazard = [{
                    class: "person",
                    bbox: [100, 100, 300, 320],
                    score: 0.92
                }];
                renderDetectionBoxes(sampleHazard);
                processObstacleAlerts(sampleHazard);
            } else if (action === "step") {
                stepForward(10);
            } else if (action === "arrive") {
                arriveAtDestination();
            } else if (action === "reset") {
                resetNavigation();
            }
        });
    }

    // Repeat Button
    btnRepeat.addEventListener("click", (e) => {
        e.stopPropagation();
        if (lastSpokenText) {
            speak(lastSpokenText, selectedLanguage);
        }
    });

    // Simulate Step Forward Button (+5 meters)
    btnSimulateStep.addEventListener("click", (e) => {
        e.stopPropagation();
        if (currentState === STATES.NAVIGATING) {
            stepForward(5);
            playBeep(440, 0.08);
        }
    });

    // Reset Button
    btnReset.addEventListener("click", (e) => {
        e.stopPropagation();
        resetNavigation();
    });

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
        if (key) {
            sessionStorage.setItem("GEMINI_API_KEY", key);
        }
        settingsModal.classList.add("hidden");
    });

})();
