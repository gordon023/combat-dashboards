import express from "express";
import multer from "multer";
import fs from "fs-extra";
import cors from "cors";
import cv from "@u4/opencv4nodejs";

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });
const dataFile = "./data/detections.json";

fs.ensureFileSync(dataFile);
let detections = fs.readJsonSync(dataFile, { throws: false }) || [];

// 📤 Upload & detect
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const imgPath = req.file.path;
    const mat = cv.imread(imgPath);
    const gray = mat.bgrToGray();
    const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
    const edges = blurred.canny(50, 150);

    // 🔍 Find contours for slot boxes
    const contours = edges.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const slots = contours
      .map(c => c.boundingRect())
      .filter(r => r.width > 20 && r.height > 20); // filter small noise

    const height = mat.rows;
    const width = mat.cols;

    // 🧠 Smart Region-based detection (approx zones)
    const equipped = slots.filter(r => r.y < height * 0.4);
    const inventory = slots.filter(r => r.y >= height * 0.4 && r.y < height * 0.8);
    const combatPowerZone = new cv.Rect(width * 0.7, height * 0.8, width * 0.25, height * 0.15);

    // Draw results
    const output = mat.copy();
    equipped.forEach(r => output.drawRectangle(r, new cv.Vec(0, 255, 0), 2));
    inventory.forEach(r => output.drawRectangle(r, new cv.Vec(255, 255, 0), 2));
    output.drawRectangle(combatPowerZone, new cv.Vec(255, 0, 0), 2);

    const outputPath = `public/output_${Date.now()}.jpg`;
    cv.imwrite(outputPath, output);

    // Save persistent result
    const result = {
      id: Date.now(),
      image: outputPath.replace("public/", ""),
      equippedCount: equipped.length,
      inventoryCount: inventory.length,
      combatPowerDetected: true,
      timestamp: new Date().toISOString(),
    };
    detections.push(result);
    await fs.writeJson(dataFile, detections);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Detection failed" });
  }
});

// 📥 Get all detections
app.get("/detections", (req, res) => {
  res.json(detections);
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
