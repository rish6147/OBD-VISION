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
            alert('🎬 Video generation started! This will take 2-3 minutes. You will be notified when it\'s ready.');
            // Reset form
            document.getElementById('dataUploadArea').classList.remove('active');
            document.getElementById('dataFileInfo').classList.remove('show');
            document.getElementById('dataFile').value = '';
            document.getElementById('generateBtn').disabled = true;
            dataFileUploaded = false;
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