// ------------------ CONFIG ------------------
const API_BASE = "http://127.0.0.1:5000/api";

// ------------------ GLOBAL STATE ------------------
let currentVideo = null;
window.videosCache = []; // Stores all videos (local + external)

// ------------------ INITIALIZATION ------------------
window.addEventListener("DOMContentLoaded", () => {
    fetchUser();
    fetchUserVideos();
    setupSearchFilter();
});

// ------------------ FETCH USER ------------------
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
        }
    } catch (e) { console.error(e); }
}

// ------------------ FETCH VIDEOS ------------------
async function fetchUserVideos() {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
        // 1. Fetch Generated Videos from Backend
        const res = await fetch(`${API_BASE}/upload/my-videos`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` }
        });

        const data = await res.json();
        let generatedVideos = [];

        if (data.success) {
            // Map videos with their actual status from backend
            generatedVideos = data.videos.map(file => ({
                id: file._id,
                title: file.originalName.replace(/\.[^/.]+$/, "") + " Analysis", // Remove extension, add suffix
                date: file.updatedAt,
                status: 'Completed', // All videos are completed
                // CRITICAL: Construct the full URL to the video file
                // Assumes server serves /uploads at root level
                source: file.videoPath ? `${API_BASE.replace('/api', '')}/uploads/${file.videoPath}` : '',
                type: 'local', // Marker for internal video
                size: file.size || 'Unknown',
                duration: 'Unknown' // Duration isn't stored in DB yet
            }));
        }

        // 2. Define External Videos (Hardcoded Demos)
        const externalVideos = [
            {
                id: 'ext-1',
                title: 'External Demo: High Speed Drive',
                date: new Date().toISOString(),
                status: 'External',
                source: 'https://www.w3schools.com/html/mov_bbb.mp4', // Example public URL
                type: 'external',
                size: 1500000,
                duration: '0:10'
            },
            {
                id: 'ext-2',
                title: 'External Demo: City Traffic Analysis',
                date: new Date().toISOString(),
                status: 'External',
                source: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
                type: 'external',
                size: 2500000,
                duration: '0:52'
            }
        ];

        // 3. Merge and Render
        window.videosCache = [...generatedVideos, ...externalVideos];
        updateStatsBar(window.videosCache);
        renderVideoGrid(window.videosCache);

    } catch (err) {
        console.error("Error fetching videos:", err);
    }
}

// ------------------ RENDER GRID ------------------
function renderVideoGrid(videos) {
    const grid = document.getElementById('videoGrid');

    if (!grid) return;
    grid.innerHTML = '';

    if (videos.length === 0) {
        grid.innerHTML = '<p style="color:#666; padding:20px; text-align:center;">No videos found. Create one from the dashboard!</p>';
        return;
    }

    videos.forEach(video => {
        const card = document.createElement('div');
        card.className = 'video-card';
        // Add click handler to open modal
        card.onclick = () => openVideoModal(video.id);

        // Determine thumbnail style based on status
        let thumbnailHtml;
        if (video.status === 'Processing') {
            thumbnailHtml = `
                <div class="video-thumbnail processing">
                    <div style="position:absolute; inset:0; background: #f59e0b; display:flex; align-items:center; justify-content:center; flex-direction:column;">
                        <div class="processing-spinner" style="width:40px; height:40px; border:4px solid #fff; border-top:4px solid transparent; border-radius:50%; animation:spin 1s linear infinite; margin-bottom:8px;"></div>
                        <span style="font-size: 1.2rem; color:white; font-weight:600;">Processing</span>
                    </div>
                </div>
            `;
        } else {
            thumbnailHtml = `
                <div class="video-thumbnail">
                    <div style="position:absolute; inset:0; background: #1f2937; display:flex; align-items:center; justify-content:center;">
                        <span style="font-size: 3rem;">🎬</span>
                    </div>
                    <div class="play-icon">▶</div>
                    ${video.duration !== 'Unknown' ? `<div class="video-duration">${video.duration}</div>` : ''}
                </div>
            `;
        }

        card.innerHTML = `
            ${thumbnailHtml}
            <div class="video-info">
                <div class="video-title">${video.title}</div>
                <div class="video-meta">
                    <span>${new Date(video.date).toLocaleDateString()}</span>
                    <span class="video-status ${video.type === 'external' ? 'status-external' : 'status-completed'}">${video.type === 'external' ? video.status : 'Completed'}</span>
                </div>
                <div class="video-actions">
                    <button class="action-btn" onclick="event.stopPropagation(); downloadVideo('${video.id}')">Download</button>
                    <button class="action-btn" onclick="event.stopPropagation(); shareVideo('${video.id}')">Share</button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ------------------ MODAL & PLAYER ------------------
function openVideoModal(videoId) {
    const video = window.videosCache.find(v => v.id === videoId);
    if (!video) return;

    currentVideo = video;

    // Update Modal Info
    document.getElementById('videoModalTitle').textContent = video.title;
    const dateEl = document.getElementById('modalDate');
    const sizeEl = document.getElementById('modalSize');
    const durEl = document.getElementById('modalDuration');

    if(dateEl) dateEl.textContent = new Date(video.date).toLocaleString();
    if(sizeEl) sizeEl.textContent = formatFileSize(video.size);
    if(durEl) durEl.textContent = video.duration;

    // Setup Player
    const player = document.getElementById('videoPlayer');
    if (player) {
        player.src = video.source;
        player.load();
    }

    // Show Modal
    const modal = document.getElementById('videoModal');
    modal.classList.add('show');
    modal.style.display = 'flex';
}

function closeVideoModal() {
    const modal = document.getElementById('videoModal');
    modal.classList.remove('show');
    modal.style.display = 'none';

    // Stop video playback
    const player = document.getElementById('videoPlayer');
    if (player) {
        player.pause();
        player.src = "";
    }
}

// ------------------ ACTIONS ------------------
function downloadVideo(videoId) {
    const video = window.videosCache.find(v => v.id === videoId);
    if (!video) return;

    // Create a direct download link to the video file
    const link = document.createElement('a');
    link.href = video.source;
    link.download = video.title + ".mp4"; // Suggest filename
    link.target = "_blank";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function shareVideo(videoId) {
    const video = window.videosCache.find(v => v.id === videoId);
    if (!video) return;

    navigator.clipboard.writeText(video.source)
        .then(() => alert("Video URL copied to clipboard!"))
        .catch(() => alert("Failed to copy URL"));
}

// Wrapper functions for modal buttons (which don't pass ID)
function downloadVideoFromModal() {
    if(currentVideo) downloadVideo(currentVideo.id);
}

function shareVideoFromModal() {
    if(currentVideo) shareVideo(currentVideo.id);
}

function deleteVideoFromModal() {
    if(!currentVideo) return;
    if(currentVideo.type === 'external') {
        alert("Cannot delete external demo videos.");
        return;
    }

    if(confirm("Delete this video? This cannot be undone.")) {
        // Call the delete API
        deleteFile(currentVideo.id); // Uses existing logic from uploads.js if available globally
    }
}

// ------------------ UTILS ------------------
function setupSearchFilter() {
    const searchInput = document.getElementById('videoSearch');
    const statusFilter = document.getElementById('videoStatusFilter');
    const sortFilter = document.getElementById('videoSortFilter');

    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterAndRender();
        });
    }

    if(statusFilter) {
        statusFilter.addEventListener('change', () => {
            filterAndRender();
        });
    }

    if(sortFilter) {
        sortFilter.addEventListener('change', () => {
            filterAndRender();
        });
    }
}

