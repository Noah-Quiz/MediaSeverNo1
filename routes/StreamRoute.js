const express = require("express");

const streamRoutes = express.Router();

const fs = require('fs');
const path = require('path');

streamRoutes.delete("/live-stream", (req, res) => {
    const liveStreamDir = path.join(process.cwd(), 'live-stream');
    
    try { 
        if (fs.existsSync(liveStreamDir)) {
            fs.rmSync(liveStreamDir, { recursive: true, force: true });
            res.status(200).json({ message: 'Live stream folder deleted successfully.' });
        } else {
            res.status(404).json({ message: 'Live stream folder not found.' });
        }
    } catch (error) {
        console.error('Error deleting live stream folder:', error);
        res.status(500).json({ message: 'Error deleting live stream folder.' });
    }
});

module.exports = streamRoutes;