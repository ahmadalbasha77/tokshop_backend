const assert = require("node:assert/strict");
const path = require("node:path");
const userModel = require("../src/models/user");

function mockModule(relativePath, exports) {
  const resolved = require.resolve(path.join(__dirname, relativePath));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

mockModule("../src/shared/functions", {});
mockModule("../src/controllers/stripe", { createTestStripeToken() {} });

const userController = require("../src/controllers/users");

function createResponse() {
  return {
    body: null,
    statusCode: 200,
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function selectedUser(id, userName = id) {
  return {
    _id: id,
    firstName: `first-${id}`,
    lastName: `last-${id}`,
    userName,
    profilePhoto: `photo-${id}`,
  };
}

function makeFindQuery(result, calls) {
  return {
    select(value) {
      calls.select = value;
      return this;
    },
    skip(value) {
      calls.skip = value;
      return this;
    },
    limit(value) {
      calls.limit = value;
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

const originalFindById = userModel.findById;
const originalFind = userModel.find;
const originalAggregate = userModel.aggregate;

void (async () => {
  let relation = { followers: [], following: [] };
  let existingUsers = [];
  let findCalls = {};
  let lastPipeline = null;

  try {
    userModel.findById = () => ({
      select: async () => relation,
    });
    userModel.find = () => makeFindQuery(existingUsers, findCalls);
    userModel.aggregate = async (pipeline) => {
      lastPipeline = pipeline;
      const ids = relation.following.map(String);
      const uniqueUsers = existingUsers.filter(
        (item, index, all) =>
          ids.includes(String(item._id)) &&
          all.findIndex((candidate) => String(candidate._id) === String(item._id)) === index
      );
      return [...uniqueUsers].sort(
        (a, b) => ids.lastIndexOf(String(b._id)) - ids.lastIndexOf(String(a._id))
      );
    };

    relation = { followers: ["a", "b"], following: [] };
    existingUsers = [selectedUser("a"), selectedUser("b")];
    findCalls = {};
    let res = createResponse();
    await userController.userFollowers(
      { params: { userId: "owner" }, query: {} },
      res
    );
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 2);
    assert.equal(findCalls.skip, undefined);
    assert.equal(findCalls.limit, undefined);

    relation = { followers: [], following: ["a", "b", "c"] };
    existingUsers = [selectedUser("a"), selectedUser("b"), selectedUser("c")];
    res = createResponse();
    await userController.userFollowing(
      { params: { userId: "owner" }, query: {} },
      res
    );
    assert.ok(Array.isArray(res.body));
    assert.deepEqual(res.body.map((user) => user._id), ["c", "b", "a"]);
    assert.equal(lastPipeline.some((stage) => "$skip" in stage), false);
    assert.equal(lastPipeline.some((stage) => "$limit" in stage), false);

    relation = { followers: ["a", "b"], following: [] };
    existingUsers = [selectedUser("a")];
    findCalls = {};
    res = createResponse();
    await userController.userFollowers(
      { params: { userId: "owner" }, query: { page: "1", limit: "10" } },
      res
    );
    assert.deepEqual(res.body, { users: existingUsers, total: 2, pages: 1 });
    assert.equal(findCalls.skip, 0);
    assert.equal(findCalls.limit, "10");

    relation = { followers: [], following: ["a", "b"] };
    existingUsers = [selectedUser("a"), selectedUser("b")];
    res = createResponse();
    await userController.userFollowing(
      { params: { userId: "owner" }, query: { page: "1", limit: "10" } },
      res
    );
    assert.equal(Array.isArray(res.body), false);
    assert.equal(res.body.total, 2);
    assert.equal(res.body.pages, 1);
    assert.ok(lastPipeline.some((stage) => stage.$skip === 0));
    assert.ok(lastPipeline.some((stage) => stage.$limit === 10));

    relation = { followers: ["a"], following: [] };
    existingUsers = [selectedUser("a")];
    findCalls = {};
    res = createResponse();
    await userController.userFollowers(
      { params: { userId: "owner" }, query: { page: "1" } },
      res
    );
    assert.equal(Array.isArray(res.body), false);
    assert.equal(findCalls.limit, 10);

    relation = { followers: [], following: ["a"] };
    existingUsers = [selectedUser("a")];
    res = createResponse();
    await userController.userFollowing(
      { params: { userId: "owner" }, query: { limit: "5" } },
      res
    );
    assert.equal(Array.isArray(res.body), false);
    assert.ok(lastPipeline.some((stage) => stage.$skip === 0));
    assert.ok(lastPipeline.some((stage) => stage.$limit === 5));

    relation = { followers: [], following: [] };
    existingUsers = [];
    findCalls = {};
    res = createResponse();
    await userController.userFollowers(
      { params: { userId: "owner" }, query: {} },
      res
    );
    assert.deepEqual(res.body, []);
    res = createResponse();
    await userController.userFollowing(
      { params: { userId: "owner" }, query: {} },
      res
    );
    assert.deepEqual(res.body, []);

    relation = null;
    res = createResponse();
    await userController.userFollowers(
      { params: { userId: "missing" }, query: {} },
      res
    );
    assert.equal(res.statusCode, 404);
    res = createResponse();
    await userController.userFollowing(
      { params: { userId: "missing" }, query: {} },
      res
    );
    assert.equal(res.statusCode, 404);

    relation = { followers: ["a", "deleted"], following: ["a", "deleted"] };
    existingUsers = [selectedUser("a")];
    findCalls = {};
    res = createResponse();
    await userController.userFollowers(
      { params: { userId: "owner" }, query: {} },
      res
    );
    assert.deepEqual(res.body.map((user) => user._id), ["a"]);
    res = createResponse();
    await userController.userFollowing(
      { params: { userId: "owner" }, query: {} },
      res
    );
    assert.deepEqual(res.body.map((user) => user._id), ["a"]);

    relation = { followers: ["a", "a"], following: ["a", "a"] };
    existingUsers = [selectedUser("a")];
    findCalls = {};
    res = createResponse();
    await userController.userFollowers(
      { params: { userId: "owner" }, query: {} },
      res
    );
    assert.equal(res.body.length, 1);
    res = createResponse();
    await userController.userFollowing(
      { params: { userId: "owner" }, query: {} },
      res
    );
    assert.equal(res.body.length, 1);

    relation = { followers: ["safe"], following: ["safe"] };
    existingUsers = [
      {
        ...selectedUser("safe"),
      },
    ];
    findCalls = {};
    res = createResponse();
    await userController.userFollowers(
      { params: { userId: "owner" }, query: {} },
      res
    );
    assert.equal(findCalls.select, "_id firstName lastName profilePhoto userName");
    assert.deepEqual(Object.keys(res.body[0]).sort(), [
      "_id",
      "firstName",
      "lastName",
      "profilePhoto",
      "userName",
    ]);
    res = createResponse();
    await userController.userFollowing(
      { params: { userId: "owner" }, query: {} },
      res
    );
    const project = lastPipeline.find((stage) => stage.$project).$project;
    assert.deepEqual(Object.keys(project).sort(), [
      "_id",
      "firstName",
      "lastName",
      "profilePhoto",
      "userName",
    ]);

    console.log("user connections compatibility tests passed");
  } finally {
    userModel.findById = originalFindById;
    userModel.find = originalFind;
    userModel.aggregate = originalAggregate;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
