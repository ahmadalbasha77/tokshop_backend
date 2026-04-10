const emaailtemplates = require("../models/templates");
exports.createEmailTemplate = async (req, res) => {
    // console.log(req.body);
    // try {
        let checkifexists = await emaailtemplates.findOne({ slug: req.body.slug });
        if (checkifexists) {
            //update
            let emailTemplate = await emaailtemplates.findOneAndUpdate({ slug: req.body.slug }, req.body, { new: true });
            return res.status(201).json(emailTemplate);
        }
        const emailTemplate = new emaailtemplates(req.body);
        const savedEmailTemplate = await emailTemplate.save();
        res.status(201).json(savedEmailTemplate);
    // } catch (error) {
    //     res.status(400).json({ message: error.message });
    // }
}

exports.getEmailTemplates = async (req, res) => {
    try {
        const emailTemplates = await emaailtemplates.find();
        res.json(emailTemplates);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getEmailTemplateById = async (req, res) => {
    try {
        const emailTemplate = await emaailtemplates.findById(req.params.id);
        if (!emailTemplate) {
            return res.status(404).json({ message: 'Email template not found' });
        }
        res.json(emailTemplate);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.updateEmailTemplate = async (req, res) => {
    try {
        const updatedEmailTemplate = await emaailtemplates.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedEmailTemplate) {
            return res.status(404).json({ message: 'Email template not found' });
        }
        res.json(updatedEmailTemplate);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.deleteEmailTemplate = async (req, res) => {
    try {
        const deletedEmailTemplate = await emaailtemplates.findByIdAndDelete(req.params.id);
        if (!deletedEmailTemplate) {
            return res.status(404).json({ message: 'Email template not found' });
        }
        res.json(deletedEmailTemplate);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}