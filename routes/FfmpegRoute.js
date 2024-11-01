const express = require("express");
const { killFfmpegProcessesWindow, killFfmpegProcessesLinux } = require("../utils");

const ffmpegRoutes = express.Router();

ffmpegRoutes.delete("/", (req, res) => {
    try {
        killFfmpegProcessesWindow();
        killFfmpegProcessesLinux();
        
        return res.status(200).json({ message: "Success" })
    } catch (error) {
        return res.status(500).json({ message: error.message })
    }
});

module.exports = ffmpegRoutes;