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
      // Store absolute path for reliability when invoking external scripts
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

// ------------------ GENERATE VIDEO ------------------
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

    // Set response header for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial event
    res.write('data: {"status": "started", "message": "Starting video generation..."}\n\n');

    // Delete any existing video file to prevent premature success
    const videosDir = path.join(uploadsDir, 'videos');
    const videoPath = path.join(videosDir, 'relive_full_quality.mp4');
    if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
    }

    // Spawn Python process
    const python = spawn('python', [codePyPath, filePath, uploadsDir], {
      cwd: backendDir,
      env: { ...process.env }
    });

    let errorOutput = '';
    let lastOutput = '';
    // Buffer stdout lines to handle chunked data from Python
    let stdoutBuffer = '';

    // Parse Python output and send progress updates (line-buffered)
    python.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();

      // Split into lines. Last element may be a partial line - keep it in buffer
      const lines = stdoutBuffer.split(/\r?\n/);
      // Process all complete lines
      for (let i = 0; i < lines.length - 1; i++) {
        const output = lines[i].trim();
        if (!output) continue;
        lastOutput = output;
        console.log('[PYTHON OUTPUT]', output);

        try {
          // If line contains PROGRESS JSON
          if (output.startsWith('PROGRESS:')) {
            const jsonPart = output.replace(/^PROGRESS:/, '');
            try {
              const progressObj = JSON.parse(jsonPart);
              const ssePayload = {
                status: progressObj.stage || 'rendering',
                progress: typeof progressObj.progress === 'number' ? progressObj.progress : undefined,
                message: progressObj.message || undefined,
                step: progressObj.step || undefined,
                detail: progressObj.detail || undefined
              };
              res.write(`data: ${JSON.stringify(ssePayload)}\n\n`);
            } catch (e) {
              console.error('Failed to parse PROGRESS JSON from Python:', e);
            }
            continue;
          }

          // Generic marker checks - now with PROGRESS JSON emission
          if (output.includes('📍 LOADING ALL GPS DATA') || output.includes('LOADING ALL GPS DATA')) {
            res.write('data: {"status": "processing", "message": "Loading GPS data...", "step": "Loading Data", "progress": 5}\n\n');
            continue;
          }

          if (output.includes('🛣️  MAP MATCHING') || output.includes('MAP MATCHING')) {
            res.write('data: {"status": "processing", "message": "Matching GPS to roads...", "step": "Map Matching", "progress": 15}\n\n');
            continue;
          }

          if (output.includes('🔍 COMPREHENSIVE STOP DETECTION') || output.includes('STOP DETECTION')) {
            res.write('data: {"status": "processing", "message": "Detecting stops...", "step": "Stop Detection", "progress": 25}\n\n');
            continue;
          }

          if (output.includes('📸 CAPTURING STOP PHOTOS') || output.includes('CAPTURING STOP PHOTOS')) {
            res.write('data: {"status": "processing", "message": "Capturing street view photos...", "step": "Capturing Photos", "progress": 35}\n\n');
            continue;
          }

          if (output.includes('📹 GENERATING ADAPTIVE FRAMES') || output.includes('GENERATING ADAPTIVE FRAMES')) {
            res.write('data: {"status": "processing", "message": "Generating adaptive frames...", "step": "Frame Generation", "progress": 50}\n\n');
            continue;
          }

          if (output.includes('🌐 Generating HTML viewer') || output.includes('Generating HTML viewer')) {
            res.write('data: {"status": "processing", "message": "Generating visualization...", "step": "HTML Generation", "progress": 65}\n\n');
            continue;
          }

          if (output.includes('📹 RENDERING') || output.includes('RENDERING VIDEO') || output.includes('🎬 RENDERING')) {
            res.write('data: {"status": "rendering", "message": "Rendering video frames...", "step": "Rendering video", "progress": 75}\n\n');
            continue;
          }

        } catch (e) {
          console.error('Error parsing output line:', e);
        }
      }

      // Keep last partial line in the buffer
      stdoutBuffer = lines[lines.length - 1];
    });

    python.stderr.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;
      console.error('[PYTHON ERROR]', output);

      // Still send progress updates even on stderr
      if (!output.includes('Warning') && !output.includes('DeprecationWarning')) {
        res.write(`data: {"status": "error", "message": "${output.replace(/"/g, '\\"')}"}\n\n`);
      }
    });

    python.on('close', (code) => {
      if (code === 0) {
        // Success - find the generated video
        const videosDir = path.join(uploadsDir, 'videos');
        const videoPath = path.join(videosDir, 'relive_full_quality.mp4');

        if (fs.existsSync(videoPath)) {
          const videoFile = path.relative(uploadsDir, videoPath);
          res.write(`data: {"status": "success", "message": "Video generated successfully!", "videoPath": "${videoFile}", "progress": 100}\n\n`);
        } else {
          res.write('data: {"status": "error", "message": "Video file not found after generation"}\n\n');
        }
      } else {
        const errorMsg = errorOutput.substring(0, 200).replace(/"/g, '\\"');
        res.write(`data: {"status": "error", "message": "Video generation failed with code ${code}: ${errorMsg}"}\n\n`);
      }

      res.end();
    });

  } catch (err) {
    console.error(err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ------------------ TEST PROGRESS (Dev only) ------------------
export const testProgress = async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let pct = 0;
    res.write('data: {"status":"started","message":"Starting test progress..."}\n\n');

    const iv = setInterval(() => {
      pct += Math.floor(Math.random() * 8) + 2; // random progress bumps
      if (pct >= 100) pct = 100;
      res.write(`data: ${JSON.stringify({ status: 'rendering', progress: pct })}\n\n`);
      if (pct >= 100) {
        clearInterval(iv);
        res.write('data: {"status":"success","message":"Test complete","progress":100}\n\n');
        res.end();
      }
    }, 400);

  } catch (err) {
    console.error('Test progress error:', err);
    res.status(500).json({ success: false, error: 'Test failed' });
  }
};
