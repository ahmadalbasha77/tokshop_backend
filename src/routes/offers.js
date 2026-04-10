const express = require("express");
const {
  addOffer,
  counterOffer,
  acceptOffer,
  rejectOffer,
  listProductsWithOffers,cancelOffer,offerById
} = require("../controllers/offers.js");

const router = express.Router();

router.post("/", addOffer);
router.post("/counter", counterOffer);
router.post("/accept", acceptOffer);
router.post("/cancel", cancelOffer);
router.post("/reject", rejectOffer);
router.get("/", listProductsWithOffers);
router.get("/:id", offerById)

module.exports = router;