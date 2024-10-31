require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { sendToQueue, getMessage } = require("./utils");
const cloudflareRoutes = require("./routes/CloudflareRoute");
const streamRoutes = require("./routes/StreamRoute");
const app = express();

// Middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/live-stream', express.static(path.join(__dirname, 'live-stream'), {
  setHeaders: (res) => {
      res.set('Cache-Control', 'no-cache');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
  }
}));

// Log API requests
app.use((req, res, next) => {
  console.log(req.method + " " + req.path);
  next();
});

app.post("/api/webhooks/cloudflare", async (req, res) => {
  const data = req.body;
  const queueName = `cloudflare.livestream`;

  try {
    await sendToQueue(queueName, data);

    res.status(200).json({ message: "OK" });
  } catch (error) {
    res.status(500).json({ error: "Failed to process webhook" });
  }
})

app.use("/api/cloudflare", cloudflareRoutes);
app.use("/api/streams", streamRoutes);

try {
  getMessage(`cloudflare.livestream`);
} catch (error) {
  console.error("Error consuming queue: ", error);
}

// Start server
const port = process.env.DEVELOPMENT_PORT || 3101;

app.listen(port, (err) => {
  if (err) {
    console.log("Failed to start server:", err);
    process.exit(1);
  } else {
    console.log(`Server is running at: http://localhost:${port}`);
  }
});
