// ─── AI Chat Controller (Multi-DB with Prisma) ───────────────────
const { getDecryptedKey } = require('./aiApiKey.controller');
const { generateStreamingResponse } = require('../services/aiService');
const announcementService = require('../services/announcementService');

exports.sendMessage = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { message, conversationId, subject, mode, existingDraft, action, draftSessionId } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'Message is required' });

    // Handle Announcement Mode
    if (mode === 'announcement') {
      const allowedRoles = ['admin', 'principal', 'superAdmin'];
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Announcement Mode is available exclusively for Admin and Principal roles.'
        });
      }

      const apiKey = await getDecryptedKey(req.user._id);

      let conversation;
      if (conversationId) {
        conversation = await tenantDb.chatHistory.findFirst({
          where: { id: conversationId, userId: req.user._id }
        });
      }

      if (!conversation) {
        const title = `Announcement: ${message.length > 35 ? message.substring(0, 35) + '...' : message}`;
        conversation = await tenantDb.chatHistory.create({
          data: {
            userId: req.user._id,
            collegeId: req.collegeId || req.user.college_id,
            role: req.user.role,
            title,
            messages: [],
            metadata: { messageCount: 0, mode: 'announcement' }
          }
        });
      }

      let messages = conversation.messages || [];
      if (!Array.isArray(messages)) messages = [];
      messages.push({ role: 'user', content: message, mode: 'announcement', timestamp: new Date() });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': conversation.id
      });

      res.write(`data: ${JSON.stringify({ conversationId: conversation.id, type: 'meta' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'status', stage: 'Analyzing situation & enforcing business rules...' })}\n\n`);

      // Determine existing draft context from request body or metadata
      const activeDraft = existingDraft || conversation.metadata?.activeDraft || null;

      const result = await announcementService.generateAnnouncementDraft({
        message,
        role: req.user.role,
        collegeId: req.collegeId || req.user.college_id,
        apiKey,
        existingDraft: activeDraft,
        action,
        draftSessionId,
        tenantDb
      });

      if (result.isAdvisory) {
        // User asked general advisory question — respond with streaming AI chat
        res.write(`data: ${JSON.stringify({ type: 'status', stage: 'Providing advisory response...' })}\n\n`);
        return generateStreamingResponse({
          message,
          role: req.user.role,
          userId: req.user._id,
          collegeId: req.collegeId || req.user.college_id,
          apiKey,
          conversationHistory: messages.slice(0, -1),
          subject,
          res
        });
      }

      // Announcement Draft generated
      const draft = result.draft;
      messages.push({
        role: 'assistant',
        mode: 'announcement',
        content: `**${draft.title}**\n\n${draft.content}`,
        announcement: draft,
        timestamp: new Date()
      });

      const metadata = conversation.metadata || {};
      metadata.messageCount = messages.length;
      metadata.activeDraft = draft;

      await tenantDb.chatHistory.update({
        where: { id: conversation.id },
        data: { messages, metadata }
      });

      res.write(`data: ${JSON.stringify({ type: 'status', stage: 'Complete' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'announcement', announcement: draft, done: true })}\n\n`);
      return res.end();
    }

    // Standard Chat Mode
    const apiKey = await getDecryptedKey(req.user._id);

    let conversation;
    if (conversationId) {
      conversation = await tenantDb.chatHistory.findFirst({
        where: { id: conversationId, userId: req.user._id }
      });
    }

    if (!conversation) {
      const title = message.length > 50 ? message.substring(0, 50) + '...' : message;
      conversation = await tenantDb.chatHistory.create({
        data: {
          userId: req.user._id,
          collegeId: req.collegeId || req.user.college_id,
          role: req.user.role,
          title,
          messages: [],
          metadata: { messageCount: 0 }
        }
      });
    }

    let messages = conversation.messages || [];
    if (!Array.isArray(messages)) messages = [];
    messages.push({ role: 'user', content: message, timestamp: new Date() });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Conversation-Id': conversation.id
    });
    
    res.write(`data: ${JSON.stringify({ conversationId: conversation.id, type: 'meta' })}\n\n`);

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    let fullResponse = '';

    res.write = (data) => {
      try {
        const line = data.toString();
        const match = line.match(/data: (.+)\n/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.text && !parsed.done) fullResponse += parsed.text;
        }
      } catch {}
      return originalWrite(data);
    };

    res.end = async () => {
      if (fullResponse) {
        messages.push({ role: 'assistant', content: fullResponse, timestamp: new Date() });
        const metadata = conversation.metadata || {};
        metadata.messageCount = messages.length;

        await tenantDb.chatHistory.update({
          where: { id: conversation.id },
          data: {
            messages,
            metadata
          }
        });
      }
      return originalEnd();
    };

    await generateStreamingResponse({
      message,
      role: req.user.role,
      userId: req.user._id,
      collegeId: req.collegeId || req.user.college_id,
      apiKey,
      conversationHistory: messages.slice(0, -1),
      subject,
      res
    });
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ success: false, message: error.message });
    res.write(`data: ${JSON.stringify({ text: `Error: ${error.message}`, done: true, error: true })}\n\n`);
    res.end();
  }
};

