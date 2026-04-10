const express = require("express");
const router = express.Router();
const category = require("../controllers/category");
const multer = require("multer");

// Multer setup
const storage = multer.diskStorage({
  destination: "./images/category/",
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({ storage });

router.get("/", category.getCategories);
router.get("/:id", category.getCategory);
router.post("/", upload.array("images", 5), category.addCategory);
router.put("/:id", upload.array("images", 5), category.updateCategory);
router.put("/follow/:id", category.folowCategory);
router.put("/unfollow/:id", category.unfolowCategory);
router.delete("/:id", category.deleteCategory);
router.get("/subcategory/:id", category.getSubcategories);
router.post("/bulk/add", category.addCategoriesBulk);
router.post("/subcategory/bulk/:id", category.subcategoryBulk);

module.exports = router;
