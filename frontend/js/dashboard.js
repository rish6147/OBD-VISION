// ------------------ FETCH CURRENT USER INFO ------------------
const API_BASE = "http://127.0.0.1:5000/api";

async function fetchUser() {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
        const res = await fetch(`${API_BASE}/user/me`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            }
        });

        const data = await res.json();
        if (data.success) updateUserUI(data.user);
    } catch (err) {
        console.error("Error fetching user:", err);
    }
}

function updateUserUI(user) {
    const navbarName = document.getElementById("navbar-username");
    const navbarEmail = document.getElementById("navbar-email");
    if (navbarName) navbarName.textContent = `${user.firstName} ${user.lastName}`;
    if (navbarEmail) navbarEmail.textContent = user.email;

    const welcomeMsg = document.getElementById("welcome-msg");
    if (welcomeMsg) welcomeMsg.textContent = `Welcome back ${user.firstName}!`;
}

window.addEventListener("DOMContentLoaded", fetchUser);

// ------------------ DASHBOARD JS ------------------
let selectedFile = null;

// Handle file selection (no upload yet)
function handleDataUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    selectedFile = file;
    document.getElementById('dataUploadArea').classList.add('active');
    document.getElementById('dataFileName').textContent = file.name;
    document.getElementById('dataFileSize').textContent = formatFileSize(file.size);
    document.getElementById('dataFileInfo').classList.add('show');
    document.getElementById('generateBtn').disabled = false; // enable generate button
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// ------------------ VIDEO GENERATION ------------------
async function generateVideo() {
    if (!selectedFile) {
        alert("⚠️ Please choose a file first!");
        return;
    }

    // Upload file first
    const token = localStorage.getItem("token");
    if (!token) {
        alert("⚠️ You must be logged in to upload files!");
        return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
        const uploadRes = await fetch(`${API_BASE}/upload/upload`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` },
            body: formData
        });

        const uploadData = await uploadRes.json();
        
        if (!uploadData.success) {
            alert("⚠️ Upload failed: " + (uploadData.error || "Unknown error"));
            return;
        }

        // Now trigger video generation with the uploaded file ID
        const fileId = uploadData.upload._id;
        startVideoGeneration(fileId);

    } catch (err) {
        console.error(err);
        alert("⚠️ Server error during file upload");
    }
}

// Global variable to track generation process
let videoGenerationInProgress = false;
let generationAbortController = null;

function startVideoGeneration(fileId) {
    const token = localStorage.getItem("token");

    console.log('startVideoGeneration called with fileId:', fileId);
    videoGenerationInProgress = true;
    generationAbortController = new AbortController();

    // Show loading modal
    showLoadingModal();
    addLog('Starting video generation...', 'progress');

    try {
        // Create fetch request with body and read the response stream.
        fetch(`${API_BASE}/upload/generate-video`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ fileId: fileId }),
            signal: generationAbortController.signal
        })
        .then(response => {
            console.log('Fetch response received:', response.status, response.ok);
            if (!response.ok) throw new Error('Network error: ' + response.status);
            if (!response.body) throw new Error('ReadableStream not supported by this browser/server response.');
            return response.body.getReader();
        })
        .then(reader => {
            console.log('Reader obtained, starting to read stream');
            const decoder = new TextDecoder();
            let buffer = '';

            function read() {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        console.log('Video generation stream completed (reader done)');
                        addLog('Stream finished by server', 'progress');

                        // Wait for explicit success/error from backend instead of assuming completion
                        return;
                    }

                    // Append chunk and split into lines
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');

                    // Iterate through all complete lines (keep incomplete remainder)
                    for (let i = 0; i < lines.length - 1; i++) {
                        const raw = lines[i].trim();
                        if (!raw) continue;

                        // Accept both "data: {...}" and plain JSON lines
                        let jsonText = raw;
                        if (raw.startsWith('data:')) {
                            jsonText = raw.slice(5).trim();
                        }

                        try {
                            const parsed = JSON.parse(jsonText);
                            console.log('Parsed progress data:', parsed);
                            try {
                                handleProgressUpdate(parsed);
                            } catch (handlerErr) {
                                console.error('Error in handleProgressUpdate:', handlerErr);
                                addLog('Error updating progress: ' + handlerErr.message, 'error');
                                // continue streaming
                            }
                        } catch (parseErr) {
                            // Not JSON — log raw message (safe fallback)
                            console.warn('Non-JSON stream data:', raw);
                            addLog(raw, 'progress');
                        }
                    }

                    // Keep remainder
                    buffer = lines[lines.length - 1];
                    return read();
                });
            }

            return read();
        })
        .catch(err => {
            console.error('Caught error in video generation:', err);
            if (err.name === 'AbortError') {
                console.log('Video generation cancelled');
                addLog('Generation cancelled by user', 'warning');
                updateActivityMessage('Generation cancelled.');
                markGenerationCancelledUI();
            } else {
                console.error('Error:', err);
                addLog('Error: ' + err.message, 'error');
                // Provide user-friendly message and keep modal open so user sees logs
                updateActivityMessage('❌ Error: ' + err.message);
                updateStep(7, 'error');
                updateStepDetail(7, 'Failed');

                // Ensure Cancel hidden, Done visible so user can close
                const cancelBtn = document.getElementById('cancelBtn');
                const doneBtn = document.getElementById('doneBtn');
                if (cancelBtn) cancelBtn.style.display = 'none';
                if (doneBtn) {
                    doneBtn.style.display = 'block';
                    doneBtn.textContent = 'Close';
                }

                videoGenerationInProgress = false;
            }
        });
    } catch (syncErr) {
        console.error('Synchronous error in startVideoGeneration:', syncErr);
        addLog('Synchronous error: ' + syncErr.message, 'error');
        updateActivityMessage('❌ Unexpected error occurred');
        updateStep(7, 'error');
        updateStepDetail(7, 'Failed');
        videoGenerationInProgress = false;
    }
}

function cancelVideoGeneration() {
    if (generationAbortController && videoGenerationInProgress) {
        generationAbortController.abort();
        videoGenerationInProgress = false;
        addLog('Cancellation requested...', 'warning');

        // Provide short delay to let the abort flow propagate, then update UI
        setTimeout(() => {
            // Keep modal visible but show that it was cancelled and allow user to Close
            updateActivityMessage('Generation cancelled by user.');
            markGenerationCancelledUI();
        }, 300);
    } else {
        // If no active generation, just close modal
        closeLoadingModal();
    }
}

function handleProgressUpdate(data) {
    try {
        if (!data) return;
        console.log('Progress update:', data);
        addLog(data.message || `Stage: ${data.status || 'unknown'}`, 'progress');

        // Status-normalization
        const status = (data.status || '').toString().toLowerCase();

        // numeric progress if given
        if (typeof data.progress === 'number') {
            const pct = Math.max(0, Math.min(100, Math.round(data.progress)));
            updateProgress(pct);
            updateActivityMessage(`Processing... ${pct}% complete`);
        }

        // status-specific handling
        if (status === 'started') {
            updateProgress(5);
            updateStep(1, 'active');
            updateActivityMessage('Initializing video generation...');
            addLog('Video generation started', 'progress');
        } else if (status === 'processing') {
            const step = data.step || data.phase || 'Processing';
            updateActivityMessage(`${step}...`);

            // map known step names to UI values
            if (/loading/i.test(step) || /data/i.test(step)) {
                updateProgress(data.progress ?? 10);
                updateStep(1, 'active');
                updateStepDetail(1, data.detail ?? 'Loading GPS data...');
                addLog('Loading GPS data', 'progress');
            } else if (/map/i.test(step) || /matching/i.test(step)) {
                updateProgress(data.progress ?? 25);
                updateStep(1, 'completed');
                updateStep(2, 'active');
                updateStepDetail(2, data.detail ?? 'Matching to road network...');
                addLog('Map matching', 'progress');
            } else if (/stop/i.test(step) || /detection/i.test(step)) {
                updateProgress(data.progress ?? 35);
                updateStep(2, 'completed');
                updateStep(3, 'active');
                updateStepDetail(3, data.detail ?? 'Detecting stops...');
                addLog('Stop detection', 'progress');
            } else if (/photo/i.test(step) || /capture/i.test(step)) {
                updateProgress(data.progress ?? 45);
                updateStep(3, 'completed');
                updateStep(4, 'active');
                updateStepDetail(4, data.detail ?? 'Capturing photos...');
                addLog('Capturing photos', 'progress');
            } else if (/frame/i.test(step) || /generation/i.test(step)) {
                updateProgress(data.progress ?? 55);
                updateStep(4, 'completed');
                updateStep(5, 'active');
                updateStepDetail(5, data.detail ?? 'Generating frames...');
                addLog('Frame generation', 'progress');
            } else if (/html/i.test(step) || /viewer/i.test(step)) {
                updateProgress(data.progress ?? 60);
                updateStep(5, 'completed');
                updateStep(6, 'active');
                updateStepDetail(6, data.detail ?? 'Creating viewer...');
                addLog('HTML generation', 'progress');
            } else if (/render/i.test(step)) {
                updateProgress(data.progress ?? 75);
                updateStep(6, 'completed');
                updateStep(7, 'active');
                updateStepDetail(7, data.detail ?? 'Rendering frames...');
                addLog('Rendering video frames', 'progress');
            } else {
                // fallback: use any numeric progress or just show stage message
                if (typeof data.progress !== 'number') updateProgress(50);
                updateStepDetail(3, data.detail || '');
            }
        } else if (status === 'rendering') {
            updateActivityMessage(`Rendering video - ${data.progress ?? ''}%`);
            if (typeof data.progress !== 'number') {
                updateProgress(75);
            } else {
                updateProgress(data.progress);
            }
            updateStep(6, 'completed');
            updateStep(7, 'active');
            updateStepDetail(7, data.detail ?? 'Rendering in progress...');
            addLog('Video rendering in progress', 'progress');
        } else if (status === 'success') {
            // Completed!
            updateProgress(100);
            updateStep(7, 'completed');
            updateActivityMessage('Video generation completed! Click Done to close.');
            updateStepDetail(7, 'Complete');
            addLog('Video generated successfully!', 'success');
            videoGenerationInProgress = false;
            markGenerationFinishedUI();

            // Note: Videos list refresh moved to modal close to prevent modal vanishing
        } else if (status === 'completed') {
            // Handle 'completed' status as success
            updateProgress(100);
            updateStep(7, 'completed');
            updateActivityMessage('Video generation completed! Click Done to close.');
            updateStepDetail(7, 'Complete');
            addLog('Video generated successfully!', 'success');
            videoGenerationInProgress = false;
            markGenerationFinishedUI();

            // Note: Videos list refresh moved to modal close to prevent modal vanishing
        } else if (status === 'error' || data.error) {
            const errorMsg = data.message || 'Video generation failed';
            addLog('Error: ' + errorMsg, 'error');
            updateActivityMessage('❌ Error: ' + errorMsg + ' Click Close to exit.');
            updateStep(7, 'error');
            updateStepDetail(7, 'Failed');
            videoGenerationInProgress = false;

            const cancelBtn = document.getElementById('cancelBtn');
            const doneBtn = document.getElementById('doneBtn');
            const closeBtn = document.getElementById('closeBtn');
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (doneBtn) doneBtn.style.display = 'none';
            if (closeBtn) closeBtn.style.display = 'block';

            // Keep modal open so user can see the error message and close manually
        } else {
            // unknown status - just log
            addLog(JSON.stringify(data), 'progress');
        }
    } catch (error) {
        console.error('Error in handleProgressUpdate:', error);
        addLog('Error updating progress: ' + error.message, 'error');
        // Don't crash - keep modal open and continue processing
    }
}

// UI helpers after finished/cancelled
function markGenerationFinishedUI() {
    const cancelBtn = document.getElementById('cancelBtn');
    const doneBtn = document.getElementById('doneBtn');
    const closeBtn = document.getElementById('closeBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (doneBtn) {
        doneBtn.style.display = 'block';
        doneBtn.disabled = true; // disable to prevent instant clicking
        doneBtn.textContent = 'Processing...';
        // Enable after a short delay to ensure modal stays visible
        setTimeout(() => {
            doneBtn.disabled = false;
            doneBtn.textContent = 'Done';
        }, 2000);
    }
    if (closeBtn) closeBtn.style.display = 'none';
    // ensure logs are visible so user can inspect final messages if desired
    const logsContent = document.getElementById('logsContent');
    const toggleBtn = document.querySelector('.logs-toggle');
    if (logsContent && !logsContent.classList.contains('show')) {
        // don't force open logs — keep hidden but ensure toggle label accurate
        if (toggleBtn) toggleBtn.textContent = 'Show';
    }
}

function markGenerationCancelledUI() {
    updateStep(7, 'error');
    updateStepDetail(7, 'Cancelled');
    const cancelBtn = document.getElementById('cancelBtn');
    const doneBtn = document.getElementById('doneBtn');
    const closeBtn = document.getElementById('closeBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (doneBtn) doneBtn.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'block';
}

// Reset UI after generation
function resetUploadUI() {
    selectedFile = null;
    const dataUploadAreaEl = document.getElementById('dataUploadArea');
    if (dataUploadAreaEl) dataUploadAreaEl.classList.remove('active');
    const info = document.getElementById('dataFileInfo');
    if (info) info.classList.remove('show');
    const dataFileInput = document.getElementById('dataFile');
    if (dataFileInput) dataFileInput.value = '';
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) generateBtn.disabled = true;
}

// Helper function to update activity message
function updateActivityMessage(message) {
    const activityEl = document.getElementById('activityMessage');
    if (activityEl) {
        activityEl.textContent = message;
    }
}

// Helper function to update step details
function updateStepDetail(stepNumber, detail) {
    const stepDetail = document.getElementById('step' + stepNumber + '-detail');
    if (stepDetail) {
        stepDetail.textContent = detail;
    }
}

// Helper function to add log entries
function addLog(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const logsContent = document.getElementById('logsContent');
    if (!logContainer) return;
    
    const logItem = document.createElement('div');
    // normalize type for styling
    const normalizedType = ['progress','success','error','warning'].includes(type) ? type : 'info';
    logItem.className = 'log-item ' + normalizedType;
    const timestamp = new Date().toLocaleTimeString();
    logItem.textContent = `[${timestamp}] ${message}`;
    logContainer.appendChild(logItem);
    
    // Auto-scroll logs area (if present)
    if (logsContent) {
        logsContent.scrollTop = logsContent.scrollHeight;
    } else {
        // fallback scroll parent
        logContainer.parentElement && (logContainer.parentElement.scrollTop = logContainer.parentElement.scrollHeight);
    }
}

// Toggle logs visibility
function toggleLogsVisibility() {
    const logsContent = document.getElementById('logsContent');
    const toggleBtn = document.querySelector('.logs-toggle');
    
    if (logsContent) {
        logsContent.classList.toggle('show');
        if (toggleBtn) {
            toggleBtn.textContent = logsContent.classList.contains('show') ? 'Hide' : 'Show';
        }
    }
}

// ------------------ LOADING MODAL ------------------
function showLoadingModal() {
    const modal = document.getElementById('loadingModal');
    if (!modal) {
        console.error('Loading modal element not found!');
        return;
    }

    // FORCE visibility - ignore broken CSS
    modal.style.display = 'flex';            // Makes it visible
    modal.style.opacity = '1';               // Prevent fade bug
    modal.style.pointerEvents = 'auto';      // Allow clicks
    modal.style.transform = 'scale(1)';      // Cancel shrinking
    modal.style.zIndex = '99999';            // Top of everything
    modal.classList.add('show');             // Still keep transition

    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';

    // Logs
    const logContainer = document.getElementById('logContainer');
    if (logContainer) {
        logContainer.innerHTML = '<div class="log-item" style="color: #6366f1; font-weight: 600;">Connecting to backend...</div>';
    }

    const logsContent = document.getElementById('logsContent');
    if (logsContent) logsContent.classList.remove('show');

    const toggleBtn = document.querySelector('.logs-toggle');
    if (toggleBtn) toggleBtn.textContent = 'Show';

    updateProgress(0);
    resetSteps();
    updateStep(1, 'active');
    updateActivityMessage('Starting video generation...');
}


function closeLoadingModal() {
    const modal = document.getElementById('loadingModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = 'none';
    // Restore scrolling
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';

    // Reset UI and buttons after modal closes
    resetUploadUI();
    const cancelBtn = document.getElementById('cancelBtn');
    const doneBtn = document.getElementById('doneBtn');
    if (cancelBtn) cancelBtn.style.display = 'block';
    if (doneBtn) doneBtn.style.display = 'none';

    // Refresh videos list after modal closes to prevent modal vanishing
    if (typeof loadUserVideos === 'function') {
        loadUserVideos();
    }
}

// Update progress bar visually
function updateProgress(percentage) {
    const fill = document.getElementById('progressFill');
    const text = document.getElementById('loadingPercentage');
    if (fill) fill.style.width = percentage + '%';
    if (text) text.textContent = percentage + '%';
}

// Reset step UI
function resetSteps() {
    for (let i = 1; i <= 7; i++) {
        const step = document.getElementById('step' + i);
        if (!step) continue;
        step.classList.remove('active', 'completed', 'error');
        const icon = step.querySelector('.step-icon');
        if (icon) icon.textContent = '⏳';
        const detail = step.querySelector('.step-detail');
        if (detail) detail.textContent = '';
    }
}

// Update step status
function updateStep(stepNumber, status) {
    const step = document.getElementById('step' + stepNumber);
    if (!step) return;
    step.classList.remove('active', 'completed', 'error');
    const icon = step.querySelector('.step-icon');
    if (status === 'active') {
        step.classList.add('active');
        if (icon) icon.textContent = '⏳';
    } else if (status === 'completed') {
        step.classList.add('completed');
        if (icon) icon.textContent = '✓';
    } else if (status === 'error') {
        step.classList.add('error');
        if (icon) icon.textContent = '✖';
    }
}

// ------------------ VIDEO MODAL FUNCTIONS ------------------
let currentVideoTitle = '';

function openVideoModal(title, date) {
    currentVideoTitle = title;
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalDate').textContent = date;
    document.getElementById('videoModal').classList.add('show');
}

function closeVideoModal() {
    document.getElementById('videoModal').classList.remove('show');
}

function downloadVideo() {
    alert(`📥 Downloading "${currentVideoTitle}"...`);
}

function shareVideo() {
    alert(`🔗 Share link for "${currentVideoTitle}" copied to clipboard!`);
}

function deleteVideo() {
    if (confirm(`Are you sure you want to delete "${currentVideoTitle}"?`)) {
        alert(`🗑️ Video "${currentVideoTitle}" deleted successfully!`);
        closeVideoModal();
        // Reload or remove the card from DOM
        location.reload();
    }
}

// Close modal when clicking outside
document.getElementById('videoModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeVideoModal();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeVideoModal();
    }
});

// ------------------ DRAG & DROP ------------------
const dataUploadArea = document.getElementById('dataUploadArea');
if (dataUploadArea) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dataUploadArea.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dataUploadArea.addEventListener(eventName, () => {
            dataUploadArea.style.borderColor = 'var(--primary)';
            dataUploadArea.style.background = 'rgba(99, 102, 241, 0.05)';
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dataUploadArea.addEventListener(eventName, () => {
            dataUploadArea.style.borderColor = '#cbd5e1';
            dataUploadArea.style.background = '#fafafa';
        }, false);
    });

    dataUploadArea.addEventListener('drop', handleDataDrop, false);
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDataDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
        const event = { target: { files: files } };
        handleDataUpload(event);
    }
}
