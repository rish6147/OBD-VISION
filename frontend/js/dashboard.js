// ------------------ CONFIG ------------------
const API_BASE = "http://127.0.0.1:5000/api";

// ------------------ GLOBAL STATE ------------------
let selectedFile = null;
let isGenerating = false;
let abortController = null;
let keepAliveInterval = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

// Render State
let renderState = {
    progress: 0,
    message: "Initializing...",
    step: null,
    logs: [],
    lastProgressTime: Date.now()
};

// ------------------ PREVENT AUTO-RELOAD (3-Level Protection) ------------------
let isSelectingFile = false;
let userInitiatedReload = false;

// LEVEL 1: Block ALL beforeunload during generation (unless user explicitly reloads)
window.addEventListener('beforeunload', function(e) {
    // NEVER block file selection
    if (isSelectingFile) {
        return undefined;
    }
    
    // CRITICAL: Block ALL reloads during generation (including auto-reload)
    if (isGenerating) {
        // If user pressed Ctrl+R or F5, allow it (with warning)
        if (userInitiatedReload) {
            e.preventDefault();
            e.returnValue = "Video generation in progress. Reload will cancel it.";
            return e.returnValue;
        }
        
        // Block automatic/programmatic reloads completely
        e.preventDefault();
        e.returnValue = '';
        
        // Log the attempt
        console.warn("🚫 Auto-reload blocked during video generation");
        renderState.logs.push({ 
            msg: "⚠️ Browser tried to reload - blocked automatically", 
            type: 'warning' 
        });
        
        return e.returnValue;
    }
});

// LEVEL 2: Detect user-initiated reload (Ctrl+R, F5, Cmd+R)
document.addEventListener('keydown', function(e) {
    // Detect F5 or Ctrl/Cmd+R
    if (e.key === 'F5' || (e.key === 'r' && (e.ctrlKey || e.metaKey))) {
        userInitiatedReload = true;
        setTimeout(() => userInitiatedReload = false, 100);
    }
}, { capture: true });

// LEVEL 3: Prevent programmatic reloads
const originalReload = window.location.reload;
window.location.reload = function() {
    if (isGenerating && !userInitiatedReload) {
        console.error("🚫 Programmatic reload blocked during video generation");
        renderState.logs.push({ 
            msg: "⚠️ Script tried to reload page - blocked", 
            type: 'error' 
        });
        return false;
    }
    originalReload.call(window.location);
};

// ------------------ PAGE VISIBILITY HANDLER ------------------
let wasHidden = false;
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        wasHidden = true;
        console.warn("⚠️ Tab hidden - stream may timeout");
    } else if (wasHidden && isGenerating) {
        console.log("✅ Tab visible again");
        handleTabReactivation();
    }
});

function handleTabReactivation() {
    const timeSinceLastProgress = Date.now() - renderState.lastProgressTime;
    
    if (timeSinceLastProgress > 15000) {
        const shouldReconnect = confirm(
            "⚠️ Connection may have been lost while tab was inactive.\n\n" +
            "Click OK to check status, or Cancel to continue waiting."
        );
        
        if (shouldReconnect) {
            attemptStreamRecovery();
        }
    }
}

// ------------------ INITIALIZATION ------------------
window.addEventListener("DOMContentLoaded", () => {
    fetchUser();
    fetchDashboardVideos(); // Add video fetching for dashboard

    const genBtn = document.getElementById('generateBtn');
    if (genBtn) {
        const newBtn = genBtn.cloneNode(true);
        genBtn.parentNode.replaceChild(newBtn, genBtn);
        newBtn.addEventListener('click', handleGenerateClick);
    }

    const dropArea = document.getElementById('dataUploadArea');
    if (dropArea) setupDragDrop(dropArea);

    // CRITICAL: Wrap file input to prevent beforeunload trigger
    const fileInput = document.getElementById('dataFile');
    if (fileInput) {
        fileInput.addEventListener('click', () => {
            isSelectingFile = true;
            actualNavigationAttempt = false;
        });

        fileInput.addEventListener('change', () => {
            isSelectingFile = false;
        });

        fileInput.addEventListener('cancel', () => {
            isSelectingFile = false;
        });

        // Safety timeout (in case events don't fire)
        fileInput.addEventListener('blur', () => {
            setTimeout(() => isSelectingFile = false, 500);
        });
    }
});

// PREVENT FORM SUBMISSIONS
document.addEventListener('submit', function(e) {
    e.preventDefault();
    e.stopPropagation();
    return false;
}, { capture: true });

