import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Upload from "../models/Upload.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/obd-vision";

async function populateVideos() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const videosDir = path.join(__dirname, "../uploads/videos");
    const files = fs.readdirSync(videosDir).filter(file => file.endsWith('.mp4'));

    console.log(`Found ${files.length} video files`);

    for (const file of files) {
      const videoPath = `videos/${file}`;

      // Check if already exists
      const existing = await Upload.findOne({ videoPath });
      if (existing) {
        console.log(`Skipping ${file}, already exists`);
        continue;
      }

      // Create new record
      const upload = new Upload({
        user: null, // No user association for pre-existing videos
        fileName: file,
        originalName: file,
        filePath: path.join(videosDir, file),
        status: 'success',
        videoPath: videoPath,
        message: "Populated from existing file",
        progress: 100,
        size: fs.statSync(path.join(videosDir, file)).size
      });

      await upload.save();
      console.log(`Added ${file} to database`);
    }

    console.log("Population complete");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    mongoose.disconnect();
  }
}

populateVideos();
