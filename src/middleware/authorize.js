/**
 * authorize.js — Role-Based Access Control Middleware
 * 
 * Usage:
 *   router.get('/admin/users', authenticate, authorize('admin'), controller.listUsers);
 *   router.get('/tbm/team', authenticate, authorize('tbm', 'abm', 'zbm', 'sales_head'), controller.team);
 * 
 * @version 1.0.0
 * @author Appasamy Associates - Target Setting PWA
 */

/**
 * Returns middleware that restricts access to specified roles.
 * Must be used AFTER authenticate middleware (req.user must exist).
 * 
 * @param  {...string} allowedRoles - Roles allowed to access the route
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}`,
      });
    }

    next();
  };
}

module.exports = { authorize };
