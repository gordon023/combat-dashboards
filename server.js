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

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, "[]");

app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.png`),
});

const upload = multer({ storage });

// Simulate simple detection + OCR
app.post("/upload", upload.single("image"), async (req, res) => {
  const imagePath = `/uploads/${req.file.filename}`;
  const fullPath = path.join(uploadDir, req.file.filename);

  let combatPowerText = "";
  let detected = ["Inventory Panel", "Equipped Slots"];

  try {
    const ocrResult = await Tesseract.recognize(fullPath, "eng", {
      logger: (info) => console.log(info.status),
    });

    const text = ocrResult.data.text;
    console.log("OCR Text:", text);

    // Look for combat power pattern
    const match = text.match(/Combat Power\s*([\d,]+)/i);
    if (match) {
      combatPowerText = `Combat Power ${match[1]}`;
      detected.push(combatPowerText);
    }
  } catch (err) {
    console.error("OCR Error:", err);
  }

  // Mock bounding boxes for visual demo
  const boxes = [
    { label: "Inventory", x: 900, y: 200, w: 300, h: 600 },
    { label: "Equipped", x: 700, y: 400, w: 150, h: 300 },
  ];

  const newDetection = {
    id: Date.now(),
    path: imagePath,
    detected,
    boxes,
    combatPowerText,
    timestamp: new Date().toISOString(),
  };

  const detections = JSON.parse(fs.readFileSync(dataFile));
  detections.push(newDetection);
  fs.writeFileSync(dataFile, JSON.stringify(detections, null, 2));

  io.emit("newDetection", newDetection);

  res.json({ success: true, detection: newDetection });
});

app.get("/detections", (req, res) => {
  const detections = JSON.parse(fs.readFileSync(dataFile));
  res.json(detections);
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));
