import mongoose from "mongoose";

const uploadSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    fileName: {
        type: String,
        required: true
    },
    originalName: {
        type: String,
        required: true
    },
    filePath: {
        type: String,
        required: true
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'success', 'error'],
        default: 'pending'
    },
    videoPath: {
        type: String,
        default: null
    },
    message: {
        type: String,
        default: null
    },
    progress: {
        type: Number,
        default: 0
    },
    size: {
        type: Number,
        default: 0
    }
});

export default mongoose.model("Upload", uploadSchema);
