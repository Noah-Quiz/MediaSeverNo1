require("dotenv").config();
const amqp = require("amqplib");
const fs = require('fs');
const path = require('path');
const https = require("https");
const { spawn, exec } = require('child_process');
const moment = require("moment");
const { default: axios } = require("axios");
const getLogger = require("./logger");
const bunnyLogger = getLogger("BUNNYCDN");
const ffmpegLogger = getLogger("FFMPEG");
const rabbitMqLogger = getLogger("RABBITMQ");
const cloudflareLogger = getLogger("CLOUDFLARE");
const thumbnailLogger = getLogger("THUMBNAIL");
const streamLogger = getLogger("STREAM");
const fileLogger = getLogger("FILE");
const debugLogger = getLogger("DEBUG");

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
    rabbitMqLogger.info(`Sending message to queue: ${queueName}`);
    let connection;
    let channel;
    try {
        connection = await amqp.connect(rabbitMQUrl);
        channel = await connection.createChannel();

        await channel.assertQueue(queueName, { durable: true });

        channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
            persistent: true,
        });

        rabbitMqLogger.info(`Message sent to queue: ${queueName}`);
    } catch (error) {
        rabbitMqLogger.error(`Error sending to RabbitMQ: ${error.message}`);
        rabbitMqLogger.error(`Stack trace: ${error.stack}`);
        throw error;
    } finally {
        if (channel) {
            try {
                await channel.close();
            } catch (err) {
                rabbitMqLogger.error(`Error closing RabbitMQ channel: ${err.message}`);
            }
        }
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                rabbitMqLogger.error(`Error closing RabbitMQ connection: ${err.message}`);
            }
        }
    }
};


// const getMessage = async (queueName) => {
//     rabbitMqLogger.info(`Consuming queue: ${queueName}`);
//     let connection;
//     let channel;
//     try {
//         connection = await amqp.connect(rabbitMQUrl);
//         channel = await connection.createChannel();

//         await channel.assertQueue(queueName, { durable: true });

//         channel.consume(queueName, async (msg) => {
//             if (msg !== null) {
//                 try {
//                     const messageContent = msg.content.toString();
//                     let parsedMessage;

//                     try {
//                         parsedMessage = JSON.parse(messageContent);
//                     } catch (parseError) {
//                         rabbitMqLogger.error(`Error parsing message content: ${messageContent}`);
//                         channel.nack(msg, true, false); // Reject and requeue the message for later retry
//                         return; // Exit to avoid further processing
//                     }

//                     cloudflareLogger.info(`Cloudflare Event: ${parsedMessage.data?.event_type}`);

//                     const id = parsedMessage.data?.input_id;
//                     switch (queueName) {
//                         case "cloudflare.livestream":
//                             const event = parsedMessage.data?.event_type;

//                             // Retrieve stream key using input id
//                             const stream = await retrieveCloudFlareStreamLiveInput(id);
//                             const rtmpsUrl = stream?.rtmpsPlayback?.url;
//                             const streamKey = stream?.rtmpsPlayback?.streamKey;

//                             const streamServer = `${rtmpsUrl}${streamKey}`;
//                             switch (event) {
//                                 case "live_input.connected":
//                                     await startFFmpeg(streamServer, id, false);
//                                     break;

//                                 case "live_input.disconnected":
//                                     await stopFFmpeg(id, false);
//                                     const timestamp = retrieveTimestamp(id);

//                                     const bunnyOutputDir = path.join(bunnyDir, `${id}-${timestamp}`);
//                                     if (!fs.existsSync(bunnyOutputDir)) {
//                                         fs.mkdirSync(bunnyOutputDir, { recursive: true });
//                                     }

//                                     const m3u8FileName = `${id}.m3u8`;
//                                     await handleStreamFinish(bunnyOutputDir, m3u8FileName, id);

//                                     await sendToQueue("live_stream.disconnected", {
//                                         live_input_id: id,
//                                         streamOnlineUrl: `https://${process.env.BUNNY_DOMAIN_STORAGE_ZONE}/video/${id}-${timestamp}/${m3u8FileName}`
//                                     });

//                                     setTimeout(async () => {
//                                         await handleDeleteStreamRelatedFolders(id);
//                                     }, 900000);
//                                     break;

//                                 case "live_input.errored":
//                                     cloudflareLogger.error("Cloudflare returned event live_input.errored");
//                                     break;
//                             }
//                             break;
//                     }

