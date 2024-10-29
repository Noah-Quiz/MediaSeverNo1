const amqp = require("amqplib");
const fs = require('fs');
const path = require('path');
const https = require("https");
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const moment = require("moment");
const { default: axios } = require("axios");
require("dotenv").config();

// RabbitMQ connection URL
const rabbitMQUrl = `amqp://${process.env.RABBITMQ_USER}:${process.env.RABBITMQ_PASS}@${process.env.RABBITMQ_URL}` || `amqp://livestream_1:DMCF5qyDg6wx2g3m8n@62.77.156.171`;
const developmentPort = process.env.DEVELOPMENT_PORT || "3101";

const liveStreamDir = path.resolve('./live-stream');
if (!fs.existsSync(liveStreamDir)) {
    fs.mkdirSync(liveStreamDir, { recursive: true });
}
const bunnyDir = path.resolve('./bunny');
if (!fs.existsSync(bunnyDir)) {
    fs.mkdirSync(bunnyDir, { recursive: true });
}
const pidDir = path.resolve(path.join(liveStreamDir, 'pid'));
if (!fs.existsSync(pidDir)) {
    fs.mkdirSync(pidDir, { recursive: true });
}

// Function to send message to RabbitMQ queue
const sendToQueue = async (queueName, message) => {
    console.log("Sending queue: ", queueName);
    try {
        const connection = await amqp.connect(rabbitMQUrl);
        const channel = await connection.createChannel();

        await channel.assertQueue(queueName, { durable: true });

        channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
            persistent: true,
        });

        await channel.close();
        await connection.close();
    } catch (error) {
        console.error("Error sending to RabbitMQ:", error);
        throw error;
    }
};

// Function to process messages from RabbitMQ
const getMessage = async (queueName) => {
    console.log("Consuming queue: ", queueName);
    try {
        const connection = await amqp.connect(rabbitMQUrl);
        const channel = await connection.createChannel();

        await channel.assertQueue(queueName, { durable: true });

        channel.consume(queueName, async (msg) => {
            if (msg !== null) {
                try {
                    const messageContent = msg.content.toString();
                    const parsedMessage = JSON.parse(messageContent);

                    console.log(`Cloudflare Event: `, parsedMessage.data?.event_type);

                    const id = parsedMessage.data?.input_id;
                    switch (queueName) {
                        case "cloudflare.livestream":
                            // Extract event type
                            const event = parsedMessage.data?.event_type;

                            // Retrieve stream key using input id
                            const stream = await retrieveCloudFlareStreamLiveInput(id);
                            const streamId = stream?.srtPlayback?.streamId;
                            const passphrase = stream?.srtPlayback?.passphrase;

                            const streamServer = `srt://live.cloudflare.com:778?passphrase=${passphrase}&streamid=${streamId}`
                            switch (event) {
                                case "live_input.connected":
                                    await startFFmpeg(streamServer, id);

                                    break;

                                case "live_input.disconnected":
                                    await stopFFmpeg(id, false);

                                    // Upload to Bunny Storage
                                    const bunnyOutputDir = path.join(bunnyDir, id);
                                    if (!fs.existsSync(bunnyOutputDir)) {
                                        fs.mkdirSync(bunnyOutputDir, { recursive: true });
                                    }

                                    // Define m3u8 file name
                                    const m3u8FileName = `${id}.m3u8`;

                                    handleStreamFinish(bunnyOutputDir, m3u8FileName, id);

                                    await sendToQueue("live_stream.disconnected", {
                                        live_input_id: id,
                                        streamOnlineUrl: `https://${process.env.BUNNY_DOMAIN_STORAGE_ZONE}/video/${id}/${m3u8FileName}`
                                    });
                                    
                                    break;

                                case "live_input.errored":
                                    console.log("Cloudflare Error");
                                    break;
                            }
                            break;
                    }

                    channel.ack(msg);
                } catch (error) {
                    console.error(`Error while processing message: ${error}`);
                    channel.nack(msg, true, false);
                }
            }
        });
    } catch (error) {
        console.error("Error consuming from RabbitMQ:", error);
    }
};

