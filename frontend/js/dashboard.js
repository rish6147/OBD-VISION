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

    // Show loading modal first
    showLoadingModal();

    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 2;
        updateProgress(progress);

        if (progress >= 30 && progress < 60) {
            updateStep(1, 'completed');
            updateStep(2, 'active');
        } else if (progress >= 60 && progress < 100) {
            updateStep(2, 'completed');
            updateStep(3, 'active');
        } else if (progress >= 100) {
            updateStep(3, 'completed');
            clearInterval(progressInterval);

            // Upload file to backend AFTER loading modal completes
            uploadFileAfterModal(selectedFile);
        }
    }, 100);
}

// Upload function triggered after loading modal
async function uploadFileAfterModal(file) {
    const token = localStorage.getItem("token");
    if (!token) {
        closeLoadingModal();
        alert("⚠️ You must be logged in to upload files!");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch(`${API_BASE}/upload/upload`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` },
            body: formData
        });

        const data = await res.json();
        closeLoadingModal();

        if (data.success) {
            resetUploadUI();
        } else {
            alert("⚠️ Upload failed: " + (data.error || "Unknown error"));
        }
    } catch (err) {
        closeLoadingModal();
        console.error(err);
        alert("⚠️ Server error during file upload");
    }
}

// Reset UI after generation
function resetUploadUI() {
    selectedFile = null;
    document.getElementById('dataUploadArea').classList.remove('active');
    document.getElementById('dataFileInfo').classList.remove('show');
    document.getElementById('dataFile').value = '';
    document.getElementById('generateBtn').disabled = true;
}

// ------------------ LOADING MODAL ------------------
function showLoadingModal() {
    const modal = document.getElementById('loadingModal');
    if (!modal) return;
    modal.classList.add('show');
    updateProgress(0);
    resetSteps();
    updateStep(1, 'active');
}

function closeLoadingModal() {
    const modal = document.getElementById('loadingModal');
    if (!modal) return;
    modal.classList.remove('show');
}

function updateProgress(percentage) {
    const fill = document.getElementById('progressFill');
    const text = document.getElementById('loadingPercentage');
    if (fill) fill.style.width = percentage + '%';
    if (text) text.textContent = percentage + '%';
}

function resetSteps() {
    for (let i = 1; i <= 3; i++) {
        const step = document.getElementById('step' + i);
        if (!step) continue;
        step.classList.remove('active', 'completed');
        step.querySelector('.step-icon').textContent = '⏳';
    }
}

function updateStep(stepNumber, status) {
    const step = document.getElementById('step' + stepNumber);
    if (!step) return;
    step.classList.remove('active', 'completed');
    if (status === 'active') {
        step.classList.add('active');
        step.querySelector('.step-icon').textContent = '⏳';
    } else if (status === 'completed') {
        step.classList.add('completed');
        step.querySelector('.step-icon').textContent = '✓';
    }
}

// ------------------ DRAG & DROP ------------------
const dataUploadArea = document.getElementById('dataUploadArea');
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dataUploadArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

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

function handleDataDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
        const event = { target: { files: files } };
        handleDataUpload(event);
    }
}
