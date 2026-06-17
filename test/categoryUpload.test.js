const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");

const controllerPath = require.resolve("../src/controllers/category");
const testFileTag = `category-upload-test-${Date.now()}`;
const categoryUploadDir = path.resolve(__dirname, "../images/category");
const uploadedPaths = [];

require.cache[controllerPath] = {
  id: controllerPath,
  filename: controllerPath,
  loaded: true,
  exports: {
    getCategories(req, res) {
      res.json([]);
    },
    getCategory(req, res) {
      res.json({});
    },
    addCategory(req, res) {
      for (const file of req.files || []) {
        uploadedPaths.push(file.path);
      }

      res.json({
        success: true,
        fields: req.body,
        files: (req.files || []).map((file) => ({
          fieldname: file.fieldname,
          originalname: file.originalname,
          size: file.size,
        })),
      });
    },
    updateCategory(req, res) {
      res.json({ success: true });
    },
    folowCategory(req, res) {
      res.json({ success: true });
    },
    unfolowCategory(req, res) {
      res.json({ success: true });
    },
    deleteCategory(req, res) {
      res.json({ success: true });
    },
    getSubcategories(req, res) {
      res.json([]);
    },
    addCategoriesBulk(req, res) {
      res.json([]);
    },
    subcategoryBulk(req, res) {
      res.json([]);
    },
  },
};

const categoryRouter = require("../src/routes/category");

function createApp() {
  const app = express();
  app.use("/", categoryRouter);
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

function multipartBody({ boundary, fields = {}, files = [] }) {
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`)
    );
    chunks.push(Buffer.from(String(value)));
    chunks.push(Buffer.from("\r\n"));
  }

  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n`
      )
    );
    chunks.push(
      Buffer.from(`Content-Type: ${file.contentType || "image/png"}\r\n\r\n`)
    );
    chunks.push(file.content);
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function requestMultipart(server, body, boundary) {
  const { port } = server.address();

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        port,
        path: "/",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: res.statusCode,
            body: text ? JSON.parse(text) : null,
          });
        });
      }
    );

    req.on("error", reject);
    req.end(body);
  });
}

void (async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    let boundary = "category-upload-ok";
    let body = multipartBody({
      boundary,
      fields: {
        name: "Sneakers",
        tax_code: "950440",
        commission_enabled: "true",
        commission: "5",
      },
      files: [
        {
          field: "images",
          filename: `${testFileTag}-icon.png`,
          content: Buffer.from("small-image"),
        },
      ],
    });

    let response = await requestMultipart(server, body, boundary);
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.body.success, true);
    assert.equal(response.body.fields.name, "Sneakers");
    assert.equal(response.body.files[0].fieldname, "images");

    boundary = "category-upload-too-large";
    body = multipartBody({
      boundary,
      files: [
        {
          field: "images",
          filename: `${testFileTag}-large.png`,
          content: Buffer.alloc(10 * 1024 * 1024 + 1),
        },
      ],
    });

    response = await requestMultipart(server, body, boundary);
    assert.equal(response.statusCode, 413);
    assert.deepEqual(response.body, {
      error: "Image is too large. Max size is 10MB.",
    });

    boundary = "category-upload-wrong-field";
    body = multipartBody({
      boundary,
      files: [
        {
          field: "image",
          filename: `${testFileTag}-wrong-field.png`,
          content: Buffer.from("small-image"),
        },
      ],
    });

    response = await requestMultipart(server, body, boundary);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      error: 'Invalid file field. Use "images".',
    });

    console.log("category upload tests passed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (fs.existsSync(categoryUploadDir)) {
      for (const fileName of fs.readdirSync(categoryUploadDir)) {
        if (fileName.includes(testFileTag)) {
          uploadedPaths.push(path.join(categoryUploadDir, fileName));
        }
      }
    }

    for (const uploadedPath of new Set(uploadedPaths)) {
      try {
        fs.unlinkSync(uploadedPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.warn(`Could not remove test upload: ${uploadedPath}`);
        }
      }
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
