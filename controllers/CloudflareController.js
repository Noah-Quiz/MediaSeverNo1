const { listCloudFlareStreamLiveInputs, deleteCloudFlareStreamLiveInput, createCloudFlareStreamLiveInput } = require("../services/CloudflareService");

class CloudflareController {
    async listLiveInputsController(req, res) {
        try {
            const liveInputs = await listCloudFlareStreamLiveInputs();

            return res.status(200).json({ liveInputs, message: "Success" });
        } catch (error) {
            return res.status(500).json({ message: error.message });
        }
    }

    async deleteLiveInputController(req, res) {
        const { uid } = req.body;

        try {
            await deleteCloudFlareStreamLiveInput(uid);

            return res.status(200).json({ message: "Success" });
        } catch (error) {
            return res.status(500).json({ message: error.message });
        }
    }
    
    async createLiveInputController(req, res) {
        const { creatorId, streamName } = req.body;

        try {
            const liveInput = await createCloudFlareStreamLiveInput(
                creatorId,
                streamName
            );

            return res.status(200).json({ liveInput, message: "Success" });
        } catch (error) {
            return res.status(500).json({ message: error.message });
        }
    }
}

module.exports = CloudflareController;