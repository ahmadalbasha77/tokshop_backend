const assert = require("node:assert/strict");
const productModel = require("../src/models/product");
const productController = require("../src/controllers/products");

function createResponse() {
  return {
    body: null,
    json(body) {
      this.body = body;
      return this;
    },
    status() {
      return this;
    },
  };
}

const originalAggregate = productModel.aggregate;

void (async () => {
  try {
    const dataPipelines = [];
    const returnedProducts = [{ _id: "product-page-item" }];

    productModel.aggregate = async (pipeline) => {
      if (pipeline.some((stage) => stage.$count === "totalDoc")) {
        return [{ totalDoc: 2899 }];
      }

      dataPipelines.push(pipeline);
      return returnedProducts;
    };

    let res = createResponse();
    await productController.getProducts(
      { query: { page: "1", limit: "10" } },
      res
    );

    assert.deepEqual(res.body, {
      products: returnedProducts,
      totalDoc: 2899,
      limits: 10,
      currentPage: 1,
      totalPages: 290,
    });
    assert.equal(Object.hasOwn(res.body, "pages"), false);
    assert.deepEqual(
      dataPipelines[0].find((stage) => Object.hasOwn(stage, "$skip")),
      { $skip: 0 }
    );
    assert.deepEqual(
      dataPipelines[0].find((stage) => Object.hasOwn(stage, "$limit")),
      { $limit: 10 }
    );

    res = createResponse();
    await productController.getProducts(
      { query: { page: "2", limit: "10" } },
      res
    );

    assert.equal(res.body.currentPage, 2);
    assert.equal(res.body.totalPages, 290);
    assert.deepEqual(
      dataPipelines[1].find((stage) => Object.hasOwn(stage, "$skip")),
      { $skip: 10 }
    );

    console.log("product pagination tests passed");
  } finally {
    productModel.aggregate = originalAggregate;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
