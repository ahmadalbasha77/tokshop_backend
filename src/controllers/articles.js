const HelpArticle = require('../models/articles');

module.exports = {
async getAll(req, res) {
  try {
    const { category, published, sortBy = 'order', limit, page = 1 } = req.query;

    const query = {};
    if (category) query.category = category;
    if (published !== undefined) query.published = published === 'true';

    // Sorting logic fix
    let sortObject = {};
    sortObject[sortBy] = 1;
    if (sortBy !== "createdAt") {
      sortObject.createdAt = -1;
    }

    let articlesQuery = HelpArticle.find(query).sort(sortObject);

    // Pagination
    if (limit) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      articlesQuery = articlesQuery.skip(skip).limit(parseInt(limit));
    }

    // Parallel execution
    const [articles, total] = await Promise.all([
      articlesQuery,
      HelpArticle.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: articles,
      total,
      page: parseInt(page),
      limit: limit ? parseInt(limit) : null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
},


  async getById(req, res) {
    try {
      const article = await HelpArticle.findById(req.params.id);
      
      if (!article) {
        return res.status(404).json({
          success: false,
          error: 'Article not found'
        });
      }

      res.json({
        success: true,
        data: article
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  async getBySlug(req, res) {
    try {
      const article = await HelpArticle.findOne({ slug: req.params.slug });
      
      if (!article) {
        return res.status(404).json({
          success: false,
          error: 'Article not found'
        });
      }

      res.json({
        success: true,
        data: article
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  async create(req, res) {
    try {
      const { title, slug, excerpt, content, category, published, order } = req.body;

      if (!title || !slug || !excerpt || !content) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: title, slug, excerpt, content'
        });
      }

      const existingArticle = await HelpArticle.findOne({ slug });
      if (existingArticle) {
        return res.status(400).json({
          success: false,
          error: 'Article with this slug already exists'
        });
      }

      const article = new HelpArticle({
        title,
        slug,
        excerpt,
        content,
        category: category || 'general',
        published: published !== undefined ? published : true,
        order: order || 0
      });

      await article.save();

      res.status(201).json({
        success: true,
        message: 'Article created successfully',
        data: article
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          error: 'Article with this slug already exists'
        });
      }
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  async update(req, res) {
    try {
      const { title, slug, excerpt, content, category, published, order } = req.body;

      if (!title || !slug || !excerpt || !content) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: title, slug, excerpt, content'
        });
      }

      const existingArticle = await HelpArticle.findOne({ 
        slug, 
        _id: { $ne: req.params.id } 
      });
      
      if (existingArticle) {
        return res.status(400).json({
          success: false,
          error: 'Another article with this slug already exists'
        });
      }

      const article = await HelpArticle.findByIdAndUpdate(
        req.params.id,
        {
          title,
          slug,
          excerpt,
          content,
          category: category || 'general',
          published: published !== undefined ? published : true,
          order: order || 0
        },
        { new: true, runValidators: true }
      );

      if (!article) {
        return res.status(404).json({
          success: false,
          error: 'Article not found'
        });
      }

      res.json({
        success: true,
        message: 'Article updated successfully',
        data: article
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          error: 'Article with this slug already exists'
        });
      }
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  async delete(req, res) {
    try {
      const article = await HelpArticle.findByIdAndDelete(req.params.id);

      if (!article) {
        return res.status(404).json({
          success: false,
          error: 'Article not found'
        });
      }

      res.json({
        success: true,
        message: 'Article deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  async getPublished(req, res) {
    try {
      const { category, sortBy = 'order' } = req.query;
      
      const query = { published: true };
      if (category) query.category = category;

      const articles = await HelpArticle.find(query)
        .sort({ [sortBy]: 1, createdAt: -1 })
        .select('-__v');

      res.json({
        success: true,
        data: articles
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
};
