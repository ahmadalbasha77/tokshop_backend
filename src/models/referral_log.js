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
    ip: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('ReferralLog', referralLogSchema);