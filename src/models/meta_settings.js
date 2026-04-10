const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const MetaSettings = mongoose.Schema({
    user: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    key: {
        type: String,
        default: "",
    },
    settings: {
    }
});

module.exports = mongoose.model("metasettings", MetaSettings);