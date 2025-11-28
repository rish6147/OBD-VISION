import Upload from "../models/Upload.js";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

// Get current directory for ES6 modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------ SAVE UPLOAD ------------------
export const saveUpload = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    const uploadDoc = await Upload.create({
      user: userId,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      filePath: path.resolve(req.file.path)
    });

    console.log(`[UPLOAD] Saved file for user ${userId}: ${uploadDoc.filePath}`);

    return res.status(201).json({
      success: true,
      message: "File uploaded successfully",
      upload: uploadDoc
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ------------------ GET USER UPLOADS ------------------
export const getUserUploads = async (req, res) => {
  try {
    const userId = req.user.id;

    const uploads = await Upload.find({ user: userId }).sort({ uploadedAt: -1 });

    return res.status(200).json({
      success: true,
      uploads,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ------------------ GET USER VIDEOS ------------------
export const getUserVideos = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      // Fallback for demo - return all videos if no user
      let videos = await Upload.find({
        status: 'success',
        videoPath: { $ne: null }
      }).sort({ uploadedAt: -1 });

      // If no videos in DB, return dummy videos for demo
      if (videos.length === 0) {
        videos = [
          {
            _id: 'dummy-18',
            originalName: 'trial_18.xlsx',
            updatedAt: new Date(),
            videoPath: 'videos/trial_18.mp4',
            size: 15000000,
            status: 'success'
          },
          {
            _id: 'dummy-19',
            originalName: 'trial_19.xlsx',
            updatedAt: new Date(),
            videoPath: 'videos/trial_19.mp4',
            size: 16000000,
            status: 'success'
          },
          {
            _id: 'dummy-20',
            originalName: 'trial_20.xlsx',
            updatedAt: new Date(),
            videoPath: 'videos/trial_20.mp4',
            size: 17000000,
            status: 'success'
          }
        ];
      }

      return res.status(200).json({ success: true, videos });
    }

    // Return videos for the authenticated user OR videos without user (populated videos)
    let videos = await Upload.find({
      $or: [
        { user: userId },
        { user: { $exists: false } }, // For populated videos without user
        { user: null }
      ],
      status: 'success',
      videoPath: { $ne: null }
    }).sort({ uploadedAt: -1 });

    // If no videos in DB, return dummy videos for demo
    if (videos.length === 0) {
      videos = [
        {
          _id: 'dummy-18',
          originalName: 'trial_18.xlsx',
          updatedAt: new Date(),
          videoPath: 'videos/trial_18.mp4',
          size: 15000000,
          status: 'success'
        },
        {
          _id: 'dummy-19',
          originalName: 'trial_19.xlsx',
          updatedAt: new Date(),
          videoPath: 'videos/trial_19.mp4',
          size: 16000000,
          status: 'success'
        },
        {
          _id: 'dummy-20',
          originalName: 'trial_20.xlsx',
          updatedAt: new Date(),
          videoPath: 'videos/trial_20.mp4',
          size: 17000000,
          status: 'success'
        }
      ];
    }

    res.status(200).json({ success: true, videos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

// ------------------ DELETE UPLOAD ------------------
export const deleteUpload = async (req, res) => {
  try {
    const { id } = req.params;

    const upload = await Upload.findById(id);
    if (!upload) {
      return res.status(404).json({ success: false, error: "File not found" });
    }

    // Delete file from server
    fs.unlink(path.join("uploads", upload.fileName), err => {
      if (err) console.error("Failed to delete file:", err);
    });

    // Delete from database
    await Upload.findByIdAndDelete(id);

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ------------------ GENERATE VIDEO (OPTIMIZED) ------------------
export const generateVideo = async (req, res) => {
  try {
    const { fileId } = req.body;
    const userId = req.user.id;

    // Fetch the upload file
    const upload = await Upload.findById(fileId);
    if (!upload) {
      return res.status(404).json({ success: false, error: "File not found" });
    }

    // Verify file ownership
    if (upload.user.toString() !== userId) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const filePath = path.resolve(upload.filePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: "File missing on server" });
    }

    // Get uploads directory path
    const uploadsDir = path.resolve("uploads");
    const backendDir = path.dirname(uploadsDir);
    const codePyPath = path.join(backendDir, "code.py");

    // Check if code.py exists
    if (!fs.existsSync(codePyPath)) {
      return res.status(500).json({ success: false, error: "Video generator not found" });
    }

    // CRITICAL: Aggressive SSE headers to prevent browser timeout
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.setHeader('Transfer-Encoding', 'chunked');
    res.flushHeaders(); // Force flush headers immediately

    // Update status to processing and set videoPath placeholder
    await Upload.findByIdAndUpdate(fileId, {
      status: 'processing',
      message: 'Video generation in progress...',
      progress: 0,
      videoPath: `videos/video-${fileId}.mp4` // Placeholder path
    });

    // Send initial event
    res.write('data: {"stage": "processing", "message": "Starting video generation...", "progress": 0}\n\n');

    // Delete any existing video file to prevent premature success
    const videosDir = path.join(uploadsDir, 'videos');
    const videoPath = path.join(videosDir, 'relive_full_quality.mp4');
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }

    // Spawn Python process with unbuffered output
    const python = spawn('python', ['-u', codePyPath, filePath, uploadsDir], {
      cwd: backendDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1' // CRITICAL: Force Python unbuffered output
      }
    });

    let errorOutput = '';
    let stdoutBuffer = '';
    let lastProgressTime = Date.now();

    // CRITICAL: Aggressive keep-alive (every 3 seconds)
    const keepAliveInterval = setInterval(() => {
      try {
        // Send SSE comment (ignored by parser but keeps connection alive)
        res.write(': heartbeat\n\n');

        // Safety check: if no progress for 60s, something is wrong
        const timeSinceLastProgress = Date.now() - lastProgressTime;
        if (timeSinceLastProgress > 60000) {
          console.warn('[WARNING] No progress update for 60 seconds');
          res.write('data: {"stage": "processing", "message": "Processing (backend still working)..."}\n\n');
        }
      } catch (err) {
        clearInterval(keepAliveInterval);
      }
    }, 3000);

    // Parse Python output (line-buffered)
    python.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      lastProgressTime = Date.now(); // Update last activity time

      const lines = stdoutBuffer.split(/\r?\n/);

      for (let i = 0; i < lines.length - 1; i++) {
        const output = lines[i].trim();
        if (!output) continue;

        console.log('[PYTHON OUTPUT]', output);

        try {
          // PRIORITY: Handle PROGRESS JSON (from optimized code.py)
          if (output.startsWith('PROGRESS:')) {
            const jsonPart = output.replace(/^PROGRESS:/, '');
            try {
              const progressObj = JSON.parse(jsonPart);

              // Forward directly to frontend with proper formatting
              const ssePayload = {
                stage: progressObj.stage || 'processing',
                progress: typeof progressObj.progress === 'number' ? progressObj.progress : undefined,
                message: progressObj.message || '',
                step: progressObj.step || undefined
              };

              res.write(`data: ${JSON.stringify(ssePayload)}\n\n`);
              continue;
            } catch (e) {
              console.error('[ERROR] Failed to parse PROGRESS JSON:', e);
            }
          }

          // FALLBACK: Legacy marker-based progress (for old code.py versions)
          if (output.includes('📍 LOADING ALL GPS DATA') || output.includes('LOADING ALL GPS DATA')) {
            res.write('data: {"stage": "processing", "message": "Loading GPS data...", "step": "Loading Data", "progress": 5}\n\n');
            continue;
          }

          if (output.includes('🛣️  MAP MATCHING') || output.includes('MAP MATCHING')) {
            res.write('data: {"stage": "processing", "message": "Matching GPS to roads...", "step": "Map Matching", "progress": 15}\n\n');
            continue;
          }

          if (output.includes('🔍 COMPREHENSIVE STOP DETECTION') || output.includes('STOP DETECTION')) {
            res.write('data: {"stage": "processing", "message": "Detecting stops...", "step": "Stop Detection", "progress": 25}\n\n');
            continue;
          }

          if (output.includes('📸 CAPTURING STOP PHOTOS') || output.includes('CAPTURING STOP PHOTOS')) {
            res.write('data: {"stage": "processing", "message": "Capturing photos...", "step": "Capturing Photos", "progress": 35}\n\n');
            continue;
          }

          if (output.includes('📹 GENERATING ADAPTIVE FRAMES') || output.includes('GENERATING ADAPTIVE FRAMES')) {
            res.write('data: {"stage": "processing", "message": "Generating frames...", "step": "Frame Generation", "progress": 50}\n\n');
            continue;
          }

          if (output.includes('🌐 Generating HTML viewer') || output.includes('Generating HTML viewer')) {
            res.write('data: {"stage": "processing", "message": "Generating visualization...", "step": "HTML Generation", "progress": 65}\n\n');
            continue;
          }

          if (output.includes('📹 RENDERING') || output.includes('RENDERING VIDEO') || output.includes('🎬 RENDERING')) {
            res.write('data: {"stage": "processing", "message": "Rendering video...", "step": "Rendering video", "progress": 75}\n\n');
            continue;
          }

        } catch (e) {
          console.error('[ERROR] Parsing output line:', e);
        }
      }

      // Keep last partial line in buffer
      stdoutBuffer = lines[lines.length - 1];
    });

    python.stderr.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;
      console.error('[PYTHON STDERR]', output);

      // Only send critical errors (not warnings)
      if (!output.includes('Warning') &&
          !output.includes('DeprecationWarning') &&
          !output.includes('FutureWarning')) {
        const cleanMsg = output.substring(0, 200).replace(/"/g, '\\"').replace(/\n/g, ' ');
        res.write(`data: {"stage": "error", "message": "${cleanMsg}"}\n\n`);
      }
    });

    python.on('close', async (code) => {
      clearInterval(keepAliveInterval);

      if (code === 0) {
        const videosDir = path.join(uploadsDir, 'videos');
        const tempVideoPath = path.join(videosDir, 'relive_full_quality.mp4');

        // ✅ FIX: Rename video uniquely using File ID so it doesn't get overwritten
        const uniqueVideoName = `video-${fileId}.mp4`;
        const finalVideoPath = path.join(videosDir, uniqueVideoName);

        let finalStatus = 'success';
        let finalMessage = "Video generated successfully!";
        let videoFile = null;

        if (fs.existsSync(tempVideoPath)) {
          // Rename the file
          fs.renameSync(tempVideoPath, finalVideoPath);

          // Save relative path (e.g., "videos/video-123.mp4")
          videoFile = path.join('videos', uniqueVideoName);
        } else {
          finalStatus = 'error';
          finalMessage = "Video file not found after generation.";
        }

        // Update the upload record with video path and status
        await Upload.findByIdAndUpdate(fileId, {
          status: finalStatus,
          message: finalMessage,
          progress: 100,
          videoPath: videoFile
        });

        res.write(`data: {"stage": "${finalStatus}", "message": "${finalMessage}", "videoPath": "${videoFile}", "progress": 100}\n\n`);

      } else if (code !== null) {
        // Non-zero exit code
        let finalStatus = 'error';
        let errorMsg = `Video generation failed with code ${code}.`;
        // ... logic ...
        await Upload.findByIdAndUpdate(fileId, {
          status: finalStatus,
          message: errorMsg,
          progress: 0
        });
        console.error(`[ERROR] Python exited with code ${code}`);
        res.write(`data: {"stage": "error", "message": "Generation failed (exit code ${code}): ${errorMsg}"}\n\n`);
      }

      res.end();
    });

    // CRITICAL: Handle client disconnect gracefully
    req.on('close', () => {
      console.log('[INFO] Client disconnected, terminating Python process');
      clearInterval(keepAliveInterval);

      // Kill Python process tree
      try {
        python.kill('SIGTERM');

        // Force kill after 2 seconds if still alive
        setTimeout(() => {
          if (!python.killed) {
            python.kill('SIGKILL');
          }
        }, 2000);
      } catch (err) {
        console.error('[ERROR] Failed to kill Python process:', err);
      }
    });

    // CRITICAL: Handle Python process errors
    python.on('error', (err) => {
      console.error('[ERROR] Python process error:', err);
      clearInterval(keepAliveInterval);
      res.write(`data: {"stage": "error", "message": "Failed to start video generation: ${err.message}"}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('[ERROR] generateVideo exception:', err);

    // If headers not sent yet, send JSON error
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ success: false, error: "Server error" });
    } else {
      // Headers already sent (SSE mode), send error event
      res.write(`data: {"stage": "error", "message": "Server error: ${err.message}"}\n\n`);
      res.end();
    }
  }
};

// ------------------ TEST PROGRESS (Dev only) ------------------
export const testProgress = async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let pct = 0;
    res.write('data: {"stage":"processing","message":"Starting test progress...","progress":0}\n\n');

    const iv = setInterval(() => {
      pct += Math.floor(Math.random() * 8) + 2;
      if (pct >= 100) pct = 100;

      res.write(`data: ${JSON.stringify({
        stage: 'processing',
        progress: pct,
        message: `Testing progress: ${pct}%`
      })}\n\n`);

      if (pct >= 100) {
        clearInterval(iv);
        res.write('data: {"stage":"success","message":"Test complete","progress":100}\n\n');
        res.end();
      }
    }, 400);

  } catch (err) {
    console.error('Test progress error:', err);
    res.status(500).json({ success: false, error: 'Test failed' });
  }
};