// Start FFmpeg process
const startFFmpeg = async (streamUrl, output) => {
    try {
        const outputDir = path.join(liveStreamDir, output);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputFileName = `${output}.m3u8`;
        const outputPath = path.join(outputDir, outputFileName);
        const segmentPath = path.join(outputDir, `${output}-segment-%Y%m%d-%H%M%S.ts`);

        const ffmpeg = spawn('ffmpeg', [
            '-i', streamUrl,
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-f', 'hls',
            '-hls_time', '1',
            '-hls_list_size', '3',
            '-hls_flags', 'split_by_time',
            '-strftime', '1',
            '-hls_segment_filename', segmentPath,
            '-tune', 'zerolatency',
            outputPath
        ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); // Pipe stdout and stderr

        ffmpeg.on('error', (error) => {
            console.error(`FFmpeg error: ${error.message}`);
        });

        ffmpeg.on('exit', async (code) => {
            console.log(`FFmpeg exited with code ${code}`);
            if (code !== 0) {
                console.error(`FFmpeg process failed with code ${code}`);
            }
            try {
                await stopFFmpeg(output, true);
            } catch (err) {
                console.error(`Error stopping FFmpeg: ${err}`);
            }
        });

        ffmpeg.unref();

        // Store the PID of the process
        if (!fs.existsSync(pidDir)) {
            fs.mkdirSync(pidDir, { recursive: true });
        }
        const pidFilePath = path.join(pidDir, `ffmpeg-${output}-pid.pid`);
        fs.writeFileSync(pidFilePath, ffmpeg.pid.toString());

        console.log(`FFmpeg started with PID: ${ffmpeg.pid}`);

        // Send to queue live event
        await sendToQueue("live_stream.connected", {
            live_input_id: output,
            streamServerUrl: `${process.env.BUNNY_DOMAIN_ORIGIN}/live-stream/${path.relative(liveStreamDir, outputPath).replace(/\\/g, "/")}`,
        });

        // Generate thumbnail for livestream
        setTimeout(async () => {
            const bunnyOutputDir = path.join(bunnyDir, output);
            const liveStreamOutputDir = path.join(liveStreamDir, output);
            
            await createThumbnail(bunnyOutputDir, liveStreamOutputDir);
            
            const thumbnailFileName = await uploadThumbnail(bunnyOutputDir, output);
            
            await sendToQueue("bunny_livestream_thumbnail", {
                live_input_output: output,
                thumbnailUrl: `https://${process.env.BUNNY_DOMAIN_STORAGE_ZONE}/video/${output}/${thumbnailFileName}`,
            });
        }, 15000);
    } catch (error) {
        console.error("Error starting FFmpeg:", error);
    }
};

const createM3U8WithFFmpeg = async (liveStreamOutputDir, bunnyOutputDir, m3u8FileName, second = 300) => {
    try {
        if (!fs.existsSync(bunnyOutputDir)) {
            fs.mkdirSync(bunnyOutputDir, { recursive: true });
        }

        const m3u8FilePath = path.join(bunnyOutputDir, m3u8FileName.endsWith('.m3u8') ? m3u8FileName : `${m3u8FileName}.m3u8`);

        // Get all .ts files from the directory
        const tsFiles = fs.readdirSync(liveStreamOutputDir)
            .filter(file => file.endsWith('.ts'))
            .map(file => path.join(liveStreamOutputDir, file))
            .sort();

        const totalFiles = tsFiles.length;

        // Determine which TS files to include based on the second parameter
        const middle = Math.floor(totalFiles / 2);
        const start = Math.max(0, middle - Math.floor(second / 2));
        const end = Math.min(totalFiles, start + second);

        // Select the appropriate TS files
        const selectedFiles = tsFiles.slice(start, end);

        if (selectedFiles.length === 0) {
            console.error('No TS files selected for M3U8 creation.');
            return;
        }

        // Write the M3U8 playlist manually
        const m3u8Content = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:1',
            '#EXT-X-MEDIA-SEQUENCE:0',
        ];

        // Add each TS file to the playlist
        selectedFiles.forEach(tsFile => {
            const tsFileName = path.basename(tsFile);
            m3u8Content.push(`#EXTINF:1.0,`);
            m3u8Content.push(tsFileName.replace(/\\/g, '/')); 
        });

        // Add the end of the playlist
        m3u8Content.push('#EXT-X-ENDLIST');

        // Write the content to the M3U8 file
        fs.writeFileSync(m3u8FilePath, m3u8Content.join('\n'));

        console.log(`M3U8 file created successfully at ${m3u8FilePath}`);

    } catch (error) {
        console.error('Error during M3U8 creation process:', error);
    }
};


// Main function to handle the stream finishing
const handleStreamFinish = async (bunnyOutputDir, m3u8FileName, identifier) => {
    try {
        const liveStreamOutputDir = path.join(liveStreamDir, identifier);
        const tsDir = path.join(liveStreamDir, identifier);

        await createM3U8WithFFmpeg(liveStreamOutputDir, bunnyOutputDir, identifier, 300);

        // Upload files
        await replaceTsFilePath(path.join(bunnyOutputDir, m3u8FileName), identifier);
        await uploadTsFiles(tsDir, identifier, 300);
        await uploadToBunnyCDN(path.join(bunnyOutputDir, m3u8FileName), identifier, m3u8FileName);
    } catch (error) {
        console.error("Error: ", error);
    }
};

