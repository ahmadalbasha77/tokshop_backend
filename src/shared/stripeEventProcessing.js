const stripeEventModel = require("../models/stripe_event");

function safeErrorMessage(error) {
  return String(error?.message || "Stripe event processing failed").slice(0, 500);
}

async function claimStripeEvent(event, endpoint) {
  const recordId = `${endpoint}:${event.id}`;
  const record = {
    _id: recordId,
    stripeEventId: event.id,
    endpoint,
    eventType: event.type,
    account: event.account || null,
    livemode: Boolean(event.livemode),
    stripeCreated: event.created || null,
    status: "processing",
    attempts: 1,
  };

  try {
    await stripeEventModel.create(record);
    return { claimed: true, duplicate: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;

    const existing = await stripeEventModel.findById(recordId).lean();
    if (existing?.status === "processed") {
      return { claimed: false, duplicate: true };
    }

    if (existing?.status === "failed") {
      const claimed = await stripeEventModel.findOneAndUpdate(
        { _id: recordId, status: "failed" },
        {
          $set: { status: "processing", lastError: null },
          $inc: { attempts: 1 },
        },
        { new: true }
      );
      if (claimed) return { claimed: true, duplicate: false };
    }

    return { claimed: false, duplicate: false, inProgress: true };
  }
}

async function processStripeEventOnce(event, endpoint, handler) {
  if (!event?.id || !event?.type) {
    const error = new Error("Stripe event id and type are required");
    error.code = "INVALID_STRIPE_EVENT";
    throw error;
  }

  const claim = await claimStripeEvent(event, endpoint);
  if (!claim.claimed) return claim;

  try {
    await handler();
    const completion = await stripeEventModel.updateOne(
      { _id: `${endpoint}:${event.id}`, status: "processing" },
      {
        $set: {
          status: "processed",
          processedAt: new Date(),
          lastError: null,
        },
      }
    );
    if (completion.matchedCount !== 1) {
      const error = new Error("Stripe event completion state was not persisted");
      error.code = "STRIPE_EVENT_PERSISTENCE_FAILED";
      throw error;
    }
    return { claimed: true, processed: true, duplicate: false };
  } catch (error) {
    if (error.code !== "STRIPE_EVENT_PERSISTENCE_FAILED") {
      await stripeEventModel
        .updateOne(
          { _id: `${endpoint}:${event.id}`, status: "processing" },
          {
            $set: {
              status: "failed",
              lastError: safeErrorMessage(error),
            },
          }
        )
        .catch(() => {});
    }
    throw error;
  }
}

module.exports = {
  claimStripeEvent,
  processStripeEventOnce,
  safeErrorMessage,
};