//                     channel.ack(msg); 
//                 } catch (error) {
//                     rabbitMqLogger.error(`Error while processing message: ${error.message}`);
//                     rabbitMqLogger.error(`Stack trace: ${error.stack}`);
//                     channel.nack(msg, true, false); // Reject and requeue the message for later retry
//                 }
//             }
//         });
//     } catch (error) {
//         rabbitMqLogger.error(`Error consuming from RabbitMQ: ${error.message}`);
//         rabbitMqLogger.error(`Stack trace: ${error.stack}`);
//     }
// };

const getMessage = async (queueName) => {
    rabbitMqLogger.info(`Consuming queue: ${queueName}`);
    let connection;
    let channel;
    try {
        connection = await amqp.connect(rabbitMQUrl);
        channel = await connection.createChannel();

        await channel.assertQueue(queueName, { durable: true });

        channel.consume(queueName, async (msg) => {
            if (msg !== null) {
                try {
                    const messageContent = msg.content.toString();
                    let parsedMessage;

                    // Parse the message
                    try {
                        parsedMessage = JSON.parse(messageContent);
                    } catch (parseError) {
                        rabbitMqLogger.error(`Error parsing message content: ${messageContent}`);
                        channel.nack(msg, false, false); 
                        return;
                    }

                    cloudflareLogger.info(`Cloudflare Event: ${parsedMessage.data?.event_type}`);

                    const event = parsedMessage.data?.event_type;
                    const id = parsedMessage.data?.input_id;

                    if (event === "live_input.disconnected") {
                        cloudflareLogger.info(`Processing live_input.disconnected event for stream ID: ${id}`);

                        try {
                            // Check if the Cloudflare recording is ready
                            const recordUrl = await getCloudflareRecordUrl(id);

                            // Upload directly to BunnyCDN
                            await uploadToBunnyCDNDirectly(recordUrl, id);

                            cloudflareLogger.info(`Stream ${id} successfully uploaded to BunnyCDN`);
                        } catch (error) {
                            if (error.message.includes("Unable to retrieve record URL")) {
                                cloudflareLogger.warn(`Recording not ready for stream: ${id}. Requeuing...`);
                                channel.nack(msg, false, true);
                                return;
                            } else {
                                cloudflareLogger.error(`Failed to process stream ${id}: ${error.message}`);
                                channel.nack(msg, false, false);
                                return;
                            }
                        }
                    }

                    channel.ack(msg);
                } catch (error) {
                    rabbitMqLogger.error(`Error while processing message: ${error.message}`);
                    rabbitMqLogger.error(`Stack trace: ${error.stack}`);
                    channel.nack(msg, false, false);
                }
            }
        });
    } catch (error) {
        rabbitMqLogger.error(`Error consuming from RabbitMQ: ${error.message}`);
        rabbitMqLogger.error(`Stack trace: ${error.stack}`);
    }
};

// Get Cloudflare record URL
const getCloudflareRecordUrl = async (streamId) => {
    try {
        const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/${streamId}`;
        const headers = {
            Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}`,
        };

        const response = await axios.get(apiUrl, { headers });

        if (response.data && response.data.result && response.data.result.downloaded_url) {
            return response.data.result.downloaded_url;
        } else {
            throw new Error("Unable to retrieve record URL from Cloudflare");
        }
    } catch (error) {
        cloudflareLogger.error(`Error fetching record URL: ${error.message}`);
        throw error;
    }
};

// Upload directly to BunnyCDN
const uploadToBunnyCDNDirectly = async (cloudflareUrl, identifier) => {
    try {
        return new Promise(async (resolve, reject) => {
            const storageZone = process.env.BUNNY_STORAGE_ZONE_NAME;
            const fileName = `${identifier}.mp4`; 
            const path = `/${storageZone}/video/${identifier}/${fileName}`;

            const options = {
                method: "PUT",
                host: "storage.bunnycdn.com",
                path: path,
                headers: {
                    AccessKey: process.env.BUNNY_STORAGE_PASSWORD,
                    "Content-Type": "application/octet-stream",
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                    Expires: "0",
                    Pragma: "no-cache",
                },
            };

            // Stream from Cloudflare to BunnyCDN
            const response = await axios({
                method: "get",
                url: cloudflareUrl,
                responseType: "stream",
            });

            const req = https.request(options, (res) => {
                let responseData = '';

                res.on("data", (chunk) => {
                    responseData += chunk.toString("utf8");
                });

                res.on("end", () => {
                    if (res.statusCode === 201) {
                        bunnyLogger.info(`Upload to BunnyCDN completed successfully: ${identifier}/${fileName}`);
                        resolve();
                    } else {
                        bunnyLogger.error(`Failed to upload to BunnyCDN: ${responseData}`);
                        reject(new Error(`BunnyCDN upload failed with status: ${res.statusCode}`));
                    }
                });
            });

            req.on("error", (error) => {
                bunnyLogger.error(`Upload error: ${error.message}`);
                reject(error);
            });

            req.setTimeout(15000, () => {
                req.destroy();
                reject(new Error("Upload timed out"));
            });

            response.data.pipe(req); 
        });
    } catch (error) {
        bunnyLogger.error(`Error uploading to BunnyCDN: ${error.message}`);
        throw error;
    }
};