exports.getChatHistory = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const conversations = await tenantDb.chatHistory.findMany({
      where: { userId: req.user._id },
      select: {
        id: true,
        title: true,
        role: true,
        metadata: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 50
    });

    const formatted = conversations.map(c => ({
      ...c,
      _id: c.id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.getAnnouncementDrafts = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const conversations = await tenantDb.chatHistory.findMany({
      where: {
        userId: req.user._id,
        role: { in: ['admin', 'principal', 'superAdmin'] }
      },
      orderBy: { updatedAt: 'desc' },
      take: 20
    });

    const drafts = [];
    conversations.forEach(c => {
      if (c.metadata?.activeDraft) {
        drafts.push({
          conversationId: c.id,
          title: c.title,
          draft: c.metadata.activeDraft,
          updatedAt: c.updatedAt
        });
      }
    });

    res.json({ success: true, data: drafts });
  } catch (error) { next(error); }
};

exports.getConversation = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const conversation = await tenantDb.chatHistory.findFirst({
      where: { id: req.params.id, userId: req.user._id }
    });
    if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found' });
    
    res.json({
      success: true,
      data: {
        ...conversation,
        _id: conversation.id
      }
    });
  } catch (error) { next(error); }
};

exports.deleteConversation = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;

    const existing = await tenantDb.chatHistory.findFirst({
      where: { id: req.params.id, userId: req.user._id }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Conversation not found' });

    await tenantDb.chatHistory.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Conversation deleted' });
  } catch (error) { next(error); }
};

exports.renameConversation = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { title } = req.body;

    const existing = await tenantDb.chatHistory.findFirst({
      where: { id: req.params.id, userId: req.user._id }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Conversation not found' });

    const conversation = await tenantDb.chatHistory.update({
      where: { id: req.params.id },
      data: { title }
    });

    res.json({
      success: true,
      data: {
        ...conversation,
        _id: conversation.id
      }
    });
  } catch (error) { next(error); }
};

// PATCH /ai/chat/:id/announcement-status
// Updates the status of a saved announcement draft inside a conversation message
// so that on page reload the card reflects Published / Scheduled correctly.
exports.updateAnnouncementStatus = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { draftSessionId, status, scheduledFor, announcementId } = req.body;

    if (!draftSessionId || !status) {
      return res.status(400).json({ success: false, message: 'draftSessionId and status are required' });
    }

    const conversation = await tenantDb.chatHistory.findFirst({
      where: { id: req.params.id, userId: req.user._id }
    });
    if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found' });

    // Walk messages and patch the matching announcement draft
    const messages = (conversation.messages || []).map(msg => {
      if (msg.announcement && msg.announcement.draftSessionId === draftSessionId) {
        return {
          ...msg,
          announcement: {
            ...msg.announcement,
            status,
            ...(scheduledFor ? { scheduledFor } : {}),
            ...(announcementId ? { id: announcementId } : {})
          }
        };
      }
      return msg;
    });

    // Also patch metadata.activeDraft if it matches
    const metadata = conversation.metadata || {};
    if (metadata.activeDraft?.draftSessionId === draftSessionId) {
      metadata.activeDraft = {
        ...metadata.activeDraft,
        status,
        ...(scheduledFor ? { scheduledFor } : {}),
        ...(announcementId ? { id: announcementId } : {})
      };
    }

    await tenantDb.chatHistory.update({
      where: { id: req.params.id },
      data: { messages, metadata }
    });

    res.json({ success: true, message: 'Announcement status updated in conversation' });
  } catch (error) { next(error); }
};
