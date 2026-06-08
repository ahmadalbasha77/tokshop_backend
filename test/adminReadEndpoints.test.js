const assert = require("node:assert/strict");

function resolvedQuery(value) {
  const query = {
    select() {
      return this;
    },
    lean() {
      return this;
    },
    skip() {
      return this;
    },
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    maxTimeMS() {
      return Promise.resolve(value);
    },
  };
  return query;
}

function mockModel(relativePath, exports) {
  const modelPath = require.resolve(relativePath);
  require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports,
  };
}

mockModel("../src/models/user", {
  find() {
    return resolvedQuery([]);
  },
  countDocuments() {
    return resolvedQuery(0);
  },
});
mockModel("../src/models/room", {
  find() {
    return resolvedQuery([]);
  },
  countDocuments() {
    return resolvedQuery(0);
  },
});
mockModel("../src/models/order", {
  countDocuments() {
    return resolvedQuery(0);
  },
});
mockModel("../src/models/item", {
  aggregate() {
    return {
      option() {
        return Promise.resolve([]);
      },
    };
  },
});
mockModel("../src/models/templates", {
  find() {
    return resolvedQuery([]);
  },
});

const controller = require("../src/controllers/adminRead");
const {
  normalizePagination,
} = require("../src/shared/adminReadUtils");

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

async function call(handler, query = {}) {
  const req = {
    query,
    originalUrl: "/test",
    adminTokenType: "admin",
    user: { _id: "admin", role: "admin", _authType: "admin" },
  };
  const res = createResponse();
  await handler(req, res);
  return res;
}

void (async () => {
  assert.deepEqual(normalizePagination(undefined, undefined), {
    pages: 1,
    limits: 10,
    skip: 0,
  });
  assert.deepEqual(normalizePagination(0, 0), {
    pages: 1,
    limits: 10,
    skip: 0,
  });

  let response = await call(controller.getUsers, {
    page: null,
    limit: undefined,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    users: [],
    totalDoc: 0,
    limits: 10,
    pages: 1,
  });

  response = await call(controller.getUserStats);
  assert.deepEqual(response.body, {
    totalUsers: 0,
    blockedUsers: 0,
    totalCustomers: 0,
    pendingSellers: 0,
    activeSellers: 0,
  });

  response = await call(controller.getRoomStats);
  assert.equal(response.body.total, 0);
  assert.deepEqual(response.body.recentshows, []);

  response = await call(controller.getOrderStats);
  assert.deepEqual(response.body, {
    total: 0,
    shipped: 0,
    delivered: 0,
    ordersValue: 0,
  });

  response = await call(controller.getTemplates);
  assert.deepEqual(response.body, []);

  response = await call(controller.verifyAdmin);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.admin, true);

  console.log("admin read endpoint tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
