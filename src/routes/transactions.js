const express = require("express");
const transRouter = express.Router();
const transController = require("../controllers/transactions");

transRouter.route(`/`).post(transController.createTransaction);

transRouter.route("/:userId").get(transController.getUserTransactionsByUserId);

transRouter.route("/").get(transController.getUserTransactions);

transRouter
  .route("/transactions/:transId")
  .get(transController.getTransactionById);

transRouter.route("/:transId").put(transController.updateTransactionById);

module.exports = transRouter;
