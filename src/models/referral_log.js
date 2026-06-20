const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const referralLogSchema = new mongoose.Schema({
    referrerId: {
        type: Schema.Types.ObjectId,
        ref: "user",
        default: null,
    },
    referredUserId: {
        type: Schema.Types.ObjectId,
        ref: "user",
        default: null,
    },
    referredEmail: {
        type: String,
        default: null,
        trim: true,
        lowercase: true,
    },
    ip: { type: String, default: null },
    rewardedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});
referralLogSchema.index(
    { referredUserId: 1 },
    { unique: true, partialFilterExpression: { referredUserId: { $type: "objectId" } } }
);
referralLogSchema.index(
    { referredEmail: 1 },
    { unique: true, partialFilterExpression: { referredEmail: { $type: "string" } } }
);
referralLogSchema.index(
    { ip: 1 },
    { unique: true, partialFilterExpression: { ip: { $type: "string" } } }
);
module.exports = mongoose.model('ReferralLog', referralLogSchema);
