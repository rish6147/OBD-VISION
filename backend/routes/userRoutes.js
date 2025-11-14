import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware.js"; // your auth middleware
import User from "../models/User.js";

const router = express.Router();

// Route to get current logged-in user's info
router.get("/me", authMiddleware, async (req, res) => {
  try {
    // `req.user` is set in authMiddleware after verifying JWT
    const userId = req.user.id;

    // Fetch user from DB
    const user = await User.findById(userId).select("firstName lastName email");

    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    // Send user data
    res.status(200).json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;