/**
 * VisionNav - Caregiver & Telemetry Analytics Dashboard
 * Real-time GPS map, 2D Sonar radar mirror, telemetry HUD, remote assistance.
 */

(function () {
    "use strict";

    // Dashboard State
    let map = null;
    let userMarker = null;
    let destMarker = null;
    let routePolyline = null;
    let hazardMarkersGroup = null;
    let pollingInterval = null;
    let currentSessionId = null;

    // Default Coordinates (Addis Ababa, Meskel Square)
    let currentLat = 9.0108;
    let currentLng = 38.7613;
    let destLat = 9.0180;
    let destLng = 38.7680;
    let currentHeading = 42;
    let currentSpeed = 1.2;
    let radarHazards = [];

    // DOM Elements
    const kpiWalked = document.getElementById("kpiWalked");
    const kpiDestination = document.getElementById("kpiDestination");
    const kpiRemaining = document.getElementById("kpiRemaining");
    const kpiHazards = document.getElementById("kpiHazards");
    const kpiSessionHazards = document.getElementById("kpiSessionHazards");
    const kpiTelemetry = document.getElementById("kpiTelemetry");
    const kpiStatus = document.getElementById("kpiStatus");
    const hudLat = document.getElementById("hudLat");
    const hudLng = document.getElementById("hudLng");
    const hudSpeed = document.getElementById("hudSpeed");
    const hudHeading = document.getElementById("hudHeading");
    const hudAccuracy = document.getElementById("hudAccuracy");
    const dashAssistantSpeech = document.getElementById("dashAssistantSpeech");
    const dashUserSpeech = document.getElementById("dashUserSpeech");
    const btnSendCaregiverVoice = document.getElementById("btnSendCaregiverVoice");
    const caregiverMessageInput = document.getElementById("caregiverMessageInput");
    const btnCaregiverSos = document.getElementById("btnCaregiverSos");
    const btnSimulateStepDash = document.getElementById("btnSimulateStepDash");
    const btnRecenterMap = document.getElementById("btnRecenterMap");
    const btnRefreshData = document.getElementById("btnRefreshData");
    const caregiverAlertFeedback = document.getElementById("caregiverAlertFeedback");
    const dashRadarCanvas = document.getElementById("dashRadarCanvas");
    const sessionsTableBody = document.getElementById("sessionsTableBody");
    const hazardsTableBody = document.getElementById("hazardsTableBody");

    // ==========================================
    // 1. LEAFLET MAP INITIALIZATION
    // ==========================================
    function initMap() {
        if (!window.L) {
            console.error("Leaflet not loaded");
            return;
        }

        map = L.map("liveMap", {
            zoomControl: true,
            attributionControl: false
        }).setView([currentLat, currentLng], 16);

        // OpenStreetMap Dark Theme Tiles
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19
        }).addTo(map);

        hazardMarkersGroup = L.layerGroup().addTo(map);

        // User Custom Pulsing Beacon Icon
        const userIcon = L.divIcon({
            className: "user-map-beacon",
            html: `
                <div style="position:relative; width:28px; height:28px;">
                    <div style="position:absolute; width:28px; height:28px; background:rgba(0,240,255,0.3); border-radius:50%; animation:userPing 1.5s infinite;"></div>
                    <div style="position:absolute; top:6px; left:6px; width:16px; height:16px; background:#00f0ff; border:2px solid #fff; border-radius:50%; box-shadow:0 0 10px #00f0ff;"></div>
                </div>
                <style>
                    @keyframes userPing {
                        0% { transform:scale(0.8); opacity:1; }
                        100% { transform:scale(2.2); opacity:0; }
                    }
                </style>
            `,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        // Destination Pin Icon
        const destIcon = L.divIcon({
            className: "dest-map-pin",
            html: `
                <div style="font-size:24px; text-shadow:0 0 10px #ffe600; transform:translate(-12px, -24px);">
                    🎯
                </div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 24]
        });

        userMarker = L.marker([currentLat, currentLng], { icon: userIcon }).addTo(map);
        userMarker.bindPopup("<b>Blind User Current Position</b><br>High-Accuracy GPS");

        destMarker = L.marker([destLat, destLng], { icon: destIcon }).addTo(map);
        destMarker.bindPopup("<b>Navigation Destination</b>");

        // Route Polyline
        routePolyline = L.polyline([
            [currentLat, currentLng],
            [destLat, destLng]
        ], {
            color: "#00f0ff",
            weight: 4,
            opacity: 0.8,
            dashArray: "6, 8"
        }).addTo(map);
    }

    function updateMapPositions(lat, lng, dLat, dLng) {
        if (!map) return;
        currentLat = lat;
        currentLng = lng;

        if (userMarker) {
            userMarker.setLatLng([lat, lng]);
        }

        if (dLat && dLng) {
            destLat = dLat;
            destLng = dLng;
            if (destMarker) {
                destMarker.setLatLng([destLat, destLng]);
            }
        }

        if (routePolyline) {
            routePolyline.setLatLngs([
                [currentLat, currentLng],
                [destLat, destLng]
            ]);
        }
    }

    function plotHazardOnMap(hLat, hLng, hType, hDist) {
        if (!hazardMarkersGroup) return;

        const hazardIcon = L.divIcon({
            className: "hazard-map-pin",
            html: `<div style="font-size:18px; filter:drop-shadow(0 0 6px #ff0055); transform:translate(-9px,-9px);">⚠️</div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });

        const hMarker = L.marker([hLat, hLng], { icon: hazardIcon }).addTo(hazardMarkersGroup);
        hMarker.bindPopup(`<b>⚠️ Hazard Encountered</b><br>${hType} (${hDist}m away)`);
    }

    // ==========================================
    // 2. 2D SONAR RADAR CANVAS MIRROR
    // ==========================================
    let radarSweepAngle = 0;

    function initRadarScanner() {
        if (!dashRadarCanvas) return;
        const ctx = dashRadarCanvas.getContext("2d");
        const w = dashRadarCanvas.width;
        const h = dashRadarCanvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = w / 2 - 10;

        function drawRadar() {
            ctx.clearRect(0, 0, w, h);

            // Dark sonar background
            ctx.fillStyle = "#03060f";
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();

            // Concentric Range Rings (1m, 2m, 3.5m, 5m)
            ctx.strokeStyle = "#162b4c";
            ctx.lineWidth = 1;
            [0.25, 0.5, 0.75, 1.0].forEach((ratio) => {
                ctx.beginPath();
                ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
                ctx.stroke();
            });

            // Crosshairs & Angles
            ctx.beginPath();
            ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
            ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
            ctx.stroke();

            // Sweeping Beam
            radarSweepAngle += 0.04;
            if (radarSweepAngle > Math.PI * 2) radarSweepAngle = 0;

            const beamX = cx + Math.cos(radarSweepAngle) * radius;
            const beamY = cy + Math.sin(radarSweepAngle) * radius;

            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            gradient.addColorStop(0, "rgba(0, 240, 255, 0.25)");
            gradient.addColorStop(1, "rgba(0, 240, 255, 0.01)");

            ctx.fillStyle = gradient;
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

            // Draw Obstacle Blips
            radarHazards.forEach((hItem) => {
                const angle = hItem.angle || -Math.PI / 2;
                const distRatio = Math.min(1.0, (hItem.distance || 2) / 5.0);
                const bx = cx + Math.cos(angle) * (radius * distRatio);
                const by = cy + Math.sin(angle) * (radius * distRatio);

                // Blip glow
                ctx.fillStyle = hItem.distance < 2.5 ? "#ff0055" : "#ffe600";
                ctx.shadowColor = ctx.fillStyle;
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(bx, by, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            });

            // Center User Dot
            ctx.fillStyle = "#00f0ff";
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fill();

            requestAnimationFrame(drawRadar);
        }

        drawRadar();
    }

    // ==========================================
    // 3. REAL-TIME DATA POLLING & SYNC
    // ==========================================
    async function fetchDashboardTelemetry() {
        try {
            const resp = await fetch("/api/dashboard-data/");
            if (!resp.ok) return;
            const data = await resp.json();

            // 1. Update Active Session Telemetry
            if (data.active_session) {
                const s = data.active_session;
                currentSessionId = s.session_id;

                kpiWalked.innerText = `${s.meters_walked} m`;
                kpiDestination.innerText = s.destination || "Standing By";
                kpiRemaining.innerText = `Remaining: ${s.distance_remaining} m`;
                kpiSessionHazards.innerText = `This Trip: ${s.hazards_encountered}`;
                kpiTelemetry.innerText = `${s.battery_level}% • ${s.speed_mps} m/s`;
                kpiStatus.innerHTML = `Status: <span class="badge-status ${s.status}">${s.status.toUpperCase()}</span>`;

                // Update HUD
                hudLat.innerText = `${s.current_lat.toFixed(4)}° N`;
                hudLng.innerText = `${s.current_lng.toFixed(4)}° E`;
                hudSpeed.innerText = `${s.speed_mps} m/s`;
                currentSpeed = s.speed_mps;

                // Speech dialogue feed
                if (s.last_assistant_speech) {
                    dashAssistantSpeech.innerText = s.last_assistant_speech;
                }
                if (s.last_user_speech) {
                    dashUserSpeech.innerText = `"${s.last_user_speech}"`;
                }

                // Update Map
                updateMapPositions(s.current_lat, s.current_lng, s.dest_lat, s.dest_lng);
            }

            // 2. Update Stats
            if (data.stats) {
                kpiHazards.innerText = data.stats.total_hazards || "0";
            }

            // 3. Update Recent Hazards on Map & Radar
            if (data.recent_hazards && data.recent_hazards.length > 0) {
                radarHazards = [];
                data.recent_hazards.forEach((hz) => {
                    let angle = -Math.PI / 2; // center
                    if (hz.direction === "left") angle = -Math.PI * 0.75;
                    else if (hz.direction === "right") angle = -Math.PI * 0.25;

                    radarHazards.push({
                        type: hz.hazard_type,
                        distance: hz.distance_meters,
                        angle: angle
                    });

                    if (hz.lat && hz.lng) {
                        plotHazardOnMap(hz.lat, hz.lng, hz.hazard_type, hz.distance_meters);
                    }
                });
            }

        } catch (err) {
            console.warn("[Dashboard Sync Error]", err);
        }
    }

    // ==========================================
    // 4. CAREGIVER REMOTE ACTIONS
    // ==========================================
    async function sendCaregiverMessage() {
        const msg = caregiverMessageInput.value.trim();
        if (!msg) return;

        btnSendCaregiverVoice.disabled = true;
        btnSendCaregiverVoice.innerText = "SENDING...";

        try {
            const resp = await fetch("/api/caregiver-action/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    action: "message",
                    message: `Caregiver message: ${msg}`
                })
            });
            const res = await resp.json();

            caregiverAlertFeedback.classList.remove("hidden");
            caregiverAlertFeedback.innerText = "✓ Voice instruction delivered to user's headset!";
            caregiverMessageInput.value = "";

            setTimeout(() => {
                caregiverAlertFeedback.classList.add("hidden");
            }, 4000);
        } catch (e) {
            alert("Error sending remote message");
        } finally {
            btnSendCaregiverVoice.disabled = false;
            btnSendCaregiverVoice.innerText = "📢 SEND VOICE";
        }
    }

    async function sendEmergencySos() {
        if (!confirm("Are you sure you want to broadcast an EMERGENCY SOS alert to the blind user?")) {
            return;
        }

        try {
            const resp = await fetch("/api/caregiver-action/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    action: "sos"
                })
            });
            const res = await resp.json();

            caregiverAlertFeedback.classList.remove("hidden");
            caregiverAlertFeedback.style.borderColor = "#ff0055";
            caregiverAlertFeedback.style.color = "#ff0055";
            caregiverAlertFeedback.innerText = "🚨 EMERGENCY SOS BROADCAST SENT TO USER HEADSET!";

            setTimeout(() => {
                caregiverAlertFeedback.classList.add("hidden");
                caregiverAlertFeedback.style.borderColor = "";
                caregiverAlertFeedback.style.color = "";
            }, 6000);
        } catch (e) {
            alert("Error sending emergency broadcast");
        }
    }

    async function simulateStepFromDashboard() {
        try {
            const resp = await fetch("/api/caregiver-action/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    action: "step",
                    step: 10
                })
            });
            await resp.json();
            fetchDashboardTelemetry();
        } catch (e) {
            console.error("Simulation step error", e);
        }
    }

    // ==========================================
    // 5. EVENT LISTENERS & SETUP
    // ==========================================
    document.addEventListener("DOMContentLoaded", () => {
        initMap();
        initRadarScanner();
        fetchDashboardTelemetry();

        // Start continuous live telemetry polling every 2.5 seconds
        pollingInterval = setInterval(fetchDashboardTelemetry, 2500);

        if (btnSendCaregiverVoice) {
            btnSendCaregiverVoice.addEventListener("click", sendCaregiverMessage);
        }
        if (caregiverMessageInput) {
            caregiverMessageInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    sendCaregiverMessage();
                }
            });
        }
        if (btnCaregiverSos) {
            btnCaregiverSos.addEventListener("click", sendEmergencySos);
        }
        if (btnSimulateStepDash) {
            btnSimulateStepDash.addEventListener("click", simulateStepFromDashboard);
        }
        if (btnRecenterMap) {
            btnRecenterMap.addEventListener("click", () => {
                if (map) map.panTo([currentLat, currentLng]);
            });
        }
        if (btnRefreshData) {
            btnRefreshData.addEventListener("click", fetchDashboardTelemetry);
        }
    });

})();
