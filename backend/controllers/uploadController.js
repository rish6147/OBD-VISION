import Upload from "../models/Upload.js";
import fs from "fs";
import path from "path";

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
      filePath: req.file.path
    });

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
