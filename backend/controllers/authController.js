import User from "../models/User.js";
import bcrypt from "bcryptjs";

// ---------------- SIGNUP ----------------
export const signup = async (req, res) => {
  try {
    const { firstName, lastName, email, password, confirmPassword } = req.body;

    // Check required fields
    if (!firstName || !lastName || !email || !password || !confirmPassword)
      return res.status(400).json({ success: false, error: "All fields are required" });

    // Check password match
    if (password !== confirmPassword)
      return res.status(400).json({ success: false, error: "Passwords do not match" });

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ success: false, error: "Email already registered" });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = new User({ firstName, lastName, email, password: hashedPassword });
    await newUser.save();

    return res.status(201).json({ success: true, message: "User created successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ---------------- LOGIN ----------------
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check required fields
    if (!email || !password)
      return res.status(400).json({ success: false, error: "Email and password required" });

    // Find user
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ success: false, error: "User not found" });

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, error: "Incorrect password" });

    return res.status(200).json({ success: true, message: "Login successful" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};
