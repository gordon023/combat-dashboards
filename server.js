// server.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import Jimp from "jimp";
import Tesseract from "tesseract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "public", "uploads");
const dataFile = path.join(__dirname, "detections.json");

// ensure folders & files exist
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, "[]");

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${unique}${path.extname(file.originalname) || ".png"}`);
  }
});
const upload = multer({ storage });

// ---------------------------
// Normalized bounding boxes
// (x, y, w, h) are fractions of image width/height
// These were chosen to match your green guide zones.
// You can tune them if your screenshots slightly differ.
// ---------------------------
const BOXES = {
  // inventory panel on the right (large vertical)
  inventory: { x: 0.72, y: 0.06, w: 0.26, h: 0.88 },

  // equipped items area center-bottom (around action bar / equipped icons)
  equipped: { x: 0.28, y: 0.44, w: 0.44, h: 0.34 },

  // combat power bottom-left (small HUD block)
  combatPower: { x: 0.02, y: 0.78, w: 0.28, h: 0.18 }
};

// Helper: measure "visualness" of a cropped Jimp image
async function regionHasContent(jimpImage) {
  // Convert to greyscale then compute pixel variance (higher => not blank)
  const clone = jimpImage.clone().greyscale();
  let sum = 0;
  let sumSq = 0;
  const w = clone.bitmap.width;
  const h = clone.bitmap.height;
  const total = w * h;
  for (let y = 0; y < h; y += 2) { // step to speed up
    for (let x = 0; x < w; x += 2) {
      const idx = (y * w + x) << 2;
      const r = clone.bitmap.data[idx]; // grayscale => r==g==b
      sum += r;
      sumSq += r * r;
    }
  }
  const n = (Math.ceil(h/2) * Math.ceil(w/2));
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;

  // heuristics: variance > threshold => region contains UI content
  // threshold chosen empirically; adjust if needed.
  return variance > 60;
}

// Helper: crop Jimp image using normalized box
function cropByNormalized(img, box) {
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const x = Math.max(0, Math.round(box.x * w));
  const y = Math.max(0, Math.round(box.y * h));
  const cw = Math.max(1, Math.round(box.w * w));
  const ch = Math.max(1, Math.round(box.h * h));
  return img.clone().crop(x, y, cw, ch);
}

// OCR helper for combat power region
async function readCombatPowerText(fullImagePath) {
  try {
    const img = await Jimp.read(fullImagePath);
    const crop = cropByNormalized(img, BOXES.combatPower);

    // increase contrast and scale for better OCR
    crop
      .greyscale()
      .contrast(0.4)
      .normalize()
      .resize(crop.bitmap.width * 2, crop.bitmap.height * 2, Jimp.RESIZE_BEZIER);

    // write to buffer for Tesseract
    const buffer = await crop.getBufferAsync(Jimp.MIME_PNG);

    const result = await Tesseract.recognize(buffer, 'eng', {
      logger: m => { /* optional logs */ }
    });

    const text = result?.data?.text || "";
    // try to find numbers; prefer patterns like "Combat Power 12,345" or just big numbers
    const match = text.match(/combat\s*power\s*[:\s]*([\d,]+)/i) || text.match(/([\d,]{3,})/);
    if (match) {
      return match[1].replace(/[^\d]/g, "");
    }
    return "";
  } catch (err) {
    console.error("OCR error:", err);
    return "";
  }
}

// ---------------------------
// Upload endpoint
// ---------------------------
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const filename = req.file.filename;
    const relPath = `/uploads/${filename}`;
    const fullPath = path.join(uploadDir, filename);

    // load image with Jimp
    const img = await Jimp.read(fullPath);

    // crop and analyze regions
    const invCrop = cropByNormalized(img, BOXES.inventory);
    const equipCrop = cropByNormalized(img, BOXES.equipped);
    const cpCrop = cropByNormalized(img, BOXES.combatPower);

    const invVisible = await regionHasContent(invCrop);
    const equipVisible = await regionHasContent(equipCrop);

    // OCR combat power region (if likely contains digits)
    let combatText = "";
    // We attempt OCR always because sometimes CombatPower area looks empty to variance but text exists.
    combatText = await readCombatPowerText(fullPath);

    // Build detected array (for UI)
    const detected = [];
    detected.push({ key: "equippedSlot", visible: !!equipVisible });
    detected.push({ key: "inventoryPanel", visible: !!invVisible });
    // combat power label will be added separately if found

    // store detection object (no timestamp per your request)
    const detection = {
      id: Date.now(),
      path: relPath,
      equippedVisible: !!equipVisible,
      inventoryVisible: !!invVisible,
      combatPower: combatText || null,
      // boxes provided in pixel coordinates (useful for client overlay)
      boxes: (() => {
        const w = img.bitmap.width;
        const h = img.bitmap.height;
        return {
          inventory: { x: Math.round(BOXES.inventory.x * w), y: Math.round(BOXES.inventory.y * h), w: Math.round(BOXES.inventory.w * w), h: Math.round(BOXES.inventory.h * h) },
          equipped: { x: Math.round(BOXES.equipped.x * w), y: Math.round(BOXES.equipped.y * h), w: Math.round(BOXES.equipped.w * w), h: Math.round(BOXES.equipped.h * h) },
          combatPower: { x: Math.round(BOXES.combatPower.x * w), y: Math.round(BOXES.combatPower.y * h), w: Math.round(BOXES.combatPower.w * w), h: Math.round(BOXES.combatPower.h * h) }
        };
      })()
    };

    // save detection
    const all = JSON.parse(fs.readFileSync(dataFile));
    all.push(detection);
    fs.writeFileSync(dataFile, JSON.stringify(all, null, 2));

    // emit realtime
    io.emit("new_detection", detection);

    res.json({ success: true, detection });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/detections", (req, res) => {
  const all = JSON.parse(fs.readFileSync(dataFile));
  res.json(all);
});

// start server
httpServer.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
