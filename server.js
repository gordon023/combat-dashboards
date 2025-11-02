import express from "express";
import http from "http";
import { Server } from "socket.io";
import multer from "multer";
import fs from "fs";
import path from "path";
import Tesseract from "tesseract.js";
import Jimp from "jimp";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: "uploads/" });
const DATA_FILE = "./data/detections.json";

if (!fs.existsSync("./data")) fs.mkdirSync("./data");
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// Load detections
let detections = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

// Save persistently
const saveData = () => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(detections, null, 2));
};

// Upload endpoint
app.post("/upload", upload.single("screenshot"), async (req, res) => {
  const filePath = req.file.path;

  try {
    const image = await Jimp.read(filePath);
    const { width, height } = image.bitmap;

    // approximate detection boxes (percentage based)
    const regions = {
      inventory: { x: width * 0.70, y: height * 0.40, w: width * 0.25, h: height * 0.50 },
      equipped: { x: width * 0.10, y: height * 0.35, w: width * 0.25, h: height * 0.55 },
      combatPower: { x: width * 0.40, y: height * 0.80, w: width * 0.25, h: height * 0.15 }
    };

    // simple brightness variance check
    const checkVisible = async (r) => {
      const cropped = image.clone().crop(r.x, r.y, r.w, r.h);
      const pixels = [];
      cropped.scan(0, 0, r.w, r.h, (_, __, idx) => {
        const avg = (cropped.bitmap.data[idx] + cropped.bitmap.data[idx+1] + cropped.bitmap.data[idx+2]) / 3;
        pixels.push(avg);
      });
      const mean = pixels.reduce((a,b)=>a+b,0)/pixels.length;
      const variance = pixels.reduce((a,b)=>a+(b-mean)**2,0)/pixels.length;
      return variance > 100 ? "✅" : "❌";
    };

    const inventoryVisible = await checkVisible(regions.inventory);
    const equippedVisible = await checkVisible(regions.equipped);

    // OCR for combat power
    const combatCrop = image.clone().crop(regions.combatPower.x, regions.combatPower.y, regions.combatPower.w, regions.combatPower.h);
    const combatBuffer = await combatCrop.getBufferAsync(Jimp.MIME_PNG);
    const ocr = await Tesseract.recognize(combatBuffer, "eng");
    const combatPowerText = (ocr.data.text.match(/combat power\s*\d+/i) || [""])[0].trim();

    const record = {
      id: Date.now(),
      filename: req.file.filename,
      inventory: inventoryVisible,
      equipped: equippedVisible,
      combatPower: combatPowerText || "❌ Not detected"
    };

    detections.unshift(record);
    saveData();
    io.emit("update", record);

    res.json({ success: true, record });
  } catch (err) {
    console.error("Detection error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/data", (req, res) => res.json(detections));

io.on("connection", (socket) => {
  socket.emit("init", detections);
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
