const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { models } = require('../config/db');
const { logAction } = require('../config/auditLogger');

const register = async (req, res) => {
  const { username, password, name, role } = req.body;
  
  if (!username || !password || !name || !role) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  try {
    const existingUser = await models.User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username is already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await models.User.create({
      username,
      password: hashedPassword,
      name,
      role
    });

    // Log action (we can check who created the user, e.g. admin or anonymous self-registration)
    const operator = req.user ? req.user.username : 'Self-Registration';
    const operatorRole = req.user ? req.user.role : 'Guest';
    await logAction(operator, operatorRole, 'USER_REGISTERED', req.ip, `Registered user ${username} with role ${role}`);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      user: {
        id: newUser._id,
        username: newUser.username,
        name: newUser.name,
        role: newUser.role
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  try {
    const user = await models.User.findOne({ username });
    if (!user) {
      await logAction(username, 'Guest', 'LOGIN_FAILED', req.ip, 'Invalid username');
      return res.status(400).json({ success: false, error: 'Invalid username or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await logAction(username, 'Guest', 'LOGIN_FAILED', req.ip, 'Invalid password');
      return res.status(400).json({ success: false, error: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'aml_super_secret_jwt_key_123456',
      { expiresIn: '8h' }
    );

    await logAction(user.username, user.role, 'LOGIN_SUCCESS', req.ip, 'Successful login');

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const logout = async (req, res) => {
  if (req.user) {
    await logAction(req.user.username, req.user.role, 'LOGOUT', req.ip, 'Logged out successfully');
  }
  return res.json({ success: true, message: 'Logged out successfully.' });
};

const getProfile = async (req, res) => {
  try {
    const user = await models.User.findOne({ username: req.user.username });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    return res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateProfile = async (req, res) => {
  const { name, password } = req.body;
  try {
    const updateObj = {};
    if (name) updateObj.name = name;
    if (password) {
      updateObj.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await models.User.findByIdAndUpdate(
      req.user.id || req.user.username,
      updateObj,
      { new: true }
    );

    await logAction(req.user.username, req.user.role, 'PROFILE_UPDATED', req.ip, 'Updated profile details');

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: {
        id: updatedUser._id,
        username: updatedUser.username,
        name: updatedUser.name,
        role: updatedUser.role
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  register,
  login,
  logout,
  getProfile,
  updateProfile
};
