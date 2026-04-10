const stripeController = require("../controllers/stripe");
const express = require("express");
const stripeRouter = express.Router();
stripeRouter
  .route("/payouts/:userId")
  .post(stripeController.stripePayoutPayments);
stripeRouter.route("/connect/:id").post(stripeController.connect);
stripeRouter
  .route("/transactions/:userId")
  .get(stripeController.payoutTransactions);
stripeRouter
  .route("/transactions/all/payouts")
  .get(stripeController.allPayoutTransactions);
stripeRouter.route("/banks/:userId").get(stripeController.getStripeBankAccount);
stripeRouter.route("/setupitent").post(stripeController.setupIntent);
stripeRouter
  .route("/savepaymentmethod")
  .post(stripeController.savepaymentmethod);

stripeRouter.route("/tax/estimate").post(stripeController.getTaxEstimate);
stripeRouter.route("/default").put(stripeController.setDefaultPaymentMethod);
stripeRouter.route("/remove").delete(stripeController.deletePaymentMethod);
stripeRouter.route("/application/fees").get(stripeController.appfees);
stripeRouter.route("/refunds/list/all").get(stripeController.getRefunds);
stripeRouter.route("/default/paymentmethod/default/:id").get(stripeController.getdefaultPaymetmethod);
stripeRouter.route("/revenue").get(stripeController.getRevenue);
stripeRouter.route("/transfer").post(stripeController.stripeTransfer);
module.exports = stripeRouter;
