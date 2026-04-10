const express = require("express");
const router = express.Router();
const ThemeSettingsController = require("../controllers/themesettings");
const multer = require("multer");

const upload = multer({ storage: multer.memoryStorage() });

// Get theme settings
router.get("/", ThemeSettingsController.getThemeSettings);

// Update or create theme settings
router.post("/", ThemeSettingsController.updateThemeSettings);

// Upload logo
router.post(
  "/upload-logo",
  upload.single("logo"),
  ThemeSettingsController.uploadLogo
);

// Upload resource image (expects "resource" file + "key" in body)
router.post(
  "/upload-resource",
  upload.single("resource"),
  ThemeSettingsController.uploadResourceImage
);
router.get("/translations", ThemeSettingsController.getTranslations);
router.post("/translations", ThemeSettingsController.syncTranslations);
module.exports = router;
