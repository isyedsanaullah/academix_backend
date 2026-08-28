const jwt = require('jsonwebtoken');

const generateToken = (userId, college_id, role) => {
  return jwt.sign(
    { userId, college_id, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

module.exports = generateToken;
