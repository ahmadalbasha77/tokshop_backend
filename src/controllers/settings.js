const AppSettingsSchema = require("../models/settings");

const SETTINGS_QUERY_TIMEOUT_MS = 10000;
const BUILD_NUMBER_PATTERN = /^\d+$/;
const PUBLIC_APP_UPDATE_FIELDS =
  "forceUpdate androidBuildNumber iosBuildNumber androidVersion iosVersion android_link ios_link";
const SETTINGS_UPDATE_FIELDS = new Set(
  Object.keys(AppSettingsSchema.schema.paths).filter(
    (field) => !["_id", "__v"].includes(field)
  )
);

function normalizeBuildNumber(value) {
  const buildNumber = String(value ?? "").trim();
  return BUILD_NUMBER_PATTERN.test(buildNumber) ? buildNumber : "0";
}

function resolveBuildNumber(dedicatedBuildNumber, legacyVersion) {
  const buildNumber = normalizeBuildNumber(dedicatedBuildNumber);
  return buildNumber !== "0"
    ? buildNumber
    : normalizeBuildNumber(legacyVersion);
}

function getPublicAppUpdate(settings) {
  const data =
    settings && typeof settings.toObject === "function"
      ? settings.toObject()
      : { ...(settings || {}) };

  return {
    forceUpdate: data.forceUpdate === true,
    androidVersion: resolveBuildNumber(
      data.androidBuildNumber,
      data.androidVersion
    ),
    iosVersion: resolveBuildNumber(data.iosBuildNumber, data.iosVersion),
    android_link:
      typeof data.android_link === "string" ? data.android_link : "",
    ios_link: typeof data.ios_link === "string" ? data.ios_link : "",
  };
}

function getAllowedUpdates(body) {
  return Object.fromEntries(
    Object.entries(body || {}).filter(
      ([field, value]) =>
        SETTINGS_UPDATE_FIELDS.has(field) && value !== undefined
    )
  );
}

function getErrorResponse(error) {
  if (error?.name === "ValidationError" || error?.name === "CastError") {
    return {
      status: 400,
      message: "Invalid settings data",
    };
  }

  if (
    error?.code === 50 ||
    error?.name === "MongoServerSelectionError" ||
    error?.name === "MongoNetworkTimeoutError"
  ) {
    return {
      status: 504,
      message: "Settings database request timed out",
    };
  }

  return {
    status: 500,
    message: "Failed to process app settings",
  };
}

exports.getAppSettings = async function (req, res) {
  try {
    const settings = await AppSettingsSchema.find().maxTimeMS(
      SETTINGS_QUERY_TIMEOUT_MS
    );
    return res.status(200).json(settings);
  } catch (error) {
    const response = getErrorResponse(error);
    console.error("Error fetching app settings:", error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};

exports.getPublicAppUpdate = async function (req, res) {
  try {
    const settings = await AppSettingsSchema.findOne()
      .select(PUBLIC_APP_UPDATE_FIELDS)
      .maxTimeMS(SETTINGS_QUERY_TIMEOUT_MS);
    res.set("Cache-Control", "no-store");
    return res.status(200).json([getPublicAppUpdate(settings)]);
  } catch (error) {
    const response = getErrorResponse(error);
    console.error("Error fetching public app update settings:", error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};
exports.getFirebaseSettings = async function (req, res) {
  try {
    const settings = await AppSettingsSchema.findOne()
      .select("FIREBASE_API_KEY firebase_auth_domain firebase_project_id")
      .maxTimeMS(SETTINGS_QUERY_TIMEOUT_MS);

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: "App settings not found",
      });
    }

    return res.status(200).json({
      firebase_api_key: settings.FIREBASE_API_KEY,
      firebase_auth_domain: settings.firebase_auth_domain,
      firebase_project_id: settings.firebase_project_id,
    });
  } catch (error) {
    const response = getErrorResponse(error);
    console.error("Error fetching Firebase settings:", error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};

exports.saveAppSettings = async function (req, res) {
  try {
    const updates = getAllowedUpdates(req.body);

    if (Object.prototype.hasOwnProperty.call(updates, "email_service_provider")) {
      updates.default_email_provider = updates.email_service_provider;
    }

    const settings = await AppSettingsSchema.findOneAndUpdate(
      {},
      { $set: updates },
      {
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        upsert: true,
        maxTimeMS: SETTINGS_QUERY_TIMEOUT_MS,
      }
    );

    return res.status(200).json(settings);
  } catch (error) {
    const response = getErrorResponse(error);
    console.error("Error saving app settings:", error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};
