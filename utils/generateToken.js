const jwt = require('jsonwebtoken');

const generateToken = (userId, college_id, role, tokenEpoch = 0) => {
  return jwt.sign(
    { userId, college_id, role, tokenEpoch },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

module.exports = generateToken;
