const express = require("express");
const router = express.Router();
const shipping = require("../controllers/shipping");

router.get("/", shipping.getShipping);
router.post("/", shipping.addShipping);
router.put("/:id", shipping.updateUserShipping);
router.get("/user/:id", shipping.getUserShipping);
router.delete("/:id", shipping.deleteShipping);
router.put("/admin/:id", shipping.updateShipping);
router.get("/admin/:id", shipping.getShippingById);
router.post("/profiles/:id", shipping.createShippigProfile);
router.post("/general/profiles", shipping.createGeneralShippigProfile);
router.get("/general/profiles", shipping.getGeneralShippigProfile);
router.get("/profiles/:id", shipping.getShippingProfile);
//getUserShippingProfile
router.get("/profiles/user/:id", shipping.getUserShippingProfile);
router.put("/profiles/:id", shipping.updateShippingProfile);
router.delete("/profiles/:id", shipping.deleteShippingProfile);
router.get("/profiles/estimate/rates", shipping.getEstimatedShipping);
router.post("/profiles/buy/label", shipping.buyLabel);
router.post("/generate/manifest",shipping.generateUSPSScanForm)
router.get("/generate/manifest",shipping.getUSPSScanForm)
router.post("/webhook",shipping.webookShippo)
router.post("/refund/label/shippo",shipping.refundLabel)
module.exports = router;
 