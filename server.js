import express from "express";
import http from "http";
import { Server } from "socket.io";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

const uploadPath = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// persistent data path
const DATA_FILE = process.env.DATA_FILE || "/data/detections.json";
if (!fs.existsSync("/data")) fs.mkdirSync("/data", { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

let detections = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

// file upload config
const upload = multer({ dest: uploadPath });

// upload handler
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

// fetch all detections
app.get("/detections", (req, res) => {
  res.json(detections);
});

io.on("connection", (socket) => {
  console.log("🟢 Client connected");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
