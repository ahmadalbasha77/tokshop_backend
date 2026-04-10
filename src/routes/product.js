const express = require("express");
const productRouter = express.Router();
const productController = require("../controllers/products");



const passport = require("passport");

require("../services/authenticate");

productRouter
  .route("/:useId")
  .post(
    passport.authenticate("jwt", { session: false }),
    productController.addProduct
  );

productRouter
  .route("/products/:productId")
  .get(productController.getProductById)
  .put(
    passport.authenticate("jwt", { session: false }),
    productController.updateProductById
  )
  .delete(
    passport.authenticate("jwt", { session: false }),
    productController.deleteProductById
  );

productRouter
  .route("/images/:productId")
  .put(
    passport.authenticate("jwt", { session: false }),
    productController.updateProductImages
  );

productRouter
  .route("/product/product/qtycheck/:productId")
  .post(productController.productQtyCheck);

productRouter.route("/").get(productController.getProducts);

productRouter.route("/review/:id").post(productController.addProductReview);
productRouter.route("/review/:id").get(productController.getProductReviews);
productRouter.route("/update").put(productController.updateManyProducts); 
productRouter
  .route("/review/:userId/:id")
  .get(productController.getProductReviewsByUserId);
productRouter
  .route("/review/delete/review/:id")
  .delete(productController.deleteProductReviewsById);
productRouter
  .route("/favorite/:userId")
  .delete(productController.removeFavorite);
productRouter.route("/favorite/:userId").post(productController.createFavorite);
productRouter.route("/favorite/:userId").get(productController.getFavorites);
productRouter.route("/deletemany").delete(productController.deleteManyProductByIds);
productRouter.route("/products/bulkadd").post(productController.bulkAddProduct);
productRouter.route("/products/bulkedit/all").put(productController.bulkUpdateProduct)
productRouter.route("/search").get(productController.searchAll);
 
module.exports = productRouter;
