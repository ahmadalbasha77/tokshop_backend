const assert = require("node:assert/strict");
const path = require("node:path");

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

const calls = [];
let storedRoom;
let deleteResult;
let failure;

const roomsModel = {
  async findById(roomId) {
    calls.push(["find", roomId]);
    return storedRoom;
  },
  async findByIdAndUpdate(roomId, update) {
    calls.push(["end-room", roomId, update]);
    return storedRoom;
  },
  async findByIdAndDelete(roomId) {
    calls.push(["delete", roomId]);
    return deleteResult;
  },
};

const auctionModel = {
  async findByIdAndUpdate(auctionId, update) {
    calls.push(["end-auction", auctionId, update]);
  },
};

const products = {
  async updateMany(filter, update) {
    calls.push(["detach-products", filter, update]);
    if (failure) throw failure;
  },
};

mockModule("../src/models/room", roomsModel);
mockModule("../src/models/user", {});
mockModule("../src/models/auction", auctionModel);
mockModule("../src/models/product", products);
mockModule("../src/models/category", {});
mockModule("../src/shared/functions", {});
mockModule("../src/shared/sellerProfile", {
  requireSellerProfileCompleteByUserId: async () => ({ ok: true }),
});
mockModule("../src/shared/send_notification", {
  sendNotificationToAll: async () => {},
});

const roomController = require("../src/controllers/rooms");

async function invoke(roomId, query = { destroy: "true" }) {
  const res = createResponse();
  await roomController.deleteRoomById({ params: { roomId }, query }, res);
  return res;
}

function reset() {
  calls.length = 0;
  storedRoom = null;
  deleteResult = null;
  failure = null;
}

void (async () => {
  const roomId = "6a51f3730f93db3a64d6cbf0";
  const auctionId = "6a51f3730f93db3a64d6cbf1";

  reset();
  storedRoom = { _id: roomId, activeauction: auctionId, ended: false };
  deleteResult = { _id: roomId };

  let res = await invoke(roomId);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    message: "Show ended and deleted successfully",
    deletedId: roomId,
  });
  assert.deepEqual(
    calls.map(([name]) => name),
    ["find", "end-auction", "detach-products", "end-room", "delete"]
  );
  assert.deepEqual(calls[1], [
    "end-auction",
    auctionId,
    { $set: { ended: true } },
  ]);
  assert.deepEqual(calls[2], [
    "detach-products",
    { tokshow: roomId },
    { $set: { tokshow: null } },
  ]);
  assert.equal(calls[3][2].$set.ended, true);
  assert.equal(calls[3][2].$set.status, false);
  assert.deepEqual(calls[3][2].$set.viewers, []);
  assert.equal(calls[3][2].$set.viewersCount, 0);
  assert.equal(typeof calls[3][2].$set.endedTime, "number");

  reset();
  storedRoom = { _id: roomId, activeauction: null, ended: true };
  deleteResult = { _id: roomId };

  res = await invoke(roomId, {});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["find", "detach-products", "end-room", "delete"]
  );

  reset();
  res = await invoke(roomId);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, {
    success: false,
    message: "Show not found",
  });
  assert.deepEqual(calls.map(([name]) => name), ["find"]);

  reset();
  res = await invoke("invalid-room-id");
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    success: false,
    message: "Invalid room ID",
  });
  assert.deepEqual(calls, []);

  reset();
  storedRoom = { _id: roomId, activeauction: null, ended: true };
  res = await invoke(roomId);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, {
    success: false,
    message: "Show was not deleted",
  });

  reset();
  storedRoom = { _id: roomId, activeauction: null, ended: false };
  failure = new Error("database unavailable");

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    res = await invoke(roomId);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    success: false,
    message: "Failed to delete show",
    error: "database unavailable",
  });
  assert.equal(calls.some(([name]) => name === "delete"), false);

  console.log("room delete tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
