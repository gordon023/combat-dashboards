import express from "express";
import multer from "multer";
import fs from "fs-extra";
import path from "path";
import Tesseract from "tesseract.js";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const upload = multer({ dest: "uploads/" });
const dataFile = "data/store.json";

// Ensure data folder and JSON exist
fs.ensureFileSync(dataFile);
if (!fs.readFileSync(dataFile, "utf8")) fs.writeFileSync(dataFile, "[]");

// Detect UI elements (simple OCR-based)
async function detectUIElements(imagePath) {
  try {
    const { data } = await Tesseract.recognize(imagePath, "eng");
    const text = data.text.toLowerCase();

    const hasInventory = text.includes("inventory");
    const hasEquipped = text.includes("equip") || text.includes("equipped");
    const combatMatch = text.match(/combat\s*power\s*[:\-]?\s*(\d+)/i);

    return {
      inventoryVisible: hasInventory,
      equippedVisible: hasEquipped,
      combatPower: combatMatch ? combatMatch[1] : "N/A",
    };
  } catch (e) {
    console.error("OCR Error:", e);
    return { inventoryVisible: false, equippedVisible: false, combatPower: "N/A" };
  }
}

// Upload route
app.post("/upload", upload.single("screenshot"), async (req, res) => {
  const filePath = req.file.path;
  const result = await detectUIElements(filePath);

  const entry = {
    id: Date.now(),
    image: `/uploads/${req.file.filename}`,
    ...result,
  };

  const existing = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  existing.unshift(entry);
  fs.writeFileSync(dataFile, JSON.stringify(existing, null, 2));

  res.json(entry);
});

// Fetch table data
app.get("/data", (req, res) => {
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  res.json(data);
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