async function fetchUser() {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
        const res = await fetch(`${API_BASE}/user/me`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            // Update avatar with first 2 characters of first name
            const avatarEl = document.querySelector(".user-avatar");
            if(avatarEl) avatarEl.textContent = data.user.firstName.substring(0, 2).toUpperCase();

            // Update username
            const nameEl = document.getElementById("navbar-username");
            if(nameEl) nameEl.textContent = `${data.user.firstName} ${data.user.lastName}`;

            // Update email
            const emailEl = document.getElementById("navbar-email");
            if(emailEl) emailEl.textContent = data.user.email;

            // Update welcome message
            const welcomeEl = document.getElementById("welcome-msg");
            if(welcomeEl) welcomeEl.textContent = `Welcome back ${data.user.firstName}!`;
        }
    } catch (e) { console.error(e); }
}

// ------------------ KEEP ALIVE ------------------
function startKeepAlive() {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    
    keepAliveInterval = setInterval(async () => {
        if (!isGenerating) return stopKeepAlive();
        
        try {
            const token = localStorage.getItem("token");
            await fetch(`${API_BASE}/user/me`, { 
                method: 'GET',
                headers: { "Authorization": `Bearer ${token}` }
            });
            
            const timeSinceLastProgress = Date.now() - renderState.lastProgressTime;
            if (timeSinceLastProgress > 30000) {
                console.warn("⚠️ No progress for 30s - backend may have crashed");
                renderState.logs.push({ 
                    msg: "⚠️ Backend unresponsive for 30s. Check terminal.", 
                    type: 'warning' 
                });
            }
        } catch (e) {
            console.warn("Keep-Alive failed:", e.message);
        }
    }, 8000); 
}

function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

// ------------------ STREAM RECOVERY ------------------
async function attemptStreamRecovery() {
    renderState.logs.push({ msg: "🔄 Checking backend status...", type: 'info' });
    
    alert(
        "💡 Recovery Tips:\n\n" +
        "1. Check browser console for errors\n" +
        "2. Verify backend is still running\n" +
        "3. If backend crashed, restart it\n" +
        "4. Avoid switching tabs during generation"
    );
}

// ------------------ UI HANDLERS ------------------
function handleDataUpload(event) {
    const file = event.target.files[0];
    if (!file) {
        isSelectingFile = false; // Reset if cancelled
        return;
    }
    
    selectedFile = file;
    isSelectingFile = false; // File selected successfully
    
    document.getElementById('dataUploadArea').classList.add('active');
    document.getElementById('dataFileName').textContent = file.name;
    document.getElementById('dataFileSize').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
    document.getElementById('dataFileInfo').classList.add('show');
    document.getElementById('generateBtn').disabled = false;
}

async function handleGenerateClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!selectedFile) return alert("Please select a file first.");
    const token = localStorage.getItem("token");
    if (!token) return alert("Please login first.");

    isGenerating = true;
    actualNavigationAttempt = false; // Reset navigation flag
    reconnectAttempts = 0;
    showModal();
    startKeepAlive();
    requestAnimationFrame(renderLoop);

    try {
        // 1. Upload
        renderState.message = "Uploading file...";
        const formData = new FormData();
        formData.append("file", selectedFile);
        
        const uploadRes = await fetch(`${API_BASE}/upload/upload`, {
            method: "POST", 
            headers: { "Authorization": `Bearer ${token}` }, 
            body: formData
        });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) throw new Error(uploadData.error);

        // 2. Stream Generation
        await startStream(uploadData.upload._id, token);

    } catch (err) {
        handleError(err.message);
    }
    return false;
}

// ------------------ STREAM LOGIC ------------------
async function startStream(fileId, token) {
    renderState.message = "Starting video engine...";
    renderState.progress = 5;
    renderState.lastProgressTime = Date.now();
    
    abortController = new AbortController();

    try {
        const response = await fetch(`${API_BASE}/upload/generate-video`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ fileId }),
            signal: abortController.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let consecutiveErrors = 0;

        while (true) {
            let readerResult;
            
            try {
                readerResult = await Promise.race([
                    reader.read(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Stream read timeout')), 60000)
                    )
                ]);
                
                consecutiveErrors = 0;
                
            } catch (err) {
                consecutiveErrors++;
                console.error(`Stream read error (attempt ${consecutiveErrors}):`, err.message);
                
                if (consecutiveErrors < MAX_RECONNECT_ATTEMPTS) {
                    renderState.logs.push({ 
                        msg: `⚠️ Connection hiccup - retrying (${consecutiveErrors}/${MAX_RECONNECT_ATTEMPTS})...`, 
                        type: 'warning' 
                    });
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                
                reader.releaseLock();
                
                if (err.name === 'AbortError') {
                    handleError("Generation cancelled by user");
                } else if (err.message.includes('timeout')) {
                    handleError("Backend stopped responding. Check terminal and restart if needed.");
                } else {
                    handleError(`Stream failed: ${err.message}. Backend may have crashed.`);
                }
                return;
            }
            
            const { done, value } = readerResult;
            if (done) {
                console.log("✅ Stream complete");
                break;
            }

            await new Promise(r => setTimeout(r, 0));

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); 

            for (const line of lines) {
                if (!line.trim()) continue;
                const clean = line.replace(/^data: /, '').replace(/^PROGRESS:/, '').trim();
                if (!clean) continue;

                try {
                    const data = JSON.parse(clean);
                    
                    if (data.progress !== undefined) {
                        renderState.progress = Math.round(data.progress);
                        renderState.lastProgressTime = Date.now();
                    }
                    if (data.message) renderState.message = data.message;
                    if (data.step) renderState.step = data.step;
                    
                    if (data.stage === 'error') {
                        renderState.logs.push({ msg: data.message, type: 'error' });
                        handleError(data.message);
                        return;
                    }
                    if (data.stage === 'success') {
                        handleSuccess();
                        return;
                    }
                    
                    if (data.message && data.progress === undefined) {
                        renderState.logs.push({ msg: data.message, type: 'info' });
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }
        }
        
        if (renderState.progress < 100) {
            console.warn("⚠️ Stream ended but progress < 100%");
            handleError("Video generation incomplete. Check backend logs.");
        }
        
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error("Stream outer error:", err);
            handleError(`Connection failed: ${err.message}`);
        }
    } finally {
        stopKeepAlive(); 
    }
}

