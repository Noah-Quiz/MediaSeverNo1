const { default: axios } = require("axios");

require("dotenv").config();

const listCloudFlareStreamLiveInputs = async () => {
  try {
    let lives = null;
    var options = {
      method: "GET",
      url: `${process.env.CLOUDFLARE_STREAM_API_URL}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/live_inputs?include_counts=true`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
      },
    };
    await axios
      .request(options)
      .then(async function (response) {
        // console.log(response.data.result);
        lives = response.data.result;
      })
      .catch(function (error) {
        console.error(error);
      });
    return lives;
  } catch (error) {
    throw error;
  }
};

const retrieveCloudFlareStreamLiveInput = async (uid) => {
  try {
    let live = null;
    var options = {
      method: "GET",
      url: `${process.env.CLOUDFLARE_STREAM_API_URL}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/live_inputs/${uid}`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
      },
    };
    axios
      .request(options)
      .then(async function (response) {
        live = response.data.result;
      })
      .catch(function (error) {
        console.error(error);
      });
    return live;
  } catch (error) {
    throw error;
  }
};

const createCloudFlareStreamLiveInput = async (creatorId, streamName) => {
  try {
    let streams = null;
    var options = {
      method: "POST",
      url: `${process.env.CLOUDFLARE_STREAM_API_URL}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/live_inputs`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
      },
      data: {
        defaultCreator: `${creatorId}`,
        deleteRecordingAfterDays: 45,
        meta: { name: `${streamName}` },
        recording: {
          allowedOrigins: ["*"],
          hideLiveViewerCount: false,
          mode: "automatic",
          requireSignedURLs: false,
          timeoutSeconds: 0,
        },
      },
    };
    await axios
      .request(options)
      .then(async function (response) {
        streams = response.data.result;
      })
      .catch(function (error) {
        console.error(error);
      });
    return streams;
  } catch (error) {
    throw error;
  }
};

const updateCloudFlareStreamLiveInput = async (uid, streamName) => {
  try {
    var options = {
      method: "PUT",
      url: `${process.env.CLOUDFLARE_STREAM_API_URL}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/live_inputs/${uid}`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
      },
      data: {
        meta: { name: `${streamName}` },
      },
    };
    axios
      .request(options)
      .then(async function (response) {
        return response.data.result;
      })
      .catch(function (error) {
        console.error(error);
      });
  } catch (error) {
    throw error;
  }
};

const deleteCloudFlareStreamLiveInput = async (uid) => {
  try {
    var options = {
      method: "DELETE",
      url: `${process.env.CLOUDFLARE_STREAM_API_URL}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/live_inputs/${uid}`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
      },
    };
    axios
      .request(options)
      .then(async function (response) {
        return response.data.result;
      })
      .catch(function (error) {
        console.error(error);
      });
  } catch (error) {
    throw error;
  }
};

module.exports = {
  listCloudFlareStreamLiveInputs,
  retrieveCloudFlareStreamLiveInput,
  createCloudFlareStreamLiveInput,
  updateCloudFlareStreamLiveInput,
  deleteCloudFlareStreamLiveInput,
};
