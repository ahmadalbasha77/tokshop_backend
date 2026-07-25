const assert = require("assert");
const stripeEventModel = require("../src/models/stripe_event");
const { processStripeEventOnce } = require("../src/shared/stripeEventProcessing");

async function run() {
  const originals = {
    create: stripeEventModel.create,
    findById: stripeEventModel.findById,
    findOneAndUpdate: stripeEventModel.findOneAndUpdate,
    updateOne: stripeEventModel.updateOne,
  };

  try {
    const updates = [];
    stripeEventModel.create = async () => ({ _id: "platform:evt_1" });
    stripeEventModel.updateOne = async (...args) => {
      updates.push(args);
      return { matchedCount: 1, modifiedCount: 1 };
    };
    let calls = 0;
    const processed = await processStripeEventOnce(
      { id: "evt_1", type: "charge.succeeded", livemode: false },
      "platform",
      async () => { calls += 1; }
    );
    assert.strictEqual(processed.processed, true);
    assert.strictEqual(calls, 1);
    assert.strictEqual(updates.length, 1);

    stripeEventModel.create = async () => {
      const error = new Error("duplicate");
      error.code = 11000;
      throw error;
    };
    stripeEventModel.findById = () => ({
      lean: async () => ({ status: "processed" }),
    });
    const duplicate = await processStripeEventOnce(
      { id: "evt_1", type: "charge.succeeded" },
      "platform",
      async () => { calls += 1; }
    );
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(calls, 1);

    stripeEventModel.create = async () => ({ _id: "connected:evt_2" });
    stripeEventModel.updateOne = async () => ({ matchedCount: 1, modifiedCount: 1 });
    await assert.rejects(
      processStripeEventOnce(
        { id: "evt_2", type: "balance.available" },
        "connected",
        async () => { throw new Error("temporary database error"); }
      ),
      /temporary database error/
    );
  } finally {
    Object.assign(stripeEventModel, originals);
  }
}

run()
  .then(() => console.log("stripeEventProcessing tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
