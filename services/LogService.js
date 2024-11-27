const axios = require("axios");

/**
 * Fetch logs from BunnyCDN.
 */
const getBunnyCdnLogs = async () => {
  try {
    const apiUrl = `https://${process.env.BUNNY_STORAGE_HOST_NAME}/logs`;
    const apiKey = process.env.BUNNY_ACCOUNT_API_KEY;

    const response = await axios.get(apiUrl, {
      headers: {
        AccessKey: apiKey,
      },
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch BunnyCDN logs: ${response.statusText}`);
    }

    return response.data; 
  } catch (error) {
    throw new Error(`Error fetching BunnyCDN logs: ${error.message}`);
  }
};

module.exports = { getBunnyCdnLogs };
