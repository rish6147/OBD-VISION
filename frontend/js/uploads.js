// ------------------ PAGE NAVIGATION ------------------
function showPage(page) {
    document.getElementById('filesPage').style.display = page === 'files' ? 'block' : 'none';
    document.getElementById('videosPage').style.display = page === 'videos' ? 'block' : 'none';

    document.getElementById('filesNav').classList.toggle('active', page === 'files');
    document.getElementById('videosNav').classList.toggle('active', page === 'videos');
}

// ------------------ GRID/LIST TOGGLE ------------------
function toggleView(view) {
    const grid = document.getElementById('filesGrid');
    const list = document.getElementById('filesList');
    const btns = document.querySelectorAll('.view-btn');

    if (view === 'grid') {
        grid.style.display = 'grid';
        list.style.display = 'none';
        btns[0].classList.add('active');
        btns[1].classList.remove('active');
    } else {
        grid.style.display = 'none';
        list.style.display = 'block';
        btns[1].classList.add('active');
        btns[0].classList.remove('active');
    }
}

// ------------------ MODALS ------------------
function openFileModal(file) {
    document.getElementById('previewFileName').textContent = file.originalName;
    document.getElementById('previewFileSize').textContent = formatFileSize(file.size);
    document.getElementById('previewFileDate').textContent = new Date(file.uploadedAt).toLocaleString();

    const ext = file.originalName.split('.').pop().toLowerCase();
    const icon = ext === 'csv' ? '📊' : '📈';
    document.getElementById('previewIcon').textContent = icon;

    const modal = document.getElementById('fileModal');
    modal.classList.add('show');

    const buttons = modal.querySelectorAll('.action-btn');
    buttons[0].onclick = () => downloadFile(file);
    buttons[1].onclick = () => shareFile(file);
    buttons[2].onclick = () => deleteFile(file);
}

function closeFileModal() {
    document.getElementById('fileModal').classList.remove('show');
}

// Close modal when clicking outside
document.getElementById('fileModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeFileModal();
});

// ------------------ BACKEND ------------------
const API_BASE = "http://127.0.0.1:5000/api";

// Global cache for uploads
window.uploadsCache = [];

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
        }
    } catch (e) { console.error(e); }
}

// Fetch all uploads
async function fetchUserUploads() {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
        const res = await fetch(`${API_BASE}/upload/my-uploads`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            displayUserUploads(data.uploads);
        }
    } catch (err) {
        console.error("Error fetching uploads:", err);
    }
}

// Display uploads in grid/list
function displayUserUploads(uploads) {
    window.uploadsCache = uploads;

    const grid = document.getElementById('filesGrid');
    const list = document.getElementById('filesList');
    grid.innerHTML = '';
    list.innerHTML = '';

    uploads.forEach(file => {
        // --- Grid View ---
        const gridItem = document.createElement("div");
        gridItem.className = "file-card";
        gridItem.innerHTML = `
            <div class="file-name">${file.originalName}</div>
            <div class="file-date">${new Date(file.uploadedAt).toLocaleDateString()}</div>
            <div class="file-actions">
                <button onclick="downloadFileFromList('${file._id}')">📥</button>
                <button onclick="deleteFileFromList('${file._id}')">🗑️</button>
            </div>
        `;
        gridItem.onclick = e => { if (!e.target.closest('button')) openFileModal(file); };
        grid.appendChild(gridItem);

        // --- List View ---
        const listItem = document.createElement("div");
        listItem.className = "file-list-item";
        listItem.innerHTML = `
            <span class="file-name">${file.originalName}</span>
            <span class="file-date">${new Date(file.uploadedAt).toLocaleString()}</span>
            <div class="file-actions">
                <button onclick="downloadFileFromList('${file._id}')">📥</button>
                <button onclick="deleteFileFromList('${file._id}')">🗑️</button>
            </div>
        `;
        listItem.onclick = e => { if (!e.target.closest('button')) openFileModal(file); };
        list.appendChild(listItem);
    });
}

// ------------------ FILE ACTIONS ------------------
async function downloadFile(file) {
    const token = localStorage.getItem("token");
    try {
        const res = await fetch(`${API_BASE}/upload/download/${file._id}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Download failed");

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.originalName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        console.error(err);
        alert("⚠️ Failed to download file");
    }
}

function shareFile(file) {
    const link = `${window.location.origin}/uploads.html?fileId=${file._id}`;
    navigator.clipboard.writeText(link);
    alert("🔗 Link copied to clipboard!");
}

async function deleteFile(file) {
    if (!file._id) return alert("⚠️ Invalid file ID");
    const confirmDel = confirm(`Are you sure you want to delete "${file.originalName}"?`);
    if (!confirmDel) return;

    const token = localStorage.getItem("token");
    try {
        const res = await fetch(`${API_BASE}/upload/${file._id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (!res.ok) {
            const text = await res.text();
            console.error("Delete failed:", text);
            alert("⚠️ Delete failed. See console for details.");
            return;
        }

        const data = await res.json();
        if (data.success) {
            alert(`🗑️ "${file.originalName}" deleted!`);
            fetchUserUploads();
            closeFileModal();
        } else {
            alert("⚠️ Delete failed!");
        }
    } catch (err) {
        console.error(err);
        alert("⚠️ Server error during deletion");
    }
}

// Shortcut functions for buttons
function downloadFileFromList(fileId) {
    const file = window.uploadsCache.find(f => f._id === fileId);
    if (file) downloadFile(file);
}

function deleteFileFromList(fileId) {
    const file = window.uploadsCache.find(f => f._id === fileId);
    if (file) deleteFile(file);
}

// ------------------ UTILITY ------------------
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Fetch uploads on page load
window.addEventListener("DOMContentLoaded", () => {
    fetchUser();
    fetchUserUploads();
});