// Start FFmpeg process
const startFFmpeg = async (streamUrl, output, autoRecord = true) => {
    
    if (!autoRecord) {
        ffmpegLogger.info(`Auto record is disabled. Skipping FFmpeg start for ${output}`);
        return;
    }


    try {
        const timestamp = moment().format("YMMDD-HHmmss");
        writeTimestamp(output, timestamp);

        const outputDir = path.join(liveStreamDir, `${output}-${timestamp}`);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputPath = path.join(outputDir, `${output}.m3u8`);
        const segmentPath = path.join(outputDir, `${output}-segment-%Y%m%d-%H%M%S.ts`);

        const ffmpeg = spawn('ffmpeg', [
            '-rtbufsize', '500M',
            '-threads', '3',
            '-re',
            '-i', streamUrl,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            '-g', '30',
            '-keyint_min', '30',
            '-f', 'hls',
            '-hls_time', '1',                       
            '-hls_list_size', '3',                 
            '-hls_segment_type', 'mpegts', 
            '-hls_flags', 'independent_segments',
            '-strftime', '1',
            '-hls_segment_filename', segmentPath,
            '-timeout', '30',
            '-reconnect', '1',
            '-reconnect_at_eof', '1',
            outputPath                             
        ], { detached: true, stdio: 'pipe', });

        ffmpeg.stderr.on('data', (data) => {
            ffmpegLogger.info(data.toString());
        });

        ffmpeg.on('error', (err) => {
            ffmpegLogger.error(`Failed to start subprocess: ${err.message}`);
        });
        
        ffmpeg.on('exit', (code, signal) => {
            if (code) {
                ffmpegLogger.error(`FFmpeg exited with code ${code}`);
            }
            if (signal) {
                ffmpegLogger.error(`FFmpeg was killed with signal ${signal}`);
            }
        });
        
        ffmpeg.unref();

        // Store the PID of the process
        if (!fs.existsSync(pidDir)) {
            fs.mkdirSync(pidDir, { recursive: true });
        }
        const pidFilePath = path.join(pidDir, `ffmpeg-${output}-pid.pid`);
        fs.writeFileSync(pidFilePath, ffmpeg.pid.toString());

        ffmpegLogger.info(`FFmpeg started with PID: ${ffmpeg.pid}`);

        // Send to queue live event
        await sendToQueue("live_stream.connected", {
            live_input_id: output,
            streamServerUrl: `https://${process.env.BUNNY_DOMAIN_ORIGIN}/live-stream/${path.relative(liveStreamDir, outputPath).replace(/\\/g, "/")}`,
        });

        // Generate thumbnail for livestream
        setTimeout(async () => {
            try {
                const bunnyOutputDir = path.join(bunnyDir, `${output}-${timestamp}`);
                const liveStreamOutputDir = path.join(liveStreamDir, `${output}-${timestamp}`);
                
                try {
                    await createThumbnail(bunnyOutputDir, liveStreamOutputDir);
                    const thumbnailFileName = await uploadThumbnail(bunnyOutputDir, `${output}-${timestamp}`);
                    
                    await sendToQueue("bunny_livestream_thumbnail", {
                        live_input_id: output,
                        thumbnailUrl: `https://${process.env.BUNNY_DOMAIN_STORAGE_ZONE}/video/${output}-${timestamp}/${thumbnailFileName}`,
                    });
                    thumbnailLogger.info(`Thumbnail generated for stream ${output}`);
                } catch (error) {
                    thumbnailLogger.error(`Error creating/uploading thumbnail for ${output}: ${error.message}`);
                }
            } catch (error) {
                thumbnailLogger.error(`Error in thumbnail generation setTimeout: ${error.message}`);
            }
        }, 10000); // 10 seconds delay
    } catch (error) {
        ffmpegLogger.error(`Error starting FFmpeg: ${error.message}`);
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
            fileLogger.error('No TS files selected for M3U8 creation.');
            return;
        }

        // Write the M3U8 playlist manually
        const m3u8Content = [
            '#EXTM3U',
            '#EXT-X-VERSION:6',
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

        ffmpegLogger.info(`M3U8 file created successfully at ${m3u8FilePath}`);

    } catch (error) {
        ffmpegLogger.error(`Error during M3U8 creation process: ${error.message}`);
    }
};


