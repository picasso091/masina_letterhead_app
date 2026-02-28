import express from "express";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));

app.use("/assets", express.static(path.join(__dirname, "assets")));

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    const executablePath = await chromium.executablePath();

    console.log("Chromium path:", executablePath);

    browserPromise = puppeteer.launch({
      executablePath,
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport,
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
    });
  }
  return browserPromise;
}

// Nepali date picker dist
const ndpDistPath = path.join(
  __dirname,
  "node_modules/@sajanm/nepali-date-picker/dist"
);
app.use("/vendor/nepali-date-picker", express.static(ndpDistPath));

function pad2(n) {
  return String(n).padStart(2, "0");
}
function todayADInput() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function escapeHtml(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getNdpVersion() {
  const pkgPath = path.join(
    __dirname,
    "node_modules/@sajanm/nepali-date-picker/package.json"
  );
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

// Form page
app.get("/", (req, res) => {
  const formPath = path.join(__dirname, "views/form.html");
  let html = fs.readFileSync(formPath, "utf8");

  const ndpVersion = getNdpVersion();

  html = html
    .replaceAll("{{TODAY_AD_INPUT}}", todayADInput())
    .replaceAll("{{NDP_VERSION}}", ndpVersion);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// Generate PDF
app.post("/generate", async (req, res) => {
  const templatePath = path.join(__dirname, "views/template.html");
  const template = fs.readFileSync(templatePath, "utf8");

  const base = `${req.protocol}://${req.get("host")}`;
  const language = req.body.language || "nepali";

  const DATE_LABEL = language === "english" ? "Date:" : "मिति:-";
  const SUBJECT_LABEL = language === "english" ? "Subject:" : "विषय:-";
  const SALUTATION = language === "english" ? "Dear" : "श्री";

  const data = {
    LOGO_PATH: `${base}/assets/logo.png`,
    DEV_FONT_REG: `${base}/assets/fonts/NotoSansDevanagari-Regular.ttf`,
    DEV_FONT_BOLD: `${base}/assets/fonts/NotoSansDevanagari-Bold.ttf`,

    DATE_LABEL: escapeHtml(DATE_LABEL),
    DATE: escapeHtml(req.body.date || ""),
    SUBJECT_LABEL: escapeHtml(SUBJECT_LABEL),
    SALUTATION: escapeHtml(SALUTATION),

    RECIPIENT: escapeHtml(req.body.recipient || ""),
    ORG: escapeHtml(req.body.org || ""),
    ADDRESS: escapeHtml(req.body.address || ""),
    SUBJECT: escapeHtml(req.body.subject || ""),
    BODY_TEXT: escapeHtml(req.body.body || ""),
    SIGN_NAME: escapeHtml(req.body.signname || ""),
    SIGN_TITLE: escapeHtml(req.body.signtitle || ""),
  };

  const html = template.replace(/{{(\w+)}}/g, (_, key) => data[key] || "");

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
    });

    page.setDefaultTimeout(60000);

    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdfBytes = await page.pdf({
      width: "210mm",
      height: "297mm",
      printBackground: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
    });

    await page.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="notice.pdf"'
    );
    return res.end(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("PDF error:", err);
    return res.status(500).send("PDF generation failed (see server logs).");
  }
});

app.listen(3000, "0.0.0.0", () => {
  console.log("🚀 Server running on port 3000");
});

process.on("SIGTERM", async () => {
  try {
    const b = await browserPromise;
    if (b) await b.close();
  } catch (err) {
    console.error("Error closing browser:", err);
  }
  process.exit(0);
});