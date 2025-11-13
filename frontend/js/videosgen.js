 let currentVideoTitle = '';

        // Search Videos
        function searchVideos() {
            const searchTerm = document.getElementById('videoSearch').value.toLowerCase();
            const videoCards = document.querySelectorAll('.video-card');
            
            videoCards.forEach(card => {
                const title = card.querySelector('.video-title');
                if (title) {
                    const titleText = title.textContent.toLowerCase();
                    card.style.display = titleText.includes(searchTerm) ? 'block' : 'none';
                }
            });
        }

        // Filter Videos
        function filterVideos() {
            const filter = document.getElementById('videoStatusFilter').value;
            const videoCards = document.querySelectorAll('.video-card');
            
            videoCards.forEach(card => {
                const status = card.querySelector('.video-status');
                if (filter === 'all') {
                    card.style.display = 'block';
                } else if (filter === 'completed') {
                    card.style.display = status && status.textContent.includes('Completed') ? 'block' : 'none';
                } else if (filter === 'processing') {
                    card.style.display = status && status.textContent.includes('Processing') ? 'block' : 'none';
                }
            });
        }

        // Sort Videos
        function sortVideos() {
            const sort = document.getElementById('videoSortFilter').value;
            console.log('Sorting by:', sort);
            // Implement sorting logic here
        }

        // Open Video Modal
        function openVideoModal(title, date, duration, size) {
            currentVideoTitle = title;
            document.getElementById('videoModalTitle').textContent = title;
            document.getElementById('modalDate').textContent = date;
            document.getElementById('modalDuration').textContent = duration;
            document.getElementById('modalSize').textContent = size;
            document.getElementById('videoModal').classList.add('show');
        }

        // Close Video Modal
        function closeVideoModal() {
            document.getElementById('videoModal').classList.remove('show');
        }

        // Download Video
        function downloadVideo(title) {
            alert(`📥 Downloading "${title}"...`);
        }

        // Download Video from Modal
        function downloadVideoFromModal() {
            alert(`📥 Downloading "${currentVideoTitle}"...`);
        }

        // Share Video
        function shareVideo(title) {
            alert(`🔗 Share link for "${title}" copied to clipboard!`);
        }

        // Share Video from Modal
        function shareVideoFromModal() {
            alert(`🔗 Share link for "${currentVideoTitle}" copied to clipboard!`);
        }

        // Delete Video from Modal
        function deleteVideoFromModal() {
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