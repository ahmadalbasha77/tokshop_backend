const express = require('express')
const router = express.Router()
const activityController = require('../controllers/activity')

//Get all activities
router.get('/', activityController.getAllActivities)



//Get activities for user
router.get('/to/:uid/:pagenumber', activityController.getUserActivities)

//Get activity by id
router.get('/:id', activityController.getActivityById)
//Save activity
router.post('/', activityController.saveActivity)

//Update activity
router.patch('/:id', activityController.updateActivity)

//Delete activity
router.delete('/:id', activityController.deleteActivity)
//Delete all activity
router.delete('/', activityController.deleteAllActivity)

module.exports = router