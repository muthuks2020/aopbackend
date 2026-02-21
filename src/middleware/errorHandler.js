const { errorResponse } = require('../utils/helpers');


const errorHandler = (err, req, res, next) => {
  console.error('🔴 Error:', err);


  if (err.isJoi) {
    return res.status(400).json(errorResponse('Validation error.', err.details?.map((d) => d.message)));
  }


  if (err.status) {
    return res.status(err.status).json(errorResponse(err.message));
  }


  if (err.code) {
    switch (err.code) {
      case '23505':
        return res.status(409).json(errorResponse('Duplicate entry. This record already exists.'));
      case '23503':
        return res.status(400).json(errorResponse('Referenced record not found.'));
      case '23502':
        return res.status(400).json(errorResponse(`Missing required field: ${err.column}`));
      default:
        break;
    }
  }


  const message = process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message;
  return res.status(500).json(errorResponse(message));
};

module.exports = errorHandler;
