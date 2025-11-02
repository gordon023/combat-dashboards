import express from "express";
import multer from "multer";
import fs from "fs-extra";
import cors from "cors";
import path from "path";
import cv from "@u4/opencv4nodejs";
import Tesseract from "tesseract.js";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const uploadDir = "./uploads";
const dataFile = "./data/store.json";
fs.ensureDirSync(uploadDir);
fs.ensureDirSync("./data");
if (!fs.existsSync(dataFile)) fs.writeJsonSync(dataFile, []);

// Multer setup for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// Detection function
async function detectUIElements(filePath) {
  const image = await cv.imreadAsync(filePath);

  // Convert to grayscale
  const gray = image.bgrToGray();

  // Simple feature detection thresholds
  const inventoryRegion = gray.getRegion(new cv.Rect(950, 100, 350, 500)); // right side
  const equippedRegion = gray.getRegion(new cv.Rect(450, 400, 400, 200)); // center-bottom
  const powerRegion = gray.getRegion(new cv.Rect(40, 620, 300, 100)); // lower-left text

  // OCR combat power
  const ocrResult = await Tesseract.recognize(
    powerRegion.getData(),
    "eng",
    { logger: () => {} }
  );

  const text = ocrResult.data.text.replace(/\n/g, " ");
  const hasCombatPower = /combat\s*power/i.test(text);
  const powerValueMatch = text.match(/\d{4,}/);
  const combatPower = powerValueMatch ? powerValueMatch[0] : null;

  // Dummy visual presence detection by pixel variance
  const hasInventory =
    inventoryRegion.mean().w > 10 && inventoryRegion.stdDev().w > 20;
  const hasEquipped =
    equippedRegion.mean().w > 10 && equippedRegion.stdDev().w > 20;

  return {
    inventory: hasInventory ? "✅" : "❌",
    equipped: hasEquipped ? "✅" : "❌",
    combatPower: hasCombatPower ? `⚡ ${combatPower || "Detected"}` : "❌",
  };
}

// Upload endpoint
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const result = await detectUIElements(req.file.path);
    const record = {
      file: req.file.filename,
      ...result,
    };

    const data = await fs.readJson(dataFile);
    data.unshift(record);
    await fs.writeJson(dataFile, data);

    res.json(record);
  } catch (err) {
    console.error("Detection error:", err);
    res.status(500).json({ error: "Detection failed" });
  }
});

// Fetch table data
app.get("/data", async (req, res) => {
  const data = await fs.readJson(dataFile);
  res.json(data);
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
