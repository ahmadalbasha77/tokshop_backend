const { getFirestore } = require('firebase-admin/firestore');

const COLLECTION_NAME = "app_content";

// Page type to document ID mapping
const pageDocIds = {
  landing: "landing",
  faq: "faq",
  about: "about",
  privacy: "privacy",
  terms: "terms",
  contact: "contact"
};

// Valid page types
const validPageTypes = ["landing", "faq", "about", "privacy", "terms", "contact"];

// GET content
exports.getContent = async (req, res) => {
  try {
    const { pageType } = req.params;

    // Validate page type
    if (!validPageTypes.includes(pageType)) {
      return res.status(404).json({
        success: false,
        message: "Page not found",
      });
    }

    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(pageDocIds[pageType]);
    const doc = await docRef.get();

    if (doc.exists) {
      return res.json({
        success: true,
        data: doc.data(),
      });
    }
    
    // Return empty object if not found
    res.json({
      success: true,
      data: {},
    });
  } catch (error) {
    console.error(`Error fetching ${req.params.pageType} content:`, error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch content",
      error: error.message,
    });
  }
};

// PUT (update) content
exports.updateContent = async (req, res) => {
  try {
    const { pageType } = req.params;

    // Validate page type
    if (!validPageTypes.includes(pageType)) {
      return res.status(404).json({
        success: false,
        message: "Page not found",
      });
    }

    const contentData = req.body;

    // Save to Firestore
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(pageDocIds[pageType]);
    await docRef.set(contentData);

    res.json({
      success: true,
      message: `${pageType} content updated successfully`,
      data: contentData,
    });
  } catch (error) {
    console.error(`Error updating ${req.params.pageType} content:`, error);
    res.status(500).json({
      success: false,
      message: "Failed to update content",
      error: error.message,
    });
  }
};

// POST reset content
exports.resetContent = async (req, res) => {
  try {
    const { pageType } = req.params;

    // Validate page type
    if (!validPageTypes.includes(pageType)) {
      return res.status(404).json({
        success: false,
        message: "Page not found",
      });
    }

    // Check admin auth (adjust based on your auth system)
    // if (!req.user || !req.user.admin) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "Admin access required",
    //   });
    // }

    // Delete the document to reset to defaults
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(pageDocIds[pageType]);
    await docRef.delete();

    res.json({
      success: true,
      message: `${pageType} content reset to defaults`,
      data: {},
    });
  } catch (error) {
    console.error(`Error resetting ${req.params.pageType} content:`, error);
    res.status(500).json({
      success: false,
      message: "Failed to reset content",
      error: error.message,
    });
  }
};