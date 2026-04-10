const adminModel = require("../models/admin");
const userModel = require("../models/user");
const jwt = require("jsonwebtoken");
const AppSettingsSchema = require("../models/settings");
const { generateSystemTokenOnce } = require("../shared/apiToken");

// POST /admin/impersonate

exports.getAllAdmins = async function (req, res) {
  try {
    const admins = await adminModel.find();
    res.json({ success: true, admin: admins });
  } catch (error) {
    res.status(404).send({ success: false, message: error });
  }
};

exports.getAdminById = async function (req, res) {
  try {
    const admin = await adminModel.findOne({ role: "admin" });
    res.json({ success: true, admin: admin });
  } catch (error) {
    res.status(404).send({ success: false, message: error });
  }
};

// Helper (not exported)
async function adminWithRoleExists(role = "admin") {
  return await adminModel.exists({ role });
}

// Endpoint to check if an admin with role "admin" exists
exports.checkAdminRoleExists = async (req, res) => {
  try {
    const { role = "admin" } = req.body; // or req.query.role if using GET

    const exists = await adminWithRoleExists(role);

    res.status(200).json({
      success: true,
      exists: !!exists,
      message: exists
        ? `An admin with role "${role}" already exists.`
        : `No admin with role "${role}" found.`,
    });
  } catch (error) {
    console.error("Error checking admin role:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message,
    });
  }
};



exports.registerAdmin = async (req, res) => {
  try {
    const {
      email,
      role = "admin",
      password,
      username,
      full_name,
    } = req.body;

    const existingAdmin = await adminModel.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: `User with email ${email} already exists.`,
      });
    }


    const newAdmin = new adminModel({
      email,
      role,
      password,
      username,
      full_name
    });

    newAdmin.setPassword(password);
    await newAdmin.save();

    return res.status(201).json({
      success: true,
      message:  "Admin registered successfully."});

  } catch (error) {
    console.error("Error registering admin:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};



exports.saveAdmin = async (req, res) => {
  try {
    const { email, role, password, username, full_name } = req.body;

    // Check if user already exists
    const existingAdmin = await adminModel.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: `User with email ${email} already exists.`,
      });
    }

    // Create new admin
    const newAdmin = new adminModel({
      email,
      role,
      username: username || "admin",
      full_name: full_name || "Super Admin",
    });

    // Set password hash
    newAdmin.setPassword(password);

    await newAdmin.save();

    res.status(201).json({
      success: true,
      message: `Admin with email ${email} successfully saved.`,
    });
  } catch (error) {
    console.error("Error saving admin:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message,
    });
  }
};

exports.logInAdmin = async function (req, res) {
  console.log(req.body);
  try {
    const user = await adminModel.findOne({ email: req.body.email });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found.",
      });
    }

    if (!user.validPassword(req.body.password)) {
      return res.status(400).json({
        success: false,
        message: "Wrong password",
      });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.role,
        type: "admin",
      },
      process.env.secret_key,
      { expiresIn: "24h" }
    );

    return res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        email: user.email,
        role: user.role,
      },
      accesstoken: token,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


exports.updateAdmin = async function (req, res) {
  console.log(req.body)
  try {
    if (req.body.password && req.body.password !== "") {
      let newUser = new adminModel();
      newUser.setPassword(req.body.password);
      // ✅ Use hash and salt instead of password
      req.body.hash = newUser.hash;
      req.body.salt = newUser.salt;
      delete req.body.password;  // Remove password field
    }
    await adminModel.updateOne({ _id: req.params.id }, { $set: req.body });
    res.json({ success: true, message: "Successfully updated" });
  } catch (error) {
    res.status(404).send({ success: false, message: error });
  }
};

exports.deleteAdmin = async function (req, res) {
  try {
    await adminModel.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: "Successfully deleted" });
  } catch (error) {
    res.status(404).send({ success: false, message: error });
  }
};
