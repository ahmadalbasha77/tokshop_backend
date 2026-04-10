const activitiesModel = require('../models/activity')

//Get all activities
exports.getAllActivities = async function (req, res) {

    try {
        const activity = await activitiesModel.find().sort({ time: -1 }).limit(20)
        res.json(activity)

    } catch (error) {
        res.status(400).send(error);
    }
}




//Get all activities
exports.getUserActivities = async function (req, res) {

    try {
        // const activity = await activitiesModel.find({ to: req.params.uid }).sort({ time: -1 }).limit(50)


        var pageNumber = req.params.pagenumber
		
		if (pageNumber == 0) {
			pageNumber = 1
		}
		   pageNumber = pageNumber - 1

		const activity = await activitiesModel.aggregate([
			{
				$match: {"to": req.params.uid}
			},
			{
				$sort: { "time": -1 }
			},
			{
				$facet: {
					metadata: [{ $count: "total" }, { $addFields: { page: pageNumber } }],
					data: [
						{ $skip: pageNumber * 20 }, 
						{ $limit: 20 },
						
					]
				}
			}

		])


        res.json(activity)

    } catch (error) {
        console.log(error + " ")
        res.status(400).send(error);
    }
}



//Get activity by id
exports.getActivityById = async function (req, res) {

    try {
        const activity = await activitiesModel.findById(req.params.id);
        res.json(activity)

    } catch (error) {
        res.status(404).send(error);
    }
}



//Save activity
exports.saveActivity = async function (req, res) {
    const activity = new activitiesModel(req.body)

    try {
        await activity.save()
        res.json("Successfuly saved activity")
    }

    catch (err) {
        res.status(400).send(err);
    }
}

//Update activity
exports.updateActivity = async function (req, res) {
    try {
        await activitiesModel.updateOne({ _id: req.params.id },
            { $set: req.body })

        res.json("Updated activity successfully")
    }

    catch (err) {
        res.status(404).send(err);
    }
}

//Delete activity
exports.deleteActivity = async function (req, res) {
    try {

        await activitiesModel.deleteOne({ _id: req.params.id });

        res.json("Successfuly deleted activity")
    }

    catch (err) {
        res.status(404).send(err);
    }
}


//Delete activity
exports.deleteAllActivity = async function (req, res) {
    try {

        await activitiesModel.deleteMany({ to: req.body.userId });

        res.json("Successfuly deleted activity")
    }

    catch (err) {
        res.status(404).send(err);
    }
}