// Main function to handle the stream finishing
const handleStreamFinish = async (bunnyOutputDir, m3u8FileName, identifier) => {
    try {
        // Retrieve timestamp
        const timestamp = retrieveTimestamp(identifier);
        const liveStreamOutputDir = path.join(liveStreamDir, `${identifier}-${timestamp}`);

        // Step 1: Create the M3U8 file with FFmpeg
        ffmpegLogger.info(`Creating M3U8 file for identifier: ${identifier}`);
        await createM3U8WithFFmpeg(liveStreamOutputDir, bunnyOutputDir, identifier, 300);

        // Step 2: Replace TS file paths in the M3U8
        ffmpegLogger.info(`Replacing TS file paths for M3U8 file: ${m3u8FileName}`);
        await replaceTsFilePath(path.join(bunnyOutputDir, m3u8FileName), identifier);

        // Step 3: Upload the TS files
        ffmpegLogger.info(`Uploading TS files for identifier: ${identifier}`);
        await uploadTsFiles(liveStreamOutputDir, identifier, 300);

        // Step 4: Upload the M3U8 file to Bunny CDN
        ffmpegLogger.info(`Uploading M3U8 file to Bunny CDN for identifier: ${identifier}`);
        await uploadToBunnyCDN(path.join(bunnyOutputDir, m3u8FileName), `${identifier}-${timestamp}`, m3u8FileName);

        ffmpegLogger.info(`Stream processing finished for identifier: ${identifier}`);
    } catch (error) {
        streamLogger.error(`Error finishing stream for identifier ${identifier}: ${error.message}`);
    }
};

const handleDeleteStreamRelatedFolders = async (identifier) => {
    try {
        // Retrieve timestamp
        const timestamp = retrieveTimestamp(identifier);
        const liveStreamOutputDir = path.join(liveStreamDir, `${identifier}-${timestamp}`);
        const bunnyOutputDir = path.join(bunnyDir, `${identifier}-${timestamp}`);

        // Delete live stream output directory
        if (fs.existsSync(liveStreamOutputDir)) {
            await fs.promises.rm(liveStreamOutputDir, { recursive: true, force: true });
            fileLogger.info(`Deleted folder: ${liveStreamOutputDir}`);
        } else {
            fileLogger.warn(`Folder not found: ${liveStreamOutputDir}`);
        }

        // Delete Bunny output directory
        if (fs.existsSync(bunnyOutputDir)) {
            await fs.promises.rm(bunnyOutputDir, { recursive: true, force: true });
            fileLogger.info(`Deleted folder: ${bunnyOutputDir}`);
        } else {
            fileLogger.warn(`Folder not found: ${bunnyOutputDir}`);
        }
    } catch (error) {
        fileLogger.error(`Error cleaning up stream related folders: ${error.message}`);
    }
};

// Stop FFmpeg process
const stopFFmpeg = async (identifier, hasEndTag) => {
    try {
        const pidFilePath = path.join(pidDir, `ffmpeg-${identifier}-pid.pid`);

        // Read pid file
        const pid = fs.readFileSync(pidFilePath, 'utf8');

        // Stop the FFmpeg process
        process.kill(pid);
        fs.unlinkSync(pidFilePath);
        ffmpegLogger.info(`FFmpeg process with PID ${pid} stopped`);

        // Find the most recent .m3u8 file in the output directory
        const outputDir = path.join(liveStreamDir, identifier);

        // Define m3u8 file path
        const m3u8FileName = `${identifier}.m3u8`;
        const m3u8FilePath = path.join(outputDir, m3u8FileName);

        // Append '#EXT-X-ENDLIST' tag to the m3u8 file if it exists and the end tag is missing
        if (!hasEndTag) {
            if (fs.existsSync(m3u8FilePath)) {
                fs.appendFileSync(m3u8FilePath, '#EXT-X-ENDLIST\n', 'utf8');
                ffmpegLogger.info(`Appended '#EXT-X-ENDLIST' to ${m3u8FilePath}`);
            } else {
                ffmpegLogger.error(`M3U8 file ${m3u8FilePath} not found.`);
            }
        }
    } catch (error) {
        ffmpegLogger.error(`Failed to stop FFmpeg for ${identifier}: ${error.message}`);
    }
};

