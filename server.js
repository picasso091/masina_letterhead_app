import express from "express";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.urlencoded({ extended: true }));

// Serve assets (logo + fonts)
app.use("/assets", express.static(path.join(__dirname, "assets")));

// Serve nepali date picker dist from node_modules (FILES ARE DIRECTLY IN dist/)
const ndpDistPath = path.join(__dirname, "node_modules/@sajanm/nepali-date-picker/dist");
app.use("/vendor/nepali-date-picker", express.static(ndpDistPath));

function pad2(n) {
  return String(n).padStart(2, "0");
}
function todayADInput() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; // yyyy-mm-dd
}
function escapeHtml(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Read installed version to load the correct vX.Y.Z filenames
function getNdpVersion() {
  const pkgPath = path.join(__dirname, "node_modules/@sajanm/nepali-date-picker/package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version; // e.g. "5.0.6"
}

app.get("/", (req, res) => {
  const formPath = path.join(__dirname, "views/form.html");
  let html = fs.readFileSync(formPath, "utf8");

  const ndpVersion = getNdpVersion();

  // Build paths exactly like README:
  // /v5/nepali.datepicker/js/nepali.datepicker.v5.0.6.min.js
  // /v5/nepali.datepicker/css/nepali.datepicker.v5.0.6.min.css
  html = html
    .replaceAll("{{TODAY_AD_INPUT}}", todayADInput())
    .replaceAll("{{NDP_VERSION}}", ndpVersion);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.post("/generate", async (req, res) => {
  const templatePath = path.join(__dirname, "views/template.html");
  const template = fs.readFileSync(templatePath, "utf8");

  const base = "http://127.0.0.1:3000";
  const language = req.body.language || "nepali";

  const DATE_LABEL = language === "english" ? "Date:" : "मिति:-";
  const SUBJECT_LABEL = language === "english" ? "Subject:" : "विषय:-";
  const SALUTATION = language === "english" ? "Dear" : "श्रीमान्";

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
    SIGN_TITLE: escapeHtml(req.body.signtitle || "")
  };

  const html = template.replace(/{{(\w+)}}/g, (_, key) => data[key] || "");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve, reject) => {
                img.addEventListener("load", resolve);
                img.addEventListener("error", reject);
              })
        )
      );
    });

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true
    });

    const pdfBuffer = Buffer.from(pdfBytes);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="notice.pdf"');
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err) {
    console.error(err);
    return res.status(500).send("PDF generation failed. Check terminal logs.");
  } finally {
    await browser.close();
  }
});

app.listen(3000, () => {
  console.log("🚀 Server running at http://127.0.0.1:3000");
});