// ------------------ FETCH CURRENT USER INFO ------------------
const API_BASE = "http://127.0.0.1:5000/api"; // backend API base

async function fetchUser() {
    const token = localStorage.getItem("token"); // JWT token stored at login
    if (!token) return; // if no token, skip

    try {
        const res = await fetch(`${API_BASE}/user/me`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            }
        });

        const data = await res.json();
        if (data.success) {
            updateUserUI(data.user);
        }
    } catch (err) {
        console.error("Error fetching user:", err);
    }
}

function updateUserUI(user) {
    // Update navbar
    const navbarName = document.getElementById("navbar-username");
    const navbarEmail = document.getElementById("navbar-email");
    if (navbarName) navbarName.textContent = `${user.firstName} ${user.lastName}`;
    if (navbarEmail) navbarEmail.textContent = user.email;

    // Update welcome message
    const welcomeMsg = document.getElementById("welcome-msg");
    if (welcomeMsg) welcomeMsg.textContent = `Welcome back ${user.firstName}!`;
}

// Call fetchUser when page loads
window.addEventListener("DOMContentLoaded", fetchUser);


// ------------------ EXISTING DASHBOARD JS ------------------
let dataFileUploaded = false;

// Handle OBD-II Data Upload
function handleDataUpload(event) {
    const file = event.target.files[0];
    if (file) {
        document.getElementById('dataUploadArea').classList.add('active');
        document.getElementById('dataFileName').textContent = file.name;
        document.getElementById('dataFileSize').textContent = formatFileSize(file.size);
        document.getElementById('dataFileInfo').classList.add('show');
        dataFileUploaded = true;
        checkGenerateButton();
    }
}

// Check if generate button should be enabled
function checkGenerateButton() {
    const generateBtn = document.getElementById('generateBtn');
    if (dataFileUploaded) {
        generateBtn.disabled = false;
    }
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Generate Video
function generateVideo() {
    // Show loading modal
    showLoadingModal();
    
    // Simulate video generation process
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 2;
        updateProgress(progress);
        
        // Update steps based on progress
        if (progress >= 30 && progress < 60) {
            updateStep(1, 'completed');
            updateStep(2, 'active');
        } else if (progress >= 60 && progress < 100) {
            updateStep(2, 'completed');
            updateStep(3, 'active');
        } else if (progress >= 100) {
            updateStep(3, 'completed');
            clearInterval(progressInterval);
            
            // Show success message and close modal
            setTimeout(() => {
                closeLoadingModal();
                alert('🎉 Video generated successfully! Check "Your Videos" section below.');
                
                // Reset form
                document.getElementById('dataUploadArea').classList.remove('active');
                document.getElementById('dataFileInfo').classList.remove('show');
                document.getElementById('dataFile').value = '';
                document.getElementById('generateBtn').disabled = true;
                dataFileUploaded = false;
            }, 500);
        }
    }, 100);
}

// Loading Modal Functions
function showLoadingModal() {
    document.getElementById('loadingModal').classList.add('show');
    updateProgress(0);
    resetSteps();
    updateStep(1, 'active');
}

function closeLoadingModal() {
    document.getElementById('loadingModal').classList.remove('show');
}

function updateProgress(percentage) {
    document.getElementById('progressFill').style.width = percentage + '%';
    document.getElementById('loadingPercentage').textContent = percentage + '%';
}

function resetSteps() {
    for (let i = 1; i <= 3; i++) {
        const step = document.getElementById('step' + i);
        step.classList.remove('active', 'completed');
        step.querySelector('.step-icon').textContent = '⏳';
    }
}

function updateStep(stepNumber, status) {
    const step = document.getElementById('step' + stepNumber);
    step.classList.remove('active', 'completed');
    
    if (status === 'active') {
        step.classList.add('active');
        step.querySelector('.step-icon').textContent = '⏳';
    } else if (status === 'completed') {
        step.classList.add('completed');
        step.querySelector('.step-icon').textContent = '✓';
    }
}

// Open Video Modal
function openVideoModal(title, date) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalDate').textContent = date;
    document.getElementById('videoModal').classList.add('show');
}

// Close Video Modal
function closeVideoModal() {
    document.getElementById('videoModal').classList.remove('show');
}

// Download Video
function downloadVideo() {
    alert('📥 Downloading video...');
}

// Share Video
function shareVideo() {
    alert('🔗 Share link copied to clipboard!');
}

// Delete Video
function deleteVideo() {
    if (confirm('Are you sure you want to delete this video?')) {
        alert('🗑️ Video deleted successfully!');
        closeVideoModal();
    }
}

// Filter tabs functionality
const filterTabs = document.querySelectorAll('.filter-tab');
filterTabs.forEach(tab => {
    tab.addEventListener('click', function() {
        filterTabs.forEach(t => t.classList.remove('active'));
        this.classList.add('active');
    });
});

// Close modal when clicking outside
document.getElementById('videoModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeVideoModal();
    }
});

// Close loading modal when clicking outside (optional)
document.addEventListener('DOMContentLoaded', function() {
    const loadingModal = document.getElementById('loadingModal');
    if (loadingModal) {
        loadingModal.addEventListener('click', function(e) {
            if (e.target === this) {
                // Uncomment if you want to allow closing by clicking outside
                // closeLoadingModal();
            }
        });
    }
});

// Drag and drop for data upload
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
// ------------------ END OF DASHBOARD JS ------------------