 function showPage(page) {
            document.getElementById('filesPage').style.display = page === 'files' ? 'block' : 'none';
            document.getElementById('videosPage').style.display = page === 'videos' ? 'block' : 'none';
            
            document.getElementById('filesNav').classList.toggle('active', page === 'files');
            document.getElementById('videosNav').classList.toggle('active', page === 'videos');
        }

        function toggleView(view) {
            const grid = document.getElementById('filesGrid');
            const list = document.getElementById('filesList');
            const btns = document.querySelectorAll('.view-btn');
            
            if (view === 'grid') {
                grid.style.display = 'grid';
                list.classList.remove('active');
                btns[0].classList.add('active');
                btns[1].classList.remove('active');
            } else {
                grid.style.display = 'none';
                list.classList.add('active');
                btns[1].classList.add('active');
                btns[0].classList.remove('active');
            }
        }

        function handleFileUpload(event) {
            const files = event.target.files;
            alert(`✅ ${files.length} file(s) uploaded successfully!`);
        }

        function openFileModal(name, size, date) {
            document.getElementById('previewFileName').textContent = name;
            document.getElementById('previewFileSize').textContent = size;
            document.getElementById('previewFileDate').textContent = date;
            
            const ext = name.split('.').pop().toLowerCase();
            const icon = ext === 'csv' ? '📊' : '📈';
            document.getElementById('previewIcon').textContent = icon;
            
            document.getElementById('fileModal').classList.add('show');
        }

        function closeFileModal() {
            document.getElementById('fileModal').classList.remove('show');
        }

        function openVideoModal(title, date) {
            document.getElementById('videoModalTitle').textContent = title;
            document.getElementById('modalDate').textContent = date;
            document.getElementById('videoModal').classList.add('show');
        }

        function closeVideoModal() {
            document.getElementById('videoModal').classList.remove('show');
        }

        // Close modals when clicking outside
        document.getElementById('fileModal').addEventListener('click', function(e) {
            if (e.target === this) closeFileModal();
        });

        document.getElementById('videoModal').addEventListener('click', function(e) {
            if (e.target === this) closeVideoModal();
        });