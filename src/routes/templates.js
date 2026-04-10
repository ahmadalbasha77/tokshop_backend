const express = require("express");
const router = express.Router();
const emailController = require("../controllers/templates");
router.post("/", emailController.createEmailTemplate);
router.get("/", emailController.getEmailTemplates);
router.get("/:id", emailController.getEmailTemplateById);
router.put("/:id", emailController.updateEmailTemplate);
router.delete("/:id", emailController.deleteEmailTemplate);
module.exports = router;