import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import Tesseract from "tesseract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const uploadDir = path.join(__dirname, "public", "uploads");
const dataFile = path.join(__dirname, "detections.json");

// ensure dirs
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, "[]");

app.use(express.static(path.join(__dirname, "public")));

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.png`),
});
const upload = multer({ storage });

// Handle upload + OCR
app.post("/upload", upload.single("image"), async (req, res) => {
  const imagePath = `/uploads/${req.file.filename}`;
  const fullPath = path.join(uploadDir, req.file.filename);

  let detected = [];
  let combatPowerText = "";

  try {
    const result = await Tesseract.recognize(fullPath, "eng", {
      logger: (m) => console.log(m.status),
    });
    const text = result.data.text;
    console.log("OCR TEXT:", text);

    // Simple keyword detection
    if (/inventory/i.test(text)) detected.push("Inventory Panel");
    if (/equip/i.test(text)) detected.push("Equipped Slots");

    const match = text.match(/combat\s*power\s*([\d,]+)/i);
    if (match) {
      combatPowerText = `Combat Power ${match[1]}`;
      detected.push(combatPowerText);
    }
  } catch (err) {
    console.error("OCR Error:", err);
  }

  const detection = {
    id: Date.now(),
    path: imagePath,
    detected: detected.length ? detected : ["No UI elements detected"],
    combatPowerText,
    timestamp: new Date().toISOString(),
    boxes: [
      { label: "Inventory", x: 820, y: 200, w: 300, h: 600 },
      { label: "Equipped", x: 600, y: 300, w: 150, h: 250 },
    ], // demo boxes
  };

  const detections = JSON.parse(fs.readFileSync(dataFile));
  detections.push(detection);
  fs.writeFileSync(dataFile, JSON.stringify(detections, null, 2));

  io.emit("newDetection", detection);
  res.json({ success: true, detection });
});

// Serve detection list
app.get("/detections", (req, res) => {
  const data = JSON.parse(fs.readFileSync(dataFile));
  res.json(data);
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);
