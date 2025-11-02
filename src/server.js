import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import Tesseract from "tesseract.js";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const __dirname = path.resolve();

// Ensure directories exist
const uploadDir = path.join(__dirname, "public", "uploads");
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dataFile = path.join(dataDir, "data.json");

// Load or create persistent data file
let data = [];
if (fs.existsSync(dataFile)) {
  try {
    data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch (e) {
    console.error("Data load failed:", e);
    data = [];
  }
} else {
  fs.writeFileSync(dataFile, JSON.stringify([], null, 2));
}

// Save function (safe write)
function saveData() {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// Multer setup for image upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Serve static files
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ---- OCR + UI Detection ----
async function detectUIElements(imagePath) {
  const result = await Tesseract.recognize(imagePath, "eng");
  const text = result.data.text.toLowerCase();

  const hasInventory = text.includes("inventory") || text.includes("armor");
  const hasEquipped = text.includes("equipment") || text.includes("accessory");
  const combatPowerMatch = text.match(/combat power\s*([\d,]+)/i);
  const combatPower = combatPowerMatch ? combatPowerMatch[1] : "Not Detected";

  return {
    equipped: hasEquipped ? "✅" : "❌",
    inventory: hasInventory ? "✅" : "❌",
    combatPower
  };
}

// ---- Upload API ----
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const filePath = `/uploads/${req.file.filename}`;
    const detection = await detectUIElements(req.file.path);

    const record = {
      file: filePath,
      equipped: detection.equipped,
      inventory: detection.inventory,
      combatPower: detection.combatPower
    };

    data.push(record);
    saveData();

    io.emit("new_detection", record);
    res.json({ success: true, record });
  } catch (err) {
    console.error("Detection error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- Data load API ----
app.get("/data", (req, res) => res.json(data));

// ---- WebSocket ----
io.on("connection", (socket) => {
  console.log("Client connected");
  socket.emit("initial_data", data);
});

// ---- Server start ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
