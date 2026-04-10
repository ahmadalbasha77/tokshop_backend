var productModel = require("../models/product");
const userModel = require("../models/user");
const metasettings = require("../models/meta_settings");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const connect = require("../services/dbConnect");
const ENV_PATH = path.join(__dirname, "..", "..", ".env");
const adminModel = require("../models/admin");

exports.removeSettings = async (req, res) => {
  try {
    let { user, key } = req.query;
    console.log("removeSettings ", req.query);
    let response = await metasettings.findOneAndUpdate(
      { user, key },
      {
        settings: null,
      }
    );
    return res.json(response);
  } catch (e) {
    console.log(e);
  }
};
function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}
exports.updateSettings = async (req, res) => {
  try {
    const { user, key, auto_sync_products, auto_sync_orders } = req.query;
    console.log("updateSettings", req.query);

    // Find the existing settings document
    let existing = await metasettings.findOne({ user, key });

    if (!existing) {
      return res.status(404).json({ message: "Settings not found" });
    }

    const currentSettings = existing.settings || {};
    console.log(parseBool(auto_sync_products));
    // Merge new values from req.body into the existing settings
    const updatedSettings = {
      ...currentSettings,
      ...(req.body.consumer_key && { wcConsumerKey: req.body.consumer_key }),
      ...(req.body.consumer_secret && {
        wcSecretKey: req.body.consumer_secret,
      }),
      ...(req.body.site_url && { wcUrl: req.body.site_url }),
      ...(auto_sync_orders !== undefined && {
        auto_sync_orders: parseBool(auto_sync_orders),
      }),
      ...(req.body.site_name && { site_name: req.body.site_name }),
      ...(auto_sync_products !== undefined && {
        auto_sync_products: parseBool(auto_sync_products),
      }),
    };
    console.log(updatedSettings);
    // Update only the settings field
    const updated = await metasettings.findOneAndUpdate(
      { user, key },
      { $set: { settings: updatedSettings } },
      { new: true }
    );

    const response = await axios.post(
      `${currentSettings["wcUrl"]}/wp-json/tokshop/v1/update-settings`,
      {
        auto_sync_products: parseBool(auto_sync_products) == true ? 1 : 0,
        auto_sync_orders: parseBool(auto_sync_orders) == true ? 1 : 0,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "wc-consumer-key": currentSettings["wcConsumerKey"],
          "wc-consumer-secret": currentSettings["wcSecretKey"],
        },
      }
    );
    console.log(response);

    return res.json(updated.toObject());
  } catch (e) {
    console.error("Error in updateSettings:", e);
    return res.status(500).json({ error: "Something went wrong" });
  }
};

exports.getMetaSettings = async (req, res) => {
  let { user, key } = req.query;
  let response = await metasettings.findOne({ user, key });
  const count = await productModel.countDocuments({
    deleted: false,
    ownerId: user,
    wcid: { $ne: null },
  });
  if (response) {
    let data = response.toObject(); // convert Mongoose doc to plain object

    // Add count inside settings
    data.settings = {
      ...data.settings,
      tokshopCount: count,
    };

    return res.json(data);
  }
  return res.json({ settings: null });
};
exports.importWcKeys = async (req, res) => {
  console.log(req.body);
  //save to user
  if (req.body.id == null || req.body.id == "") {
    return res.status(400).json({ success: false, message: "id is required" });
  }
  let user = await metasettings.findOneAndUpdate(
    { user: req.body.id, key: "wc" },
    {
      settings: {
        wcConsumerKey: req.body.consumer_key,
        wcSecretKey: req.body.consumer_secret,
        wcUrl: req.body.site_url,
        auto_sync_orders: req.body.auto_sync_orders,
        site_name: req.body.site_name,
        auto_sync_products: req.body.auto_sync_products,
      },
    },
    { new: true, upsert: true }
  );
  if (!user) {
    return res.status(400).json({ success: false, message: "user not found" });
  }
  return res
    .status(200)
    .json({ success: true, message: "success", user_id: user._id });
};
exports.adjustQuantity = async (req, res) => {
  console.log(req.body);
  let items = req.body.items;
  // reduce the quatity of the product
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    await productModel.findOneAndUpdate(
      { wcid: item.product_id },
      {
        $inc: { quantity: -item.quantity },
      }
    );
  }
};
exports.importProducts = async (req, res) => {
  console.log(req.body);
  let userid = req.params.id;
  //save to user
  if (!userid) {
    return res
      .status(400)
      .json({ success: false, message: "userid is required" });
  }
  let products = req.body.products;
  if (products.length == 0) {
    return res.status(400).json({ success: false, message: "no products" });
  }
  let user = await userModel.findById(userid);
  if (!user) {
    return res.status(400).json({ success: false, message: "user not found" });
  }

  let productsArray = [];
  for (let i = 0; i < products.length; i++) {
    let product = products[i];
    if (product.name == null || product.name == "") {
      return res
        .status(400)
        .json({ success: false, message: "product name is required" });
    }
    productsArray.push(product);
  }
  console.log(productsArray);
  // return productsArray;
  // use promise all to create products, keep count of produts imported but use promise all
  let imported = 0;
  let failed = 0;
  let failedProducts = [];

  let promises = productsArray.map(async (product) => {
    try {
      // Extract images
      let images = [];
      product?.images?.forEach((element) => {
        images.push(element.src);
      });
      if (images.length == 0) {
        images.push(product.featured_image);
      }

      // Upsert the product (create if it doesn't exist, update if it does)
      await productModel.findOneAndUpdate(
        { wcid: product.id }, // Condition to check if the product exists
        {
          name: product.name,
          price: product.price,
          description: product.description,
          images: images,
          ownerId: userid,
          quantity: product.stock == null ? 0 : product.stock,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      imported++; // Increment success count
    } catch (error) {
      failed++; // Increment failure count
      failedProducts.push({ product, error: error.message });
    }
  });

  // Wait for all promises to resolve
  await Promise.all(promises);
  return res.status(200).json({
    success: true,
    message: "success",
    user_id: userid,
    imported: imported,
    failed: failed,
    failedProducts: failedProducts,
  });
};

// Function to fetch paginated WooCommerce products
async function fetchProducts(page = 1, perPage = 50, id) {
  try {
    let settingsmeta = await metasettings.findOne({ user: id, key: "wc" });
    console.log("settingsmeta ", settingsmeta?.settings["wcConsumerKey"]);
    const response = await axios.get(
      settingsmeta?.settings["wcUrl"] +
        "/wp-json/wc/v3/products?status=publish",
      {
        params: {
          consumer_key: settingsmeta?.settings["wcConsumerKey"],
          consumer_secret: settingsmeta?.settings["wcSecretKey"],
          per_page: perPage,
          page: page,
        },
      }
    );

    const totalPages = parseInt(response.headers["x-wp-totalpages"], 10) || 1;
    return { products: response.data, totalPages };
  } catch (error) {
    console.error(`Error fetching page ${page}:`, error.message);
    return { products: [], totalPages: 1 };
  }
}

// Function to upsert products into the database
async function saveProducts(products, userid) {
  try {
    const operations = products.map((product) => {
      const images = product?.images?.map((img) => img.src) || [];
      if (images.length === 0 && product.featured_image) {
        images.push(product.featured_image);
      }
      console.log(product);
      return productModel.findOneAndUpdate(
        { wcid: product.id }, // Find by WooCommerce ID
        {
          name: product.name,
          price: product.price,
          description: product.description,
          images: images,
          ownerId: userid,
          quantity: product.stock_quantity ?? 0, // If stock is null, default to 0
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    });

    // Execute database writes in parallel (within a batch)
    await Promise.all(operations);
    console.log(`✅ Saved ${products.length} products.`);
  } catch (error) {
    console.error("❌ Error saving products:", error.message);
  }
}

// Function to fetch and save products in batches
exports.fetchAndSaveWcProducts = async (req, res) => {
  console.log(req.body);
  let { userid, perPage = 50 } = req.body;
  let page = 1;
  let totalPages = 1;
  let allroducts = [];
  do {
    console.log(`🔄 Fetching page ${page} of ${totalPages}...`);
    const { products, totalPages: fetchedTotalPages } = await fetchProducts(
      page,
      perPage,
      userid
    );
    allroducts = products;
    if (products.length > 0) {
      await saveProducts(products, userid); // Save each batch before moving to next
    }

    totalPages = fetchedTotalPages; // Update total pages dynamically
    page++;
  } while (page <= totalPages);

  console.log("🎉 All products fetched and saved!");

  return res.json({ count: allroducts.length });
};
exports.setup = async (req, res) => {
  console.log(req.body);
  const { email, password } = req.body;
  let newUser = new adminModel();
  newUser.email = email;
  newUser.role = "admin";
  newUser.setPassword(password);
  const admin = await adminModel.find();
  if (admin.length == 0) {
    newUser.save();
  }

  res.json({ success: true });
};
exports.setupRequired = async (req, res) => {
  const envExists = fs.existsSync(ENV_PATH);
  let hasMongoUri = false;

  if (envExists) {
    const content = fs.readFileSync(ENV_PATH, "utf-8");
    hasMongoUri = content.includes("MONGO_URI=");
  }

  if (hasMongoUri) {
    // check if user with role admin exists
    const admin = await adminModel.findOne({ role: "admin" });
    if (admin == null) {
      return res.json({ required: true });
    }
  }

  res.json({ required: !hasMongoUri });
};
exports.importShopifyProducts = async (req, res) => {
  try {
    if (req.body.userId) {
      var shopData = await shopSchema.findOne({ userId: req.body.userId });
      if (shopData) {
        if (req.body.type == "update") {
          var products = await fetchShopifyProducts(shopData, "update");
          var shopifyIDs = await importShopifyProductsToDb(
            products,
            req.body.type,
            req.body.userId,
            shopData
          );
          res.json({
            status: true,
            message: `Shopify ${shopifyIDs.length} products updated successfully`,
            count: shopifyIDs.length,
            alert: false,
          });
        } else if (req.body.type == "import" || req.body.type == "check") {
          var products = await fetchShopifyProducts(shopData, "import");

          var shopifyIDs = await importShopifyProductsToDb(
            products,
            req.body.type,
            req.body.userId,
            shopData
          );
          res.json({
            status: true,
            message: `Shopify ${shopifyIDs.length} products imported successfully`,
            count: shopifyIDs.length,
            alert: false,
          });
        }
      }
    } else {
      res.json({ status: false, message: "user id is required" });
    }
  } catch (error) {
    res.json({ status: false, message: error.message });
  }
};
