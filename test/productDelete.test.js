const assert = require("node:assert/strict");
const productModel = require("../src/models/product");
const productController = require("../src/controllers/products");

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(productId) {
  const res = createResponse();
  await productController.deleteProductById({ params: { productId } }, res);
  return res;
}

const originalFindByIdAndDelete = productModel.findByIdAndDelete;

void (async () => {
  try {
    let receivedId;
    const existingId = "6a51f3730f93db3a64d6cbe8";
    const deletedProduct = { _id: existingId, name: "Test product" };

    productModel.findByIdAndDelete = async (productId) => {
      receivedId = productId;
      return deletedProduct;
    };

    let res = await invoke(existingId);
    assert.equal(receivedId, existingId);
    assert.equal(typeof receivedId, "string");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true,
      message: "Product deleted successfully",
      data: deletedProduct,
    });

    let deleteCalled = false;
    productModel.findByIdAndDelete = async () => {
      deleteCalled = true;
      return null;
    };

    res = await invoke("invalid-id");
    assert.equal(deleteCalled, false);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
      success: false,
      message: "Invalid product ID",
    });

    res = await invoke("6a51f3730f93db3a64d6cbe9");
    assert.equal(deleteCalled, true);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, {
      success: false,
      message: "Product not found",
    });

    productModel.findByIdAndDelete = async () => {
      throw new Error("database unavailable");
    };

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      res = await invoke("6a51f3730f93db3a64d6cbea");
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, {
      success: false,
      message: "Failed to delete product",
      error: "database unavailable",
    });

    console.log("product delete tests passed");
  } finally {
    productModel.findByIdAndDelete = originalFindByIdAndDelete;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
