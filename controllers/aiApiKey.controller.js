const { getSystemClient } = require('../config/prismaManager');
const { encrypt, decrypt, maskKey } = require('../utils/encryption');

// @desc    Save or update AI API key
// @route   POST /api/ai/api-key
// @access  Private (any authenticated user)
exports.saveKey = async (req, res, next) => {
  try {
    const { apiKey, provider = 'gemini' } = req.body;

    if (!apiKey || apiKey.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid API key'
      });
    }

    // Encrypt the key
    const { encrypted, iv } = encrypt(apiKey.trim());
    const prisma = getSystemClient();

    // Upsert — one key per user per provider
    const saved = await prisma.aIApiKey.upsert({
      where: {
        userId_provider: {
          userId: req.user._id,
          provider
        }
      },
      update: {
        collegeId: req.user.college_id || null,
        encryptedKey: encrypted,
        iv,
        isActive: true
      },
      create: {
        userId: req.user._id,
        collegeId: req.user.college_id || null,
        provider,
        encryptedKey: encrypted,
        iv,
        isActive: true
      }
    });

    res.json({
      success: true,
      message: 'API key saved securely',
      data: {
        _id: saved.id,
        provider: saved.provider,
        maskedKey: maskKey(apiKey.trim()),
        isActive: saved.isActive,
        updatedAt: saved.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current user's API key (masked)
// @route   GET /api/ai/api-key
// @access  Private
exports.getKey = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const key = await prisma.aIApiKey.findUnique({
      where: {
        userId_provider: {
          userId: req.user._id,
          provider: 'gemini'
        }
      }
    });

    if (!key) {
      return res.json({
        success: true,
        data: null,
        message: 'No API key configured'
      });
    }

    // Decrypt to get masked version
    const decrypted = decrypt(key.encryptedKey, key.iv);

    res.json({
      success: true,
      data: {
        _id: key.id,
        provider: key.provider,
        maskedKey: maskKey(decrypted),
        isActive: key.isActive,
        lastUsed: key.lastUsed,
        usageCount: key.usageCount,
        updatedAt: key.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete user's API key
// @route   DELETE /api/ai/api-key
// @access  Private
exports.deleteKey = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    await prisma.aIApiKey.delete({
      where: {
        userId_provider: {
          userId: req.user._id,
          provider: 'gemini'
        }
      }
    });

    res.json({
      success: true,
      message: 'API key deleted successfully'
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'No API key found'
      });
    }
    next(error);
  }
};

// @desc    Test API key by making a simple Gemini call
// @route   POST /api/ai/api-key/test
// @access  Private
exports.testKey = async (req, res, next) => {
  try {
    let keyToTest = req.body?.apiKey?.trim();

    if (!keyToTest) {
      const prisma = getSystemClient();
      const savedKey = await prisma.aIApiKey.findFirst({
        where: {
          userId: req.user._id,
          isActive: true
        },
        orderBy: { updatedAt: 'desc' }
      });

      if (!savedKey) {
        return res.status(404).json({
          success: false,
          message: 'No API key configured. Please enter an API key to test.'
        });
      }

      keyToTest = decrypt(savedKey.encryptedKey, savedKey.iv);
    }

    if (!keyToTest) {
      return res.status(400).json({ success: false, message: 'Invalid API key provided' });
    }

    // 1. Test OpenRouter Key (Only if key starts with sk-or-)
    if (keyToTest.startsWith('sk-or-')) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${keyToTest}`,
            'HTTP-Referer': 'https://academix.edu.pk',
            'X-Title': 'Academix Smart E-Services'
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-chat',
            messages: [{ role: 'user', content: 'Reply with one word: Hello' }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content || 'Hello';
          return res.json({
            success: true,
            message: 'OpenRouter API key is valid and working!',
            data: { testResponse: text.trim(), provider: 'openrouter' }
          });
        } else {
          const errText = await response.text();
          return res.status(400).json({
            success: false,
            message: `OpenRouter API Key rejected (${response.status}): ${errText}`
          });
        }
      } catch (orErr) {
        return res.status(400).json({
          success: false,
          message: `Failed to verify OpenRouter key: ${orErr.message}`
        });
      }
    }

    // 2. Test Google Gemini Key
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(keyToTest);

    const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('Reply with exactly one word: Hello');
        const text = result.response.text();
        return res.json({
          success: true,
          message: `Google Gemini API key is valid and working! (Model: ${modelName})`,
          data: { testResponse: text.trim(), model: modelName, provider: 'gemini' }
        });
      } catch (err) {
        lastError = err;
        const msg = (err.message || '').toLowerCase();
        const status = err.status || err.statusCode || err.httpStatusCode || 0;
        if (status === 400 || status === 403 || msg.includes('api_key') || msg.includes('invalid') || msg.includes('not found') || msg.includes('api key')) {
          return res.status(400).json({
            success: false,
            message: 'Google Gemini API key is invalid or has been revoked. Please generate a new key from aistudio.google.com'
          });
        }
        if ((msg.includes('429') || msg.includes('quota')) && !msg.includes('limit: 0')) {
          return res.json({
            success: true,
            message: 'Google Gemini API key is valid! (Rate limited — wait a minute and try again.)',
            data: { testResponse: 'Key is valid but rate limited', rateLimited: true }
          });
        }
        continue;
      }
    }

    const errMsg = lastError?.message || '';
    if (errMsg.includes('limit: 0') || errMsg.includes('429')) {
      return res.json({
        success: true,
        message: 'Google Gemini API key is valid but all models returned quota 0. Please generate a NEW key from Google AI Studio (aistudio.google.com).',
        data: { testResponse: 'Quota issue — regenerate key from AI Studio', quotaIssue: true }
      });
    }

    if (errMsg.includes('ENOTFOUND') || errMsg.includes('ECONNREFUSED') || errMsg.includes('fetch')) {
      return res.status(503).json({
        success: false,
        message: 'Cannot reach Google AI servers. Check your internet connection.'
      });
    }

    return res.status(400).json({
      success: false,
      message: `Google Gemini API key test failed: ${lastError?.message || 'Unknown error'}`
    });
  } catch (error) {
    next(error);
  }
};

exports.getDecryptedKey = async (userId) => {
  try {
    const prisma = getSystemClient();
    const key = await prisma.aIApiKey.findFirst({
      where: {
        userId,
        isActive: true
      },
      orderBy: { updatedAt: 'desc' }
    });
    
    if (key) {
      // Update usage stats
      try {
        await prisma.aIApiKey.update({
          where: { id: key.id },
          data: {
            lastUsed: new Date(),
            usageCount: { increment: 1 }
          }
        });
      } catch (e) {}
      return decrypt(key.encryptedKey, key.iv);
    }
  } catch (err) {}

  return process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || null;
};
