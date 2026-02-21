const { errorResponse } = require('../utils/helpers');


const validateBody = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    const details = error.details.map((d) => d.message);
    return res.status(400).json(errorResponse('Validation failed.', details));
  }
  req.body = value;
  next();
};


const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    const details = error.details.map((d) => d.message);
    return res.status(400).json(errorResponse('Invalid query parameters.', details));
  }
  req.query = value;
  next();
};

module.exports = { validateBody, validateQuery };
