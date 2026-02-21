const jwt = require('jsonwebtoken');
const authConfig = require('../config/auth');
const { db } = require('../config/database');
const { errorResponse } = require('../utils/helpers');


const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(errorResponse('Authentication required. Provide Bearer token.'));
    }

    const token = authHeader.split(' ')[1];


    let decoded;
    try {
      decoded = jwt.verify(token, authConfig.jwt.secret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json(errorResponse('Token expired. Please refresh or login again.'));
      }
      return res.status(401).json(errorResponse('Invalid token.'));
    }


    if (decoded.jti) {
      const session = await db('user_sessions')
        .where({ token_jti: decoded.jti })
        .whereNull('revoked_at')
        .where('expires_at', '>', new Date())
        .first();

      if (!session) {
        return res.status(401).json(errorResponse('Session expired or revoked. Please login again.'));
      }
    }


    const user = await db('auth_users')
      .where({ id: decoded.userId, is_active: true })
      .first();

    if (!user) {
      return res.status(401).json(errorResponse('User not found or inactive.'));
    }


    req.user = {
      id: user.id,
      employeeCode: user.employee_code,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      designation: user.designation,
      zoneCode: user.zone_code,
      zoneName: user.zone_name,
      areaCode: user.area_code,
      areaName: user.area_name,
      territoryCode: user.territory_code,
      territoryName: user.territory_name,
      reportsTo: user.reports_to,
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json(errorResponse('Authentication error.'));
  }
};

module.exports = authenticate;