function writeTimestamp(identifier, timestamp) {
    try {
        const dirPath = path.join(liveStreamDir, `${identifier}-${timestamp}`);
        const filePath = path.join(dirPath, 'timestamp.txt');

        // Ensure the directory exists (with recursive flag)
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            fileLogger.info(`Directory created: ${dirPath}`);
        }

        // Write timestamp to the file
        fs.writeFileSync(filePath, timestamp);
        fileLogger.info(`Timestamp written to ${filePath} for identifier: ${identifier}`);
    } catch (error) {
        fileLogger.error(`Error writing timestamp for identifier ${identifier}: ${error.message}`);
    }
}

function retrieveTimestamp(identifier) {
    try {
        const sortedDirs = getSortedDirectories(identifier);

        // Ensure there's at least one directory
        if (!sortedDirs || sortedDirs.length === 0) {
            fileLogger.error(`No directories found for identifier ${identifier} to retrieve timestamp`);
            return null;
        }

        const recentDir = sortedDirs[0];
        const filePath = path.join(recentDir.path, 'timestamp.txt');

        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            fileLogger.error(`Timestamp file does not exist for directory: ${recentDir.path}`);
            return null;
        }

        // Read the timestamp from the file
        const timestampContent = fs.readFileSync(filePath, 'utf-8');
        fileLogger.info(`Retrieved timestamp for identifier ${identifier}: ${timestampContent}`);
        return timestampContent;
    } catch (error) {
        fileLogger.error(`Error retrieving timestamp for identifier ${identifier}: ${error.message}`);
        return null;
    }
}

function getSortedDirectories(identifier) {
    try {
        const baseDir = liveStreamDir;

        // Read the base directory
        const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
            .filter(dir => dir.isDirectory() && dir.name.startsWith(identifier))
            .map(dir => ({
                name: dir.name,
                path: path.join(baseDir, dir.name),
                timestamp: fs.statSync(path.join(baseDir, dir.name)).birthtime
            }));

        // Sort directories by timestamp in descending order (most recent first)
        const sortedDirs = dirs.sort((a, b) => b.timestamp - a.timestamp); // most recent first

        return sortedDirs;
    } catch (error) {
        fileLogger.error(`Error getting sorted directories: ${error.message}`);
    }
}

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
            thumbnailLogger.info(`Thumbnail already exists at: ${outputPath}`);
            return outputPath; // Return immediately if the thumbnail exists
        }

        for (const tsFilePath of tsFiles) {
            // Check if the selected TS file exists
            if (!fs.existsSync(tsFilePath)) {
                fileLogger.info(`TS file not found: ${tsFilePath}, skipping.`);
                continue; // Skip this file if it doesn't exist
            }

            thumbnailLogger.info(`Creating thumbnail for: ${tsFilePath}`);

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
                            ffmpegLogger.info(`Thumbnail created at: ${outputPath}`);
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
                thumbnailLogger.error(error.message); // Log the error for this TS file
            }
        }

        throw new Error(`Failed to create a thumbnail from all TS files`);

    } catch (error) {
        thumbnailLogger.error(`Error creating thumbnail: ${error.message}`);
        throw error;
    }
};


const uploadToBunnyCDN = async (filePath, identifier, fileName) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File does not exist at path: ${filePath}`);
        }

        return new Promise((resolve, reject) => {
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
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                    Expires: "0",
                    Pragma: "no-cache",
                },
            };

            const req = https.request(options, (res) => {
                let responseData = '';

                res.on("data", (chunk) => {
                    responseData += chunk.toString("utf8");
                });

                res.on("end", () => {
                    bunnyLogger.info(`Upload completed: ${responseData}`);
                    resolve();
                });
            });

            req.on("error", (error) => {
                bunnyLogger.error(`Upload error: ${error.message}`);
                reject(error);
            });

            readStream.on("error", (error) => {
                fileLogger.error(`ReadStream error: ${error.message}`);
                req.destroy(); // Ensure request is terminated
                reject(error);
            });

            req.setTimeout(15000, () => {
                readStream.destroy();
                req.destroy();
                reject(new Error("Upload timed out"));
            });

            readStream.pipe(req);   
        });
    } catch (error) {
        bunnyLogger.error(`Error uploading to Bunny: ${error.message}`);
        await handleDeleteStreamRelatedFolders(identifier);
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
    try {
        // Retrieve timestamp
        const timestamp = retrieveTimestamp(identifier);

        const cdnUrl = `https://${process.env.BUNNY_DOMAIN_STORAGE_ZONE}/video/${identifier}-${timestamp}`;
        let m3u8Content = fs.readFileSync(m3u8FilePath, "utf8");

        const regex = new RegExp(
            `${identifier}-segment-\\d{8}-\\d{6}\\.ts`,
            "g"
        );

        m3u8Content = m3u8Content.replace(regex, (match) => {
            return `${cdnUrl}/${match}`;
        });

        fs.writeFileSync(m3u8FilePath, m3u8Content);
    } catch (error) {
        fileLogger.error(`Error replacing ts files path: ${error.message}`);
    }
};

