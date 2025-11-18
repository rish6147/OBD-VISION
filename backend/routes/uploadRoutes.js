import express from "express";
import multer from "multer";
import { saveUpload, getUserUploads, deleteUpload, generateVideo, testProgress } from "../controllers/uploadController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import Upload from "../models/Upload.js";
import path from "path";
import fs from "fs";

const router = express.Router();

// Multer Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// ------------------ ROUTES ------------------

// Upload a file
router.post("/upload", authMiddleware, upload.single("file"), saveUpload);

// Get all uploads of current user
router.get("/my-uploads", authMiddleware, getUserUploads);

// Download a file by ID
router.get("/download/:id", authMiddleware, async (req, res) => {
  try {
    const uploadDoc = await Upload.findById(req.params.id);
    if (!uploadDoc) return res.status(404).json({ success: false, error: "File not found" });

    const filePath = path.resolve(uploadDoc.filePath); // absolute path
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: "File missing on server" });

    res.download(filePath, uploadDoc.originalName);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Delete a file by ID
router.delete("/:id", authMiddleware, deleteUpload);

// Generate video from uploaded file (Server-Sent Events)
router.post("/generate-video", authMiddleware, generateVideo);

// TEST: SSE progress simulator (no auth) - helpful for frontend testing
router.get("/test-progress", testProgress);

export default router;
