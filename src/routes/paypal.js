const router = require("express").Router();
const paypalController = require("../controllers/paypal.controller");
router.post("/connect", paypalController.connectPaypal);
router.post("/confirm", paypalController.confirmPaypal);

module.exports = router;
