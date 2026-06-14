const assert = require("assert");
const path = require("path");

function mockModule(relativePath, exports) {
  const resolved = require.resolve(path.join(__dirname, relativePath));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
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

const schemaPaths = {
  _id: {},
  __v: {},
  forceUpdate: {},
  androidBuildNumber: {},
  iosBuildNumber: {},
  androidVersion: {},
  iosVersion: {},
  android_link: {},
  ios_link: {},
};

let storedSettings;
let selectedFields;
const settingsModel = {
  schema: { paths: schemaPaths },
  find() {
    return {
      maxTimeMS: async () => [storedSettings],
    };
  },
  findOne() {
    return {
      select(fields) {
        selectedFields = fields;
        return this;
      },
      maxTimeMS: async () => storedSettings,
    };
  },
};

mockModule("../src/models/settings", settingsModel);
const settingsController = require("../src/controllers/settings");

async function testPublicAppUpdateContract() {
  storedSettings = {
    forceUpdate: true,
    androidVersion: "1.0.5",
    iosVersion: "1.0.6",
    androidBuildNumber: "5",
    iosBuildNumber: "6",
    android_link: "https://play.google.com/store/apps/details?id=com.tokshop.liveApp",
    ios_link: "https://apps.apple.com/app/example",
  };

  const res = createResponse();
  await settingsController.getPublicAppUpdate({}, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(Array.isArray(res.body));
  assert.strictEqual(res.body.length, 1);
  assert.strictEqual(res.body[0].forceUpdate, true);
  assert.strictEqual(res.body[0].androidVersion, "5");
  assert.strictEqual(res.body[0].iosVersion, "6");
  assert.strictEqual(res.headers["Cache-Control"], "no-store");
  assert.strictEqual(
    selectedFields,
    "forceUpdate androidBuildNumber iosBuildNumber androidVersion iosVersion android_link ios_link"
  );
  assert.deepStrictEqual(Object.keys(res.body[0]).sort(), [
    "androidVersion",
    "android_link",
    "forceUpdate",
    "iosVersion",
    "ios_link",
  ]);
}

async function testAuthenticatedSettingsResponseRemainsUnchanged() {
  storedSettings = {
    forceUpdate: true,
    androidVersion: "1.0.5",
    iosVersion: "1.0.6",
    androidBuildNumber: "5",
    iosBuildNumber: "6",
  };

  const res = createResponse();
  await settingsController.getAppSettings({}, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, [storedSettings]);
}

async function testInvalidLegacyBuildNumbersAreSafe() {
  storedSettings = {
    forceUpdate: true,
    androidVersion: "1.0.4",
    iosVersion: null,
  };

  const res = createResponse();
  await settingsController.getPublicAppUpdate({}, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body[0].androidVersion, "0");
  assert.strictEqual(res.body[0].iosVersion, "0");
  assert.strictEqual(res.body[0].android_link, "");
  assert.strictEqual(res.body[0].ios_link, "");
}

async function testNumericLegacyVersionsRemainCompatible() {
  storedSettings = {
    forceUpdate: true,
    androidVersion: "7",
    iosVersion: "8",
  };

  const res = createResponse();
  await settingsController.getPublicAppUpdate({}, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body[0].androidVersion, "7");
  assert.strictEqual(res.body[0].iosVersion, "8");
}

async function testMissingSettingsStillReturnsOneItem() {
  storedSettings = null;

  const res = createResponse();
  await settingsController.getPublicAppUpdate({}, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, [
    {
      forceUpdate: false,
      androidVersion: "0",
      iosVersion: "0",
      android_link: "",
      ios_link: "",
    },
  ]);
}

(async () => {
  await testPublicAppUpdateContract();
  await testAuthenticatedSettingsResponseRemainsUnchanged();
  await testInvalidLegacyBuildNumbersAreSafe();
  await testNumericLegacyVersionsRemainCompatible();
  await testMissingSettingsStillReturnsOneItem();
  console.log("settings tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
