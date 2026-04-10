const mongoose = require("mongoose");

const emailTemplateSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    slug: {
        type: String,
        required: true,
    },
    htmlContent: {
        type: String,
        required: true,
    },
    placeholders: {
        type: [String],
        required: true,
    },
});

const EmailTemplate = mongoose.model("EmailTemplate", emailTemplateSchema);

module.exports = EmailTemplate; 