// Function to upload .ts segment files
const uploadTsFiles = async (outputDir, identifier, second = 300) => {
    try {
        // Retrieve timestamp
        const timestamp = retrieveTimestamp(identifier);
        
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
            fileLogger.error('No TS files selected for upload.');
            return;
        }

        for (const file of selectedFiles) {
            const filePath = path.join(outputDir, file);
            await uploadToBunnyCDN(filePath, `${identifier}-${timestamp}`, file);
        }
        
        bunnyLogger.info(`Uploaded ts files successfully`);
    } catch (error) {
        bunnyLogger.error(`Error uploading ts files: ${error.message}`);
    }
};


const uploadThumbnail = async (outputDir, identifier) => {
    try {
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
    } catch (error) {
        bunnyLogger.error(`Error uploading thumbnail to Bunny: ${error.message}`);
    }
};

function killFfmpegProcessesWindow() {
    try {
        exec('tasklist | findstr ffmpeg', (err, stdout, stderr) => {
            if (err && err.code !== 1) {
                ffmpegLogger.error(`Error fetching process list: ${err}`);
                return;
            }

            const lines = stdout.trim().split('\n');
            if (lines.length === 0 || lines[0] === '') {
                ffmpegLogger.info('No ffmpeg processes found.');
                return;
            }

            // Extract PIDs from the output
            const pids = lines.map(line => {
                const parts = line.trim().split(/\s+/);
                return parts[1]; // PID is typically the second column
            });

            // Create a command to kill all identified ffmpeg processes
            const killCommand = `taskkill /F /PID ${pids.join(' /PID ')}`;

            // Execute the kill command
            exec(killCommand, (killErr, killStdout, killStderr) => {
                if (killErr) {
                    ffmpegLogger.error(`Error killing processes: ${killStderr}`);
                    return;
                }

                const successMessages = pids.map(pid => `SUCCESS: The process with PID ${pid} has been terminated.`).join('\n');
                ffmpegLogger.info(successMessages);
            });
        });
    } catch (error) {
        ffmpegLogger.error(`Window: Error killing FFmpeg processes: ${error.message}`);
    }
}

function killFfmpegProcessesLinux() {
    try {
        exec('pgrep -f ffmpeg', (err, stdout, stderr) => {
            if (err) {
                ffmpegLogger.error(`Error fetching process list: ${err}`);
                return;
            }

            const pids = stdout.trim().split('\n').map(pid => pid.trim()).filter(Boolean); // Filter out any empty entries

            if (pids.length === 0) {
                ffmpegLogger.info('No ffmpeg processes found.');
                return;
            }

            const killCommand = `kill -9 ${pids.join(' ')}`;

            // Execute the kill command
            exec(killCommand, (killErr, killStdout, killStderr) => {
                if (killErr) {
                    ffmpegLogger.error(`Error killing processes: ${killStderr}`);
                    return;
                }

                const successMessages = pids.map(pid => `SUCCESS: The process with PID ${pid} has been terminated.`).join('\n');
                ffmpegLogger.info(successMessages);
            });
        });
    } catch (error) {
        ffmpegLogger.error(`Linux: Error killing FFmpeg processes: ${error.message}`);
    }
}

const retrieveCloudFlareStreamLiveInput = async (uid) => {
    try {
        let stream = null;
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
                cloudflareLogger.error("Error retrieving live input");
            });
        return stream;
    } catch (error) {
        throw error;
    }
};

module.exports = { sendToQueue, getMessage, startFFmpeg, killFfmpegProcessesLinux, killFfmpegProcessesWindow };
