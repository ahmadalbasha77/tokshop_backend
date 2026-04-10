const mongoose = require('mongoose')
const { Schema, model } = mongoose;

const RecordingsSchema = mongoose.Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: "user",
        required: true,
    },
    roomId: {
        type: Schema.Types.ObjectId,
        ref: "rooms",
        required: true,
    },
    resourceId: {
        type: String,
    },
    sid: {
        type: String,
    },
    fileList: {
        type: String,
    },
    uploadingStatus: {
        type: String,
    },
    date: {
        type: Number,
        default: 0
    }
})

module.exports = mongoose.model('recordings', RecordingsSchema)