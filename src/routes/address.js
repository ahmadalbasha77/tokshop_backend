const express = require("express");
const addressController = require("../controllers/address");
const addressRouter = express.Router();

addressRouter
  .route("/:addressId")
  .get(addressController.getAddressById)
  .put(addressController.updateAddressById)
  .patch(addressController.makeAddressPrimary)
  .delete(addressController.deleteAddressById);
addressRouter.route("/").post(addressController.addAddress);
addressRouter
  .route("/default/address/:userId")
  .get(addressController.getDefaultAddressByUserId);
addressRouter.route("/all/:userId").get(addressController.getAddressByUserId);
addressRouter.route("/validate").post(addressController.validateAddress);
module.exports = addressRouter;
