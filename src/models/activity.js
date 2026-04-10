const mongoose = require('mongoose')

const ActivitiesSchema = mongoose.Schema({
    imageurl: {
        type: String,
    },
    actioned: {
        type: Boolean,
        required: false
    },
    name: {
        type: String,
    },
    type: {
        type: String,
    },
    actionkey: {
        type: String,
    },
    message: {
        type: String,
    },
    from: {
        type: String,
        default: null
    },
    to: {
        type: String,
    },
    time: {
        type: String,
    },
})

module.exports = mongoose.model('activities', ActivitiesSchema)