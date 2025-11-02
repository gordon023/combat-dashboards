import express from "express";
import multer from "multer";
import fs from "fs-extra";
import cors from "cors";
import cv from "@u4/opencv4nodejs";
import Tesseract from "tesseract.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });
const dataFile = "./data/detections.json";

fs.ensureFileSync(dataFile);
let detections = fs.readJsonSync(dataFile, { throws: false }) || [];

// 🔍 Smart detect + OCR
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const imgPath = req.file.path;
    const mat = cv.imread(imgPath);
    const gray = mat.bgrToGray();
    const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
    const edges = blurred.canny(50, 150);

    const contours = edges.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const slots = contours
      .map(c => c.boundingRect())
      .filter(r => r.width > 20 && r.height > 20);

    const height = mat.rows;
    const width = mat.cols;

    // Regions
    const equipped = slots.filter(r => r.y < height * 0.4);
    const inventory = slots.filter(r => r.y >= height * 0.4 && r.y < height * 0.8);
    const combatRect = new cv.Rect(width * 0.7, height * 0.8, width * 0.25, height * 0.15);

    const output = mat.copy();
    equipped.forEach(r => output.drawRectangle(r, new cv.Vec(0, 255, 0), 2));
    inventory.forEach(r => output.drawRectangle(r, new cv.Vec(255, 255, 0), 2));
    output.drawRectangle(combatRect, new cv.Vec(255, 0, 0), 2);

    const combatCrop = mat.getRegion(combatRect);
    const combatPath = `uploads/crop_${Date.now()}.jpg`;
    cv.imwrite(combatPath, combatCrop);

    // 🧠 OCR: read text
    const ocrResult = await Tesseract.recognize(combatPath, "eng", {
      logger: m => console.log(m.status),
    });

    let combatText = ocrResult.data.text
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    let combatDetected = "";
    const match = combatText.match(/combat\s*power\s*\d+/i);
    if (match) combatDetected = match[0];
    else if (combatText.length > 0) combatDetected = combatText;

    const outputPath = `public/output_${Date.now()}.jpg`;
    cv.imwrite(outputPath, output);

    const result = {
      id: Date.now(),
      image: outputPath.replace("public/", ""),
      equippedSlots: equipped.length,
      inventorySlots: inventory.length,
      combatPower: combatDetected || "Not detected",
      timestamp: new Date().toISOString(),
    };

    detections.push(result);
    await fs.writeJson(dataFile, detections);

    res.json(result);
  } catch (err) {
    console.error("Detection failed:", err);
    res.status(500).json({ error: "Detection failed", details: err.message });
  }
});

app.get("/detections", (req, res) => {
  res.json(detections);
});

app.listen(PORT, () => console.log(`✅ Boss Detector running on port ${PORT}`));
