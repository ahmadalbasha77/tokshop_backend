const express = require("express");
const router = express.Router();
const category = require("../controllers/category");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const CATEGORY_IMAGE_MAX_SIZE_MB = 10;
const CATEGORY_IMAGE_MAX_SIZE_BYTES = CATEGORY_IMAGE_MAX_SIZE_MB * 1024 * 1024;
const CATEGORY_IMAGE_MAX_COUNT = 5;
const CATEGORY_IMAGE_FIELD = "images";

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const categoryDir = path.resolve(__dirname, "../../images/category");
    fs.mkdirSync(categoryDir, { recursive: true });
    cb(null, categoryDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({
  storage,
  limits: {
    fileSize: CATEGORY_IMAGE_MAX_SIZE_BYTES,
    files: CATEGORY_IMAGE_MAX_COUNT,
  },
});

function uploadCategoryImages(req, res, next) {
  upload.array(CATEGORY_IMAGE_FIELD, CATEGORY_IMAGE_MAX_COUNT)(
    req,
    res,
    (err) => {
      if (!err) {
        return next();
      }

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            error: `Image is too large. Max size is ${CATEGORY_IMAGE_MAX_SIZE_MB}MB.`,
          });
        }

        if (err.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({
            error: `Too many images. Max is ${CATEGORY_IMAGE_MAX_COUNT}.`,
          });
        }

        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({
            error: `Invalid file field. Use "${CATEGORY_IMAGE_FIELD}".`,
          });
        }

        return res.status(400).json({ error: err.message });
      }

      return next(err);
    }
  );
}

router.get("/", category.getCategories);
router.get("/:id", category.getCategory);
router.post("/", uploadCategoryImages, category.addCategory);
router.put("/:id", uploadCategoryImages, category.updateCategory);
router.put("/follow/:id", category.folowCategory);
router.put("/unfollow/:id", category.unfolowCategory);
router.delete("/:id", category.deleteCategory);
router.get("/subcategory/:id", category.getSubcategories);
router.post("/bulk/add", category.addCategoriesBulk);
router.post("/subcategory/bulk/:id", category.subcategoryBulk);

module.exports = router;
