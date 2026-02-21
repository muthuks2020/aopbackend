const { errorResponse } = require('../utils/helpers');


const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json(errorResponse('Authentication required.'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json(
        errorResponse(`Access denied. Required role(s): ${allowedRoles.join(', ')}. Your role: ${req.user.role}.`)
      );
    }

    next();
  };
};

module.exports = authorize;
