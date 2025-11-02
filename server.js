// server.js
import express from "express";
import multer from "multer";
import fs from "fs";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

// Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ✅ Safe writable folder for Render (relative, not /data)
const uploadDir = path.join(__dirname, "public", "uploads");
const jsonFile = path.join(__dirname, "detections.json");

// Ensure folders & files exist
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(jsonFile)) fs.writeFileSync(jsonFile, "[]");

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// 🟢 Upload endpoint
app.post("/upload", upload.single("image"), (req, res) => {
  const filePath = `/uploads/${req.file.filename}`;

  // simulate detection results
  const detection = {
    id: Date.now(),
    filename: req.file.filename,
    path: filePath,
    detected: {
      inventoryPanel: true,
      equippedItems: true,
      combatPower: "123456"
    }
  };

  // read existing
  const detections = JSON.parse(fs.readFileSync(jsonFile));
  detections.push(detection);
  fs.writeFileSync(jsonFile, JSON.stringify(detections, null, 2));

  // emit update
  io.emit("new_detection", detection);

  res.json({ success: true, detection });
});

// 🟢 Get all detections
app.get("/detections", (req, res) => {
  const detections = JSON.parse(fs.readFileSync(jsonFile));
  res.json(detections);
});

// Realtime connection
io.on("connection", (socket) => {
  console.log("🟢 New socket connected");
});

// Start
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
