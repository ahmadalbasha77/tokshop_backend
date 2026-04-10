const AppSettingsSchema = require("../models/settings");

exports.getAppSettings = async function (req, res) {
  try {
    const settings = await AppSettingsSchema.find();

    if (settings != null) {
      res.json(settings);
    } else {
      res.json(settings);
    }
  } catch (error) {
    res.status(404).send({ success: false, message: error });
  }
};
exports.getFirebaseSettings = async function (req, res) {
  try {
    const settings = await AppSettingsSchema.find();    
    if (settings != null) {
      res.json({
        firebase_api_key: settings[0].FIREBASE_API_KEY,
        firebase_auth_domain: settings[0].firebase_auth_domain,
        firebase_project_id: settings[0].firebase_project_id
      });
    } else {
      res.json(settings);
    }
  } catch (error) {
    res.status(404).send({ success: false, message: error });
  }
}

exports.saveAppSettings = async function (req, res) {
  const settings = await AppSettingsSchema.find();
  if (settings.length > 0) {
    req.body.default_email_provider = req.body?.email_service_provider;
    let settingsdata = await AppSettingsSchema.findByIdAndUpdate(
      { _id: settings[0]._id },
      { $set: req.body },
      { runValidators: true , new: true }
    );
    res.status(200).json(settingsdata);
  } else {
    let settingsdata = new AppSettingsSchema(req.body);
    let respo = await settingsdata.save();
    return res.status(200).json(respo);
  }
};