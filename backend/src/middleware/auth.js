const jwt = require('jsonwebtoken');
const { models } = require('../config/db');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required. Please login.' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'aml_super_secret_jwt_key_123456', async (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Session expired or invalid token. Please log in again.' });
    }

    try {
      // Find user from database
      const user = await models.User.findOne({ username: decoded.username });
      if (!user) {
        return res.status(404).json({ success: false, error: 'User account not found.' });
      }

      // Attach user details to request
      req.user = {
        id: user._id,
        username: user.username,
        role: user.role,
        name: user.name
      };
      
      next();
    } catch (dbError) {
      return res.status(500).json({ success: false, error: 'Database error validating token.' });
    }
  });
};

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access Denied: Role '${req.user.role}' is not authorized to access this resource.`
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  authorizeRoles
};
