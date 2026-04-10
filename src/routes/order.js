const orderController = require("../controllers/orders");
const express = require("express");
const orderRouter = express.Router();

orderRouter.route("/:userId").post(orderController.addOrder);
orderRouter
  .route("/:orderId")
  .get(orderController.getOrderById)
  .put(orderController.updateOrderById)
  .delete(orderController.deleteProductById);

orderRouter.route("/").get(orderController.getAllOrders);

orderRouter
  .route("/dashboard/orders")
  .get(orderController.getDashboardOrdersAdmin);

orderRouter
  .route("/dashboard/orders/best-seller/chart")
  .get(orderController.bestSellerProductChart);

// add route to dispute order or get order dispute
orderRouter
  .route("/dispute/:orderId")
  .post(orderController.disputeOrder)
  .put(orderController.updateOrderDispute)
  .get(orderController.getOrderDispute);
orderRouter.get("/shipments/metrics/:userId", orderController.getShipmentMetrics);
orderRouter.get("/metrics/:userId", orderController.getOrderMetrics);
orderRouter.post("/bundle/orders", orderController.bundleOrders);
orderRouter.post("/unbundle/orders", orderController.unbundleOrders);
orderRouter.get("/all/disputes", orderController.getDisputes);
orderRouter.post("/close/dispute/:id", orderController.closeDispute);
orderRouter.put("/refund/order/transaction/:id", orderController.refundOrder);
orderRouter.post("/cancel/order", orderController.cancelOrder);
orderRouter.put("/rejectorder/order", orderController.rejectOrderCancellation);
orderRouter.get("/items/all", orderController.getItems);
orderRouter.get("/stats/all", orderController.orderStats);
orderRouter.get("/retrypayment/:orderid", orderController.retryPayment);
module.exports = orderRouter;
