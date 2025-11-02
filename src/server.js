import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import Tesseract from "tesseract.js";

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Persistent Storage ----
const DATA_FILE = "./data/data.json";
const UPLOAD_DIR = "./public/uploads";
fs.mkdirSync("./data", { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---- Middleware ----
app.use(express.json());
app.use(express.static("public"));

// ---- File Upload Config ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// ---- Load / Save JSON ----
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---- OCR-based Detection ----
async function analyzeScreenshot(imgPath) {
  const result = { equipped: "❌", inventory: "❌", combatPower: "❌" };

  try {
    const { data: { text } } = await Tesseract.recognize(imgPath, "eng", {
      tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ",
    });

    const cleanText = text.replace(/\s+/g, " ").trim();

    // Detect Combat Power
    const match = cleanText.match(/Combat Power\s?([\d,]+)/i);
    if (match) result.combatPower = match[1];

    // Detect equipped/inventory UI visibility
    if (/Weapon/i.test(cleanText) && /Armor/i.test(cleanText)) result.inventory = "✅";
    if (/Staff|Bow|Sword|Shield|Armor/i.test(cleanText)) result.equipped = "✅";

  } catch (err) {
    console.error("OCR error:", err.message);
  }

  return result;
}

// ---- Routes ----

// Upload and analyze image
app.post("/upload", upload.single("image"), async (req, res) => {
  const filePath = req.file.path;
  const results = await analyzeScreenshot(filePath);

  const data = loadData();
  const newEntry = {
    id: Date.now(),
    file: "/uploads/" + path.basename(filePath),
    equipped: results.equipped,
    inventory: results.inventory,
    combatPower: results.combatPower,
  };

  data.push(newEntry);
  saveData(data);

  res.json({ success: true, entry: newEntry });
});

// Fetch stored data
app.get("/data", (req, res) => {
  res.json(loadData());
});

// ---- Start Server ----
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