function filterAndRender() {
    const searchTerm = document.getElementById('videoSearch')?.value.toLowerCase() || '';
    const statusType = document.getElementById('videoStatusFilter')?.value || 'all';

    const filtered = window.videosCache.filter(v => {
        const matchesSearch = v.title.toLowerCase().includes(searchTerm);
        const matchesStatus = statusType === 'all' ? true :
                              statusType === 'completed' ? (v.status === 'Completed' || v.type === 'external') :
                              statusType === 'external' ? v.status === 'External' : true;
        return matchesSearch && matchesStatus;
    });

    updateStatsBar(filtered);
    renderVideoGrid(filtered);
}

function updateStatsBar(videos) {
    const totalVideos = videos.length;
    const completedVideos = videos.filter(v => v.status === 'Completed' || v.type === 'external').length;
    const totalSize = videos.reduce((sum, v) => {
        if (typeof v.size === 'number') return sum + v.size;
        return sum;
    }, 0);

    // Update the stats bar elements
    const statItems = document.querySelectorAll('.stats-bar .stat-value');
    if (statItems.length >= 4) {
        statItems[0].textContent = totalVideos;
        statItems[1].textContent = completedVideos;
        statItems[2].textContent = 0; // No processing videos
        statItems[3].textContent = formatFileSize(totalSize);
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Expose functions globally for HTML onclick attributes
window.openVideoModal = openVideoModal;
window.closeVideoModal = closeVideoModal;
window.downloadVideo = downloadVideo;
window.shareVideo = shareVideo;
window.downloadVideoFromModal = downloadVideoFromModal;
window.shareVideoFromModal = shareVideoFromModal;
window.deleteVideoFromModal = deleteVideoFromModal;
