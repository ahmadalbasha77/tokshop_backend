const mongoose = require('mongoose')
const { Schema, model } = mongoose

const ActivityLogsSchema = mongoose.Schema({
    user: {
        type: Schema.Types.ObjectId,
        ref: "user",
        required: true,
    },
    log_data:{
        type: String,
    },
    date: {
        type: Number,
        default: Date.now(),
    },
    ip: {
        type: String,
        default: null
    }
})

module.exports = mongoose.model('activity_logs', ActivityLogsSchema)