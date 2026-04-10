const express = require('express');
const router = express.Router();
const helpArticleController = require("../controllers/articles")
const passport = require("passport");
router.get('/', helpArticleController.getAll);
router.get('/:id', helpArticleController.getById);
router.post('/', passport.authenticate("jwt", { session: false }),helpArticleController.create);
router.put('/:id',passport.authenticate("jwt", { session: false }), helpArticleController.update);
router.delete('/:id', passport.authenticate("jwt", { session: false }),helpArticleController.delete);
router.get('/published/articles/', helpArticleController.getPublished);
router.get('/published/articles/:slug', helpArticleController.getBySlug);

module.exports = router;