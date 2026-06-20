const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const ids = {
  live: new mongoose.Types.ObjectId(),
  product: new mongoose.Types.ObjectId(),
  profile: new mongoose.Types.ObjectId(),
  auction: new mongoose.Types.ObjectId(),
  giveaway: new mongoose.Types.ObjectId(),
  invite: new mongoose.Types.ObjectId(),
};

const rows = {};

function queryFor(key) {
  return {
    select() {
      return this;
    },
    populate() {
      return this;
    },
    lean() {
      return Promise.resolve(rows[key] || null);
    },
  };
}

function mockModel(path, key, extra = {}) {
  const resolved = require.resolve(path);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: {
      findById() {
        return queryFor(key);
      },
      findOne() {
        return queryFor(key);
      },
      ...extra,
    },
  };
}

mockModel("../src/models/room", "live");
mockModel("../src/models/product", "product");
mockModel("../src/models/user", "profile");
mockModel("../src/models/auction", "auction");
mockModel("../src/models/giveaway", "giveaway");
mockModel("../src/models/themes", "theme", {
  findOne() {
    return queryFor("theme");
  },
});

const controller = require("../src/controllers/publicShare");
const {
  publicShareCors,
  publicShareRateLimit,
} = require("../src/services/publicShare.middleware");

function response() {
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

async function call(handler, id) {
  const res = response();
  await handler({ params: { id } }, res);
  return res;
}

void (async () => {
  const routeMounter = fs.readFileSync(
    path.join(__dirname, "../src/routes/ROUTE_MOUNTER.js"),
    "utf8"
  );
  const shareMountIndex = routeMounter.indexOf('router.use("/share", publicShareRouter)');
  const protectedRoutesIndex = routeMounter.indexOf('passport.authenticate("jwt"');
  assert.notEqual(shareMountIndex, -1);
  assert.equal(
    routeMounter.includes(`router.use("${["/public", "/share"].join("")}", publicShareRouter)`),
    false
  );
  assert.equal(shareMountIndex < protectedRoutesIndex, true);

  const middlewareHeaders = {};
  const middlewareRes = {
    setHeader(name, value) {
      middlewareHeaders[name] = value;
    },
  };
  let nextCalled = false;
  publicShareCors(
    { headers: { origin: "https://stealz.live" } },
    middlewareRes,
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, true);
  assert.equal(middlewareHeaders["Access-Control-Allow-Origin"], "https://stealz.live");
  assert.match(middlewareHeaders["Cache-Control"], /max-age=60/);

  let limited = null;
  for (let index = 0; index < 61; index += 1) {
    const rateRes = {
      setHeader() {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        limited = { code: this.statusCode, body };
      },
    };
    publicShareRateLimit(
      { headers: { "x-forwarded-for": "203.0.113.99" } },
      rateRes,
      () => {}
    );
  }
  assert.equal(limited.code, 429);

  for (const endpoint of [
    controller.live,
    controller.product,
    controller.profile,
    controller.auction,
    controller.giveaway,
    controller.invite,
  ]) {
    const invalid = await call(endpoint, "bad-id");
    assert.equal(invalid.statusCode, 400);
  }

  rows.product = {
    _id: ids.product,
    name: "<b>Public product</b>",
    description: "<script>secret()</script> Nice item",
    images: ["http://unsafe.test/a.jpg", "https://cdn.example.com/a.jpg"],
    price: 12,
    status: "active",
    available: true,
    deleted: false,
    reserved: "public",
    email: "must-not-leak@example.com",
  };
  let res = await call(controller.product, ids.product.toString());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.type, "product");
  assert.equal(res.body.image, "https://cdn.example.com/a.jpg");
  assert.equal(res.body.url, `https://stealz.live/product/${ids.product}`);
  assert.equal(res.body.appUrl, `stealz://product/${ids.product}`);
  assert.equal(JSON.stringify(res.body).includes("must-not-leak"), false);
  assert.equal(res.body.title.includes("<b>"), false);

  rows.product.deleted = true;
  res = await call(controller.product, ids.product.toString());
  assert.equal(res.statusCode, 404);

  rows.live = {
    _id: ids.live,
    title: "Live now",
    thumbnail: "https://cdn.example.com/live.jpg",
    status: true,
    started: true,
    ended: false,
    roomType: "private",
    owner: { userName: "host" },
  };
  res = await call(controller.live, ids.live.toString());
  assert.equal(res.statusCode, 404);

  rows.live.roomType = "public";
  res = await call(controller.live, ids.live.toString());
  assert.equal(res.statusCode, 200);
  assert.match(res.body.description, /Status: live/);

  rows.profile = {
    _id: ids.profile,
    userName: "public-user",
    bio: "Short bio",
    profilePhoto: "https://cdn.example.com/profile.jpg",
    accountDisabled: false,
    system_blocked: false,
    suspended: false,
    email: "hidden@example.com",
  };
  res = await call(controller.profile, ids.profile.toString());
  assert.deepEqual(Object.keys(res.body), [
    "type",
    "id",
    "title",
    "description",
    "image",
    "url",
    "appUrl",
  ]);
  assert.equal(JSON.stringify(res.body).includes("hidden@example.com"), false);

  rows.auction = {
    _id: ids.auction,
    higestbid: 25,
    started: true,
    ended: false,
    product: {
      name: "Auction product",
      images: ["https://cdn.example.com/auction.jpg"],
      status: "active",
      available: true,
      deleted: false,
      reserved: "public",
    },
    tokshow: { roomType: "public", status: true },
  };
  res = await call(controller.auction, ids.auction.toString());
  assert.equal(res.statusCode, 200);
  assert.match(res.body.description, /Auction live/);

  rows.auction.product.reserved = "private";
  res = await call(controller.auction, ids.auction.toString());
  assert.equal(res.statusCode, 404);

  rows.giveaway = {
    _id: ids.giveaway,
    name: "Public giveaway",
    images: ["https://cdn.example.com/giveaway.jpg"],
    status: "active",
    tokshow: { roomType: "public", status: true },
    user: { accountDisabled: false, system_blocked: false, suspended: false },
  };
  res = await call(controller.giveaway, ids.giveaway.toString());
  assert.equal(res.statusCode, 200);

  rows.giveaway.status = "deleted";
  res = await call(controller.giveaway, ids.giveaway.toString());
  assert.equal(res.statusCode, 404);

  rows.theme = {
    app_name: "Stealz",
    app_logo: "https://cdn.example.com/logo.jpg",
  };
  rows.profile = {
    _id: ids.invite,
    accountDisabled: false,
    system_blocked: false,
    suspended: false,
  };
  res = await call(controller.invite, ids.invite.toString());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.description.includes(ids.invite.toString()), false);

  console.log("public share endpoint tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
