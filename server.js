import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import Tesseract from "tesseract.js";
import Jimp from "jimp";
import cv from "opencv4nodejs";

const app = express();
const PORT = process.env.PORT || 10000;

const dataPath = path.join(process.cwd(), "data.json");
const uploadPath = path.join(process.cwd(), "uploads");
const templateDir = path.join(process.cwd(), "templates");
const slotTemplatePath = path.join(templateDir, "slot.png");

for (const dir of [uploadPath, templateDir]) if (!fs.existsSync(dir)) fs.mkdirSync(dir);
if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, "[]");

// Multer upload setup
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadPath),
  filename: (_, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ---------- UTILITIES ----------

// OCR helpers
async function extractText(imgPath) {
  const { data } = await Tesseract.recognize(imgPath, "eng");
  return data.text;
}

async function preprocessImage(inputPath) {
  const img = await Jimp.read(inputPath);
  const processedPath = inputPath.replace(/\.(png|jpg|jpeg)$/i, "_proc.png");
  await img.resize(1360, Jimp.AUTO).grayscale().contrast(0.7).normalize().writeAsync(processedPath);
  return processedPath;
}

function findField(text, regex, label) {
  const match = text.match(regex);
  return match ? match[1].trim() : `${label} not detected`;
}

// Slot template learning
async function generateSlotTemplate(imagePath) {
  const image = await cv.imreadAsync(imagePath);
  const gray = await image.bgrToGrayAsync();
  const edges = await gray.cannyAsync(50, 150);
  const contours = await edges.findContoursAsync(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let bestRect = null;
  for (const c of contours) {
    const r = c.boundingRect();
    const ratio = r.width / r.height;
    if (ratio > 0.9 && ratio < 1.1 && r.width > 30 && r.width < 150) {
      bestRect = r;
      break;
    }
  }

  if (bestRect) {
    const roi = image.getRegion(bestRect);
    await cv.imwriteAsync(slotTemplatePath, roi);
    console.log("✅ Slot template created!");
  } else {
    console.log("⚠️ No slot detected for template creation.");
  }
}

// Detect slots using OpenCV template matching
async function detectSlots(imagePath) {
  if (!fs.existsSync(slotTemplatePath)) return false;
  const img = await cv.imreadAsync(imagePath);
  const tpl = await cv.imreadAsync(slotTemplatePath);
  const matched = img.matchTemplate(tpl, cv.TM_CCOEFF_NORMED);
  const mask = matched.threshold(0.8, 1, cv.THRESH_TOZERO);
  const count = mask.countNonZero();
  return count > 15;
}

// ---------- ROUTES ----------

app.post("/upload", upload.single("image"), async (req, res) => {
  const imagePath = req.file.path;
  console.log("📸 Uploaded:", imagePath);

  if (!fs.existsSync(slotTemplatePath)) await generateSlotTemplate(imagePath);

  const processed = await preprocessImage(imagePath);
  const text = await extractText(processed);

  const name = findField(text, /(?:\n|^)([A-Za-z0-9]+)\s+Phantom|Paladin|Warrior|Mage|Staff/i, "Name");
  const level = findField(text, /(?:Battle Staff|Level)\s*(\d{1,3})/i, "Level");
  const combatPower = findField(text, /Combat\s*Power\s*([\d,]+)/i, "Combat Power");

  const equippedVisible = await detectSlots(imagePath);
  const inventoryVisible = await detectSlots(imagePath);

  const record = {
    id: Date.now(),
    image: path.basename(imagePath),
    name,
    level,
    combatPower,
    equippedVisible,
    inventoryVisible
  };

  const existing = JSON.parse(fs.readFileSync(dataPath));
  existing.unshift(record);
  fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2));

  res.redirect("/");
});

app.get("/records", (_, res) => {
  const records = JSON.parse(fs.readFileSync(dataPath));
  res.json(records);
});

// Serve uploads
app.use("/uploads", express.static(uploadPath));

// ---------- FRONTEND ----------

app.get("/", (_, res) => {
  const records = JSON.parse(fs.readFileSync(dataPath));

  const rows = records
    .map(
      (r) => `
      <tr class="border-b">
        <td class="p-2"><img src="/uploads/${r.image}" class="w-64 rounded shadow"></td>
        <td class="p-2">
          <div class="font-semibold text-blue-600">${r.name}</div>
          <div>Level: ${r.level}</div>
          <div>Combat Power: ${r.combatPower}</div>
          <div class="mt-2 border-t pt-2">
            <div>🛡️ Equipped Slots: <b>${r.equippedVisible ? "Detected" : "Not found"}</b></div>
            <div>🎒 Inventory Slots: <b>${r.inventoryVisible ? "Detected" : "Not found"}</b></div>
          </div>
        </td>
      </tr>`
    )
    .join("");

  res.send(`
  <html>
    <head>
      <title>Smart UI Analyzer</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 min-h-screen p-8 font-sans">
      <h1 class="text-2xl font-bold mb-4">📊 Smart Game UI Analyzer</h1>
      <form enctype="multipart/form-data" method="post" action="/upload" class="bg-white p-4 rounded shadow-md mb-6">
        <input type="file" name="image" accept="image/*" required class="mb-3" />
        <button class="bg-blue-500 text-white px-4 py-2 rounded" type="submit">Upload Screenshot</button>
      </form>
      <div class="overflow-x-auto bg-white rounded shadow-md">
        <table class="w-full text-sm text-left border-collapse">
          <thead class="bg-gray-200">
            <tr><th class="p-2">Image</th><th class="p-2">Extracted Details</th></tr>
          </thead>
          <tbody>${rows || "<tr><td colspan='2' class='p-4 text-gray-500'>No records yet</td></tr>"}</tbody>
        </table>
      </div>
    </body>
  </html>`);
});

app.listen(PORT, () => console.log("✅ Smart Detection Server running on port", PORT));
