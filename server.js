import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

const upload = multer({ dest: "public/uploads/" });

const DATA_FILE = "detections.json";

// Load previous detections
let detections = [];
if (fs.existsSync(DATA_FILE)) {
  detections = JSON.parse(fs.readFileSync(DATA_FILE));
}

// --- Upload handler ---
app.post("/upload", upload.single("image"), (req, res) => {
  const newDetection = {
    id: Date.now(),
    filename: req.file.filename,
    detected: {
      inventory: true,
      equipped: true,
      combatPower: true,
    },
    timestamp: new Date().toISOString(),
  };

  detections.push(newDetection);
  fs.writeFileSync(DATA_FILE, JSON.stringify(detections, null, 2));

  io.emit("newDetection", newDetection);
  res.json({ success: true, detection: newDetection });
});

// --- Get all detections ---
app.get("/detections", (req, res) => {
  res.json(detections);
});

io.on("connection", (socket) => {
  console.log("🟢 Client connected");
});

server.listen(3000, () => console.log("✅ Server running at http://localhost:3000"));
