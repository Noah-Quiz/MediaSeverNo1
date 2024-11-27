const { getBunnyCdnLogs } = require("../services/LogService");

const getLogs = async (req, res) => {
  try {
    const logs = await getBunnyCdnLogs();
    res.status(200).json({ message: "Success", data: logs });
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve logs", error: error.message });
  }
};

module.exports = { getLogs };
