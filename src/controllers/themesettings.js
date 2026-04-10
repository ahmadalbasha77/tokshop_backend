const ThemeSettings = require("../models/themes");
const path = require('path');
const fs = require('fs').promises;
const Translation = require("../models/translations");
const AppSettingsSchema = require("../models/settings");
// Get theme settings (only one document expected)
exports.getThemeSettings = async (req, res) => {
  try {
    const settingsDoc = await ThemeSettings.findOne({});
    const appsettings = await AppSettingsSchema.findOne();

    if (!settingsDoc) {
      return res.status(404).json({ message: "Theme settings not found" });
    }

    const settings = settingsDoc.toObject(); // 🔑 IMPORTANT

    settings.demoMode = appsettings?.demoMode;
    settings.ios_link = appsettings?.ios_link;
    settings.android_link = appsettings?.android_link;
    settings.androidVersion = appsettings?.androidVersion;
    settings.iosVersion = appsettings?.iosVersion;

    res.status(200).json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// Create or update theme settings
exports.updateThemeSettings = async (req, res) => {
  try {
    const data = req.body;
    console.log(data);

    // Find the existing document
    let settings = await ThemeSettings.findOne({});
    if (!settings) {
      // Create new if not exists
      settings = new ThemeSettings(data);
    } else {
      // Update existing document
      Object.assign(settings, data);
    }

    await settings.save();
    res.status(200).json({
      message: "Theme settings updated successfully!",
      settings,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.uploadResourceImage = async (req, res) => {
  try {
    const { key } = req.body;
    console.log(req.body);

    if (!key) {
      return res.status(400).json({
        success: false,
        message: "Resource key is required"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No resource image file provided"
      });
    }

    // Create uploads directory
    const uploadsDir = path.join(__dirname, "../public/uploads/resources");
    await fs.mkdir(uploadsDir, { recursive: true });

    // Create unique filename
    const ext = path.extname(req.file.originalname);
    const filename = `resource-${key}-${Date.now()}${ext}`;
    const filePath = path.join(uploadsDir, filename);

    // Write file to local storage
    await fs.writeFile(filePath, req.file.buffer);

    const fileUrl = `/uploads/resources/${filename}`;

    // Update ThemeSettings: replace resource if key already exists, otherwise add new
    const settings = await ThemeSettings.findOne({}) || new ThemeSettings();

    // Remove existing entry with same key
    settings.resources = settings.resources.filter(r => r.key !== key);

    // Add new entry
    settings.resources.push({ key, url: fileUrl });

    await settings.save();

    return res.status(200).json({
      success: true,
      url: fileUrl,
      key,
      message: "Resource image uploaded successfully!",
      settings
    });

  } catch (error) {
    console.error("Resource upload error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload resource image",
      error: error.message
    });
  } 
};


exports.uploadLogo = async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No logo file provided'
      });
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(__dirname, '../public/uploads/logos');
    await fs.mkdir(uploadsDir, { recursive: true });

    // Generate unique filename
    const fileExtension = path.extname(req.file.originalname);
    const filename = `app-logo-${Date.now()}${fileExtension}`;
    const filePath = path.join(uploadsDir, filename);

    // Save file locally
    await fs.writeFile(filePath, req.file.buffer);

    // Generate public URL (adjust based on your domain)
    const logoUrl = `/uploads/logos/${filename}`;
    // Or use full URL: const logoUrl = `${req.protocol}://${req.get('host')}/uploads/logos/${filename}`;

    // Update app settings in database with the new logo URL
    await ThemeSettings.findOneAndUpdate(
      {},
      { app_logo: logoUrl },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      logo_url: logoUrl,
      message: 'Logo uploaded successfully'
    });

  } catch (error) {
    console.error('Logo upload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload logo',
      error: error.message
    });
  }
};
exports.syncTranslations = async (req, res) => {
  try {
    const incoming = req.body;
    console.log("🟢 Incoming default_language:", incoming?.default_language);

    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const { default_language = "en", ...translations } = incoming;
    console.log("🟡 Using default_language:", default_language);

    const languages = Object.keys(translations);
    const results = {};
    let latestVersion = 0;

    for (const lang of languages) {
      const langKeys = translations[lang];
      if (!langKeys || typeof langKeys !== "object") continue;

      console.log("🔹 Updating language:", lang);

      let record = await Translation.findOneAndUpdate(
        { language: lang },
        {
          $set: {
            keys: langKeys,
            default_language,
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        },
        { upsert: true, new: true }
      );

      console.log("✅ Saved:", record.language, "→", record.default_language);

      results[lang] = record.keys;
      latestVersion = Math.max(latestVersion, record.version);
    }

    res.status(200).json({
      success: true,
      version: latestVersion,
      default_language,
      translations: results,
    });
  } catch (err) {
    console.error("❌ Sync error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};



exports.getTranslations = async (req, res) => {
  try {
    const all = await Translation.find();
    const data = {};
    let latestVersion = 0;
    let default_language = "en";

    for (const doc of all) {
      data[doc.language] = Object.fromEntries(doc.keys);
      latestVersion = Math.max(latestVersion, doc.version);
      // Use the most recently updated document’s default language
      if (doc.default_language) {
        default_language = doc.default_language;
      }
    }

    res.status(200).json({
      success: true,
      version: latestVersion,
      default_language,
      translations: data,
    });
  } catch (err) {
    console.error("Get translations failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};


