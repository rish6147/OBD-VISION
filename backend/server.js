import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();

// ✅ CRITICAL: Make the uploads folder accessible publicly
// This allows frontend to access http://localhost:5000/uploads/videos/filename.mp4
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// CORS with frontend URL
// Allow local dev origins (include localhost and 127.0.0.1)
app.use(cors({
  origin: [
    "http://127.0.0.1:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5500",
    "http://localhost:5501"
  ],
  credentials: true
}));

// Parse JSON body
app.use(express.json());

// Routes
app.use("/api", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/upload", uploadRoutes);


// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB Connected"))
.catch((err) => console.log("❌ MongoDB Connection Error:", err));

// Basic route
app.get("/", (req, res) => {
  res.send("Backend server is running...");
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