// ------------------ RENDER LOOP ------------------
function renderLoop() {
    if (!isGenerating) return;

    const progressFill = document.getElementById('progressFill');
    const pctText = document.getElementById('loadingPercentage');
    const msgText = document.getElementById('activityMessage');
    
    if (progressFill) progressFill.style.width = renderState.progress + '%';
    if (pctText) pctText.textContent = renderState.progress + '%';
    if (msgText) msgText.textContent = renderState.message;

    if (renderState.step) setActiveStep(renderState.step);
    
    if (renderState.logs.length > 0) {
        const log = renderState.logs.shift();
        addLogToDom(log.msg, log.type);
    }

    requestAnimationFrame(renderLoop);
}

// ------------------ UI HELPERS ------------------
function showModal() {
    const modal = document.getElementById('loadingModal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    document.body.style.overflow = 'hidden';
    
    renderState = { 
        progress: 0, 
        message: "Initializing...", 
        step: null, 
        logs: [],
        lastProgressTime: Date.now()
    };
    
    const logContainer = document.getElementById('logContainer');
    if(logContainer) logContainer.innerHTML = '';
    
    document.getElementById('cancelBtn').style.display = 'block';
    document.getElementById('doneBtn').style.display = 'none';
    document.getElementById('closeBtn').style.display = 'none';
    
    resetSteps();
}

function closeModal() {
    const modal = document.getElementById('loadingModal');
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
    document.body.style.overflow = '';
    isGenerating = false;
    actualNavigationAttempt = false; // Reset
    stopKeepAlive();
}

function addLogToDom(msg, type) {
    const container = document.getElementById('logContainer');
    if (!container) return;
    
    if (container.children.length > 50) container.removeChild(container.firstChild);

    const div = document.createElement('div');
    div.className = `log-item ${type}`;
    div.textContent = `> ${msg}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function setActiveStep(stepName) {
    const stepMap = {
        'Loading Data': 1, 'Map Matching': 2, 'Stop Detection': 3,
        'Capturing Photos': 4, 'Frame Generation': 5, 'HTML Generation': 6, 'Rendering video': 7
    };
    const num = stepMap[stepName];
    if (!num) return;

    for (let i = 1; i < num; i++) {
        const el = document.getElementById(`step${i}`);
        if(el) {
            el.classList.add('completed');
            const icon = el.querySelector('.step-icon');
            if(icon) icon.textContent = '✓';
        }
    }
    const current = document.getElementById(`step${num}`);
    if(current) {
        current.classList.remove('completed');
        current.classList.add('active');
        const icon = current.querySelector('.step-icon');
        if(icon) icon.textContent = '⏳';
    }
}

function resetSteps() {
    for (let i = 1; i <= 7; i++) {
        const el = document.getElementById(`step${i}`);
        if(el) {
            el.classList.remove('active', 'completed', 'error');
            const icon = el.querySelector('.step-icon');
            if(icon) icon.textContent = '⏳';
        }
    }
}

function handleSuccess() {
    isGenerating = false;
    actualNavigationAttempt = false;
    renderState.progress = 100;
    renderState.message = "Video Ready! ✅";
    stopKeepAlive();
    
    const pFill = document.getElementById('progressFill');
    if(pFill) pFill.style.width = '100%'; 
    const msgText = document.getElementById('activityMessage');
    if(msgText) msgText.textContent = "Video Ready! ✅";
    
    document.getElementById('cancelBtn').style.display = 'none';
    document.getElementById('doneBtn').style.display = 'block';
    
    const step7 = document.getElementById('step7');
    if (step7) {
        step7.classList.add('completed');
        const icon = step7.querySelector('.step-icon');
        if (icon) icon.textContent = '✓';
    }
}

function handleError(msg) {
    isGenerating = false;
    actualNavigationAttempt = false;
    stopKeepAlive();
    
    const msgText = document.getElementById('activityMessage');
    if (msgText) msgText.textContent = "❌ Failed: " + msg;
    
    addLogToDom(msg, 'error');
    
    document.getElementById('cancelBtn').style.display = 'none';
    document.getElementById('closeBtn').style.display = 'block';
}

function setupDragDrop(area) {
    area.addEventListener('dragover', e => { 
        e.preventDefault(); 
        area.style.borderColor = '#6366f1'; 
    });
    area.addEventListener('dragleave', e => { 
        e.preventDefault(); 
        area.style.borderColor = ''; 
    });
    area.addEventListener('drop', e => {
        e.preventDefault();
        area.style.borderColor = '';
        if (e.dataTransfer.files.length) {
            handleDataUpload({ target: { files: e.dataTransfer.files } });
        }
    });
}

// Expose for HTML onclick
window.handleDataUpload = handleDataUpload;
window.closeLoadingModal = closeModal;
window.cancelVideoGeneration = () => {
    if (abortController) abortController.abort();
    stopKeepAlive();
    closeModal();
};

// ------------------ FETCH DASHBOARD VIDEOS ------------------
async function fetchDashboardVideos() {
    try {
        // Fetch Generated Videos from Backend
        const token = localStorage.getItem("token");
        const headers = token ? { "Authorization": `Bearer ${token}` } : {};
        const res = await fetch(`${API_BASE}/upload/my-videos`, {
            method: "GET",
            headers: headers
        });

        const data = await res.json();
        if (data.success) {
            // Update stats
            const totalVideosEl = document.querySelector('.stat-value');
            if (totalVideosEl) totalVideosEl.textContent = data.videos.length;

            if (data.videos.length > 0) {
                // Show only the most recent 3 videos on dashboard
                const recentVideos = data.videos.slice(0, 3).map(file => ({
                    id: file._id,
                    title: file.originalName.replace(/\.[^/.]+$/, "") + " Analysis",
                    date: file.updatedAt,
                    status: 'Completed', // All videos are completed
                    source: `${API_BASE.replace('/api', '')}/uploads/${file.videoPath}`,
                    type: 'local',
                    size: file.size || 'Unknown',
                    duration: 'Unknown'
                }));

                renderDashboardVideos(recentVideos);
            }
        }
    } catch (err) {
        console.error("Error fetching dashboard videos:", err);
    }
}

// ------------------ RENDER DASHBOARD VIDEOS ------------------
function renderDashboardVideos(videos) {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    grid.innerHTML = '';

    videos.forEach(video => {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.onclick = () => openVideoModal(video.id);

        // All videos are completed
        const thumbnailHtml = `
            <div class="video-thumbnail">
                <div style="position:absolute; inset:0; background: #1f2937; display:flex; align-items:center; justify-content:center;">
                    <span style="font-size: 2rem;">🎬</span>
                </div>
                <div class="play-icon">▶</div>
            </div>
        `;

        card.innerHTML = `
            ${thumbnailHtml}
            <div class="video-info">
                <div class="video-title">${video.title}</div>
                <div class="video-meta">
                    <span>${new Date(video.date).toLocaleDateString()}</span>
                    <span class="video-status">✓ Completed</span>
                </div>
                <div class="video-actions">
                    <button class="action-btn" onclick="event.stopPropagation(); downloadVideo('${video.id}')">Download</button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ------------------ VIDEO MODAL FUNCTIONS ------------------
function openVideoModal(videoId) {
    // Use the same logic as videosgen.js - find video from cache or fetch
    // For simplicity, redirect to videosgen.html for full functionality
    window.location.href = 'videosgen.html';
}

function downloadVideo(videoId) {
    // Simple download - could be enhanced
    alert('Download functionality available on Videos page');
    window.location.href = 'videosgen.html';
}

function shareVideo(videoId) {
    alert('Share functionality available on Videos page');
    window.location.href = 'videosgen.html';
}

function deleteVideo(videoId) {
    alert('Delete functionality available on Videos page');
    window.location.href = 'videosgen.html';
}

// Expose functions globally
window.openVideoModal = openVideoModal;
window.downloadVideo = downloadVideo;
window.shareVideo = shareVideo;
window.deleteVideo = deleteVideo;

console.log("✅ Dashboard loaded with smart beforeunload protection");
