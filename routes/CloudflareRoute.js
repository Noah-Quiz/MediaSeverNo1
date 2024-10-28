const express = require("express");
const CloudflareController = require("../controllers/CloudflareController");
const cloudflareController = new CloudflareController();

const cloudflareRoutes = express.Router();

cloudflareRoutes.get("/live-input", cloudflareController.listLiveInputsController);

cloudflareRoutes.post("/live-input", cloudflareController.createLiveInputController);

cloudflareRoutes.delete("/live-input", cloudflareController.deleteLiveInputController);

module.exports = cloudflareRoutes;