// handleStreamFinish(path.join(bunnyDir, "a4f7db73deb6ae77da1d61d5038a9486"), "a4f7db73deb6ae77da1d61d5038a9486.m3u8", "a4f7db73deb6ae77da1d61d5038a9486");

// Stop FFmpeg process
const stopFFmpeg = async (identifier, hasEndTag) => {
    try {
        const pidFilePath = path.join(pidDir, `ffmpeg-${identifier}-pid.pid`);

        // Read pid file
        const pid = fs.readFileSync(pidFilePath, 'utf8');

        // Stop the FFmpeg process
        process.kill(pid);
        fs.unlinkSync(pidFilePath);
        console.log(`FFmpeg process with PID ${pid} stopped`);

        // Find the most recent .m3u8 file in the output directory
        const outputDir = path.join(liveStreamDir, identifier);
        // Define m3u8 file name
        const m3u8FileName = `${identifier}.m3u8`;
        if (!hasEndTag) {
            const m3u8FilePath = path.join(outputDir, m3u8FileName);
            fs.appendFileSync(m3u8FilePath, '#EXT-X-ENDLIST', 'utf8');
        }
    } catch (err) {
        console.error(`Failed to stop FFmpeg for ${identifier}:`, err.message);
    }
};

const createThumbnail = async (bunnyOutputDir, liveStreamOutputDir) => {
    try {
        // Get all .ts files, sorted
        const tsFiles = fs.readdirSync(liveStreamOutputDir)
            .filter(file => file.endsWith('.ts'))
            .map(file => path.join(liveStreamOutputDir, file))
            .sort();

        if (tsFiles.length === 0) {
            throw new Error("No TS files found for thumbnail generation.");
        }

        // Ensure the output directory exists
        if (!fs.existsSync(bunnyOutputDir)) {
            fs.mkdirSync(bunnyOutputDir, { recursive: true });
        }

        // Define the output thumbnail path
        const outputFileName = `thumbnail.png`;
        const outputPath = path.join(bunnyOutputDir, outputFileName);

        // Check if the thumbnail already exists
        if (fs.existsSync(outputPath)) {
            console.log(`Thumbnail already exists at: ${outputPath}`);
            return outputPath; // Return immediately if the thumbnail exists
        }

        for (const tsFilePath of tsFiles) {
            // Check if the selected TS file exists
            if (!fs.existsSync(tsFilePath)) {
                console.warn(`TS file not found: ${tsFilePath}, skipping.`);
                continue; // Skip this file if it doesn't exist
            }

            console.log(`Creating thumbnail for: ${tsFilePath}`);

            try {
                // Generate a thumbnail from the current TS file using ffmpeg
                await new Promise((resolve, reject) => {
                    const ffmpeg = spawn("ffmpeg", [
                        "-i", tsFilePath, // No quotes needed
                        "-vf", "select='eq(pict_type\\,I)'",
                        "-frames:v", "1",
                        outputPath // No quotes needed
                    ], { shell: false });

                    ffmpeg.on("close", (code) => {
                        if (code === 0) {
                            console.log(`Thumbnail created at: ${outputPath}`);
                            resolve(); // Resolve promise on success
                        } else {
                            reject(new Error(`Failed to create thumbnail from ${tsFilePath}, ffmpeg exited with code ${code}`));
                        }
                    });

                    ffmpeg.on("error", (error) => {
                        reject(new Error(`Failed to create thumbnail from ${tsFilePath}, ffmpeg error: ${error.message}`));
                    });
                });

                return outputPath; // Return the path of the successfully created thumbnail

            } catch (error) {
                console.error(error.message); // Log the error for this TS file
            }
        }

        throw new Error("Failed to create a thumbnail from all TS files."); // If no thumbnails were created

    } catch (error) {
        console.error("Error creating thumbnail:", error);
        throw error;
    }
};

const getTsFileDuration = (tsFilePath) => {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            tsFilePath,
        ]);

        let output = "";
        ffprobe.stdout.on("data", (data) => {
            output += data;
        });

        ffprobe.on("close", (code) => {
            if (code === 0) {
                resolve(parseFloat(output));
            } else {
                reject(new Error(`Failed to get duration for file: ${tsFilePath}`));
            }
        });
    });
};



const uploadToBunnyCDN = async (filePath, identifier, fileName) => {
    try {
        const readStream = fs.createReadStream(filePath);
        const storageZone = process.env.BUNNY_STORAGE_ZONE_NAME;
        const path = `/${storageZone}/video/${identifier}/${fileName}`;

        const options = {
            method: "PUT",
            host: "storage.bunnycdn.com",
            path: path,
            headers: {
                AccessKey: process.env.BUNNY_STORAGE_PASSWORD,
                "Content-Type": "application/octet-stream",
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", // Disable caching
                Expires: "0",
                Pragma: "no-cache",
            },
        };

        const req = https.request(options, (res) => {
            res.on("data", (chunk) => {
                console.log(chunk.toString("utf8"));
            });
        });

        req.on("error", (error) => {
            console.error(error);
        });

        readStream.pipe(req);   
    } catch (error) {
        console.error("Error uploading to Bunny: ", error);
    }
};

// Function to delete folder or file from BunnyCDN
const deleteFromBunnyCDN = async (folder, fileName) => {
    const storageZone = process.env.BUNNY_STORAGE_ZONE_NAME;

    let path = "";
    if (fileName) {
        path = `/${storageZone}/video/${folder}/${fileName}`;
    } else {
        path = `/${storageZone}/video/${folder}/`;
    }

    const options = {
        method: "DELETE",
        host: "storage.bunnycdn.com",
        path: path,
        headers: {
            AccessKey: process.env.BUNNY_STORAGE_PASSWORD,
        },
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let responseBody = "";
            res.on("data", (chunk) => {
                responseBody += chunk.toString();
            });
            res.on("end", () => {
                if (res.statusCode === 404) {
                    resolve("Folder or file not found");
                } else if (res.statusCode === 200) {
                    console.log(`Deleted ${folder}/${fileName}: ${responseBody}`);
                    resolve(responseBody);
                } else {
                    reject(
                        new Error(
                            `Failed to delete ${folder}/${fileName}: ${res.statusCode}`
                        )
                    );
                }
            });
        });

        req.on("error", (error) => {
            reject(error);
        });

        req.end();
    });
};

const purgeBunnyCDNCache = async () => {
    const options = {
        method: "POST",
        host: "api.bunny.net",
        path: `/pullzone/${process.env.BUNNY_PULLZONE_ID}/purgeCache`,
        headers: {
            AccessKey: process.env.BUNNY_ACCOUNT_API_KEY,
        },
    };

    const req = https.request(options, (res) => {
        res.on("data", (chunk) => {
            console.log(chunk.toString("utf8"));
        });
    });

    req.on("error", (error) => {
        console.error(error);
    });

    req.end();
};

// Function to replace .ts file paths in .m3u8 with BunnyCDN URLs
const replaceTsFilePath = async (m3u8FilePath, identifier) => {
    const cdnUrl = `https://${process.env.BUNNY_DOMAIN}/video/${identifier}`;
    let m3u8Content = fs.readFileSync(m3u8FilePath, "utf8");

    const regex = new RegExp(
        `${identifier}-segment-\\d{8}-\\d{6}\\.ts`,
        "g"
    );

    m3u8Content = m3u8Content.replace(regex, (match) => {
        return `${cdnUrl}/${match}`;
    });

    fs.writeFileSync(m3u8FilePath, m3u8Content);
};

// Function to upload .ts segment files
const uploadTsFiles = async (outputDir, identifier, second = 300) => {
    try {
        const tsFiles = fs.readdirSync(outputDir)
            .filter(file => file.endsWith('.ts') && file.includes(identifier))
            .sort();

        const totalFiles = tsFiles.length;

        // Determine starting point for middle selection
        const middle = Math.floor(totalFiles / 2);
        const start = Math.max(0, middle - Math.floor(second / 2));
        const end = Math.min(totalFiles, start + second);

        // Select the middle portion of TS files based on `second`
        const selectedFiles = tsFiles.slice(start, end);

        if (selectedFiles.length === 0) {
            console.error('No TS files selected for upload.');
            return;
        }

        for (const file of selectedFiles) {
            const filePath = path.join(outputDir, file);
            await uploadToBunnyCDN(filePath, identifier, file);
        }
        
        console.log(`Uploaded ts files successfully`);
    } catch (error) {
        console.error("Error uploading ts files:", error);
    }
};


const uploadThumbnail = async (outputDir, identifier) => {
    const files = fs.readdirSync(outputDir);
    let fileName = null;

    for (const file of files) {
        if (file.endsWith(".png")) {
            fileName = path.basename(file);
            const filePath = path.join(outputDir, fileName);
            await uploadToBunnyCDN(filePath, identifier, fileName);
            break;
        }
    }

    return fileName;
};


const retrieveCloudFlareStreamLiveInput = async (uid) => {
    try {
        let stream = null;
        let live = null;
        var options = {
            method: "GET",
            url: `${process.env.CLOUDFLARE_STREAM_API_URL}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/live_inputs/${uid}`,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
            },
        };

        await axios.request(options)
            .then(async function (response) {
                stream = response.data.result;
            })
            .catch(function (error) {
                console.error("Error retrieving live input");
            });
        return stream;
    } catch (error) {
        throw error;
    }
};

module.exports = { sendToQueue, getMessage };