const category = require("../models/category");
require("../models/category");
const path = require("path");
const fs = require("fs");
const { default: mongoose } = require("mongoose");

exports.folowCategory = async function (req, res) {
  console.log(req.body);
  try {
    const categoryres = await category.findByIdAndUpdate(
      { _id: req.params.id },
      { $addToSet: { followers: req.body.userid } },
      { $inc: { followersCount: 1 } }
    );
    res.json(categoryres);
  } catch (error) {
    res.status(404).send(error);
  }
};
exports.unfolowCategory = async function (req, res) {
  try {
    const channel = await category.findByIdAndUpdate(
      { _id: req.params.id },
      { $pull: { followers: req.body.userid } },
      { $inc: { followersCount: -1 } }
    );
    res.json(channel);
  } catch (error) {
    res.status(404).send(error);
  }
};
//to be removed
exports.getCategories = async function (req, res) {
  try {
    const { title, page, limit, type } = req.query;
    let queryObject = {};
    if (title) {
      queryObject.name = { $regex: title, $options: "i" };
    }
    let sortOption = {};
    if (type === "a-z") {
      sortOption = { name: 1 }; // Ascending order
    } else if (type === "recommended") {
      sortOption = { followersCount: -1 }; // Assuming a recommended score
    } else if (type === "popular") {
      sortOption = { viewersCount: -1 }; // Sort by most views
    }
    const pages = Number(page);
    const limits = Number(limit);
    const skip = (pages - 1) * limits;
    const totalDoc = await category.countDocuments({
      ...queryObject,
      $or: [{ type: "parent" }, { type: { $exists: false } }, { type: null }],
    });
    const categories = await category
      .find({
        ...queryObject,
        $or: [{ type: "parent" }, { type: { $exists: false } }, { type: null }],
      })
      .populate("subCategories")
      .sort(sortOption)
      .skip(skip)
      .limit(limits);

    res.send({
      categories,
      totalDoc,
      limits,
      pages,
    });
  } catch (error) {
    console.log(error);
    res.status(404).send(error + " j");
  }
};

exports.updateCategory = async function (req, res) {
    console.log(req.body);
  try {
    const imageUrls = req.files.map((file) => {
      const ext = path.extname(file.originalname);
      const newFilename = `${req.params.id}${ext}`;

      // Absolute path to the desired save directory
      const categoryDir = path.resolve(__dirname, "../../images/category");

      // Ensure directory exists
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }

      // Full absolute path where the image will be saved
      const newPath = path.join(categoryDir, newFilename);

      // Overwrite (move and rename) uploaded file
      fs.renameSync(file.path, newPath);

      // Relative path saved to DB
      return `images/category/${newFilename}`;
    });

    let response = await category.findByIdAndUpdate(
      { _id: req.params.id },
      { $set: { ...req.body, icon: imageUrls[0], parent: req.body.category } },
      { new: true }
    ).populate("parent");
    console.log(response);

    // if parent category is the one being updated
    if(!req.body.category){
      await category.updateMany(
        { parent: req.params.id },
        { $set: { commission: response.commission , commission_enabled: response.commission_enabled} }
      );
    }
    if (req.body.category && mongoose.Types.ObjectId.isValid(req.body.category)) {
      let response = await category.findByIdAndUpdate(
        req.body.category, 
        { $addToSet: { subCategories: req.params.id  } },
        {new: true, upsert: true}
      );
      await category.updateMany(
        { parent: req.body.category },
        { $set: { commission: response.commission , commission_enabled: response.commission_enabled} }
      );
    }

    res.json("Updated category successfully");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to update category");
  }
};

exports.deleteCategory = async function (req, res) {
  try {
    await category.deleteOne({ _id: req.params.id });

    res.json("Successfuly deleted category");
  } catch (err) {
    res.status(404).send(err);
  }
};
exports.getCategory = async function (req, res) {
  try {
    const response = await category
      .findById(req.params.id)
      .populate("subCategories");
    res.json(response);
  } catch (err) {
    console.log(err);
    res.status(404).send(err);
  }
};
exports.getSubcategories = async (req, res) => {
  try {
    const { id } = req.params;
    let { page = 1, limit = 10 } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    // Find category and populate subcategories
    const cat = await category
      .findById(id)
      .populate({
        path: "subCategories",
        options: {
          skip: (page - 1) * limit,
          limit: limit,
        }, 
      })
      .exec(); 

    if (!cat) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Count total subcategories
    const totalSubcategories = await category.countDocuments({
      _id: { $in: cat.subCategories },
    });

    res.json({
      total: totalSubcategories,
      page,
      limit,
      data: cat.subCategories,
    });
  } catch (error) {
    console.error("Error fetching subcategories:", error);
    res.status(500).json({ message: "Server error" });
  }
};
exports.addCategory = async function (req, res) {
  console.log(req.body);
  try {
    let id = new mongoose.Types.ObjectId();

    const imageUrls = req.files.map((file) => {
      const ext = path.extname(file.originalname);
      const newFilename = `${id}${ext}`;
      const categoryDir = path.resolve(__dirname, "../../images/category");

      // Ensure directory exists
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
        console.log("✅ Created category directory");
      }

      // Full path to save image
      const newPath = path.join(categoryDir, newFilename);

      // Move and rename uploaded file
      fs.renameSync(file.path, newPath);

      // Relative path for saving in DB
      return `images/category/${newFilename}`;
    });

    // Create new category
    const ccc = new category({  
      _id: id,
      icon: imageUrls[0],
      parent: req.body.category,
      ...req.body, 
    });

    const results = await ccc.save();
    if (req.body.category && mongoose.Types.ObjectId.isValid(req.body.category)) {
      let parentcategory = await category.findByIdAndUpdate(
        req.body.category, 
        { $addToSet: { subCategories: id } },
        {new: true, upsert: true}
      );
      //update subcategory with the parent commission settings
      await category.updateMany(
        { parent: req.body.category },
        { $set: { commission: parentcategory.commission , commission_enabled: parentcategory.commission_enabled} }
      );
    } else {
      console.warn("Invalid or missing category ID:", req.body.category);
    }
    

    res.json({ success: true, data: results });
  } catch (err) {
    console.error("❌ Error saving category:", err);
    res.status(400).send({ success: false, message: err.message || err });
  }
};
exports.subcategoryBulk = async (req, res) => {
    const parentId = req.params.id;
    const subcategories= req.body;
  try {

    if (!parentId || !Array.isArray(subcategories)) {
      return res.status(400).json({ message: "Invalid input format" });
    }

    // Create ObjectIds for each subcategory before inserting
    const subsWithIds = subcategories.map((sub) => ({
      ...sub,
      _id: new mongoose.Types.ObjectId(),
      type: "child"
    }));

    // Insert them
    const createdSubs = await category.insertMany(subsWithIds);

    // Collect their IDs
    const subIds = createdSubs.map((sub) => sub._id);

    // Update the parent category with all new subcategories
    await category.findByIdAndUpdate(
      parentId,
      { $addToSet: { subCategories: { $each: subIds } } }
    );

    res.status(200).json({
      success: true,
      parentId,
      added: createdSubs.length,
      subcategories: createdSubs
    });
  } catch (error) {
    console.error("Error in subcategoryBulk:", error);
    res.status(422).json({ success: false, message: error.message });
  }
};

exports.addCategoriesBulk = async (req, res) => {
  try {
    let response = await category.insertMany(req.body);
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json(response);
  } catch (error) {
    console.log(error)
    res
      .status(422) 
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
