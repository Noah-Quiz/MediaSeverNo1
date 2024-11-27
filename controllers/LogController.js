const { getLatestLogContent } = require("../services/LogService");

const getLogs = (req, res) => {
  try {
    const logContent = getLatestLogContent();
    res.status(200).json({ message: "Success", data: logContent });
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve logs", error: error.message });
  }
};

module.exports = { getLogs